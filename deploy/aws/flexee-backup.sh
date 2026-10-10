#!/usr/bin/env bash
#
# The nightly copy: a pg_dump of the database and a tarball of the books and student files, into
# /var/backups/flexee, keeping seven days (Spec 28 commit 8).
#
# ==============================================================================================
#  THIS IS A STOPGAP, NOT A BACKUP.
#
#  It writes to the same disk as the thing it copies. It survives a mistaken DELETE, a bad
#  migration, a book published over the wrong id, or a student's file deleted by accident. It does
#  NOT survive the disk, the instance, or the AWS account — which is what the word "backup" is
#  normally taken to promise, and the reason that word is not used for it anywhere.
#
#  Spec 28 Addendum F defers the real thing (an S3 bucket, write-only, with Object Lock) until
#  real student data lands on this box or 30 November, whichever comes first. Until then this is
#  what there is, and anybody relying on it should know which half of the job it does.
# ==============================================================================================
#
# Run by flexee-backup.timer. Safe to run by hand; a second copy simply declines.
#
# Settings (the unit passes these through EnvironmentFile=/var/www/Flexee_Wrapper/.env):
#   DATABASE_URL          required
#   CONTENT_DIR           the books            (default /var/lib/flexee/content)
#   FILES_DIR             attachments and submissions (default /var/lib/flexee/files)
#   BACKUP_DIR            where copies go      (default /var/backups/flexee)
#   BACKUP_KEEP           how many of each to keep (default 7)
#   BACKUP_MIN_FREE_MB    the floor; below it this declines rather than filling the disk (default 2048)
#
# Exit codes, and the difference matters:
#   0  a copy was made, OR it declined for want of space, OR another run holds the lock.
#   1  something is wrong — no DATABASE_URL, pg_dump failed, tar failed.
# Declining is not a failure: this disk is shared with the OS and five services, and a copy that
# fills it takes the site down, which is worse than a missing copy. A unit left in `failed` for a
# deliberate decision teaches people to ignore a failed unit.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
CONTENT_DIR="${CONTENT_DIR:-/var/lib/flexee/content}"
FILES_DIR="${FILES_DIR:-/var/lib/flexee/files}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/flexee}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"
LOCK="${BACKUP_LOCK:-/tmp/flexee-backup.lock}"

say() { echo "flexee-backup: $*"; }
note() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$BACKUP_DIR/last-run.txt" 2>/dev/null || true; }

# One at a time. flock's absence is reported separately from a held lock, because the obvious
# one-liner says exactly the wrong thing when flock is not installed.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  if ! flock -n 9; then
    say "another run holds $LOCK; nothing done."
    exit 0
  fi
else
  say "flock is not installed; running without a lock."
fi

if [ -z "$DATABASE_URL" ]; then
  say "DATABASE_URL is not set, so there is nothing to dump. Put it in the environment file." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

# Whoever finds this directory in six months reads this first, and learns what it is not.
cat > "$BACKUP_DIR/README.txt" <<'README'
These files are a STOPGAP, not a backup.

  db-<time>.dump          pg_dump -Fc of the Wrapper's database
  files-<time>.tar.gz     the books (CONTENT_DIR) and student files (FILES_DIR)

Seven of each are kept. They are written by flexee-backup.timer, nightly.

They are on the same disk as the data they copy. They will get you back a table somebody emptied,
a migration that went wrong, or a file deleted by accident. They will not get you anything back if
this disk, this instance or this AWS account is lost. An off-box copy (S3, write-only, with Object
Lock) is deferred until real student data is here or 30 November, whichever is first — Spec 28
Addendum F.

To check a dump is readable, run deploy/aws/restore-rehearsal.sh. It restores into a scratch
database and drops it again; it never touches the live one.
README

# --- is there room? --------------------------------------------------------------------------
#
# Estimated from what is about to be copied: the trees, plus a floor for everything else on this
# disk. The dump's size is unknown until it exists, and it is small beside the books.
free_mb() { df -Pk "$1" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024}'; }
size_mb() { du -sm "$1" 2>/dev/null | awk '{printf "%d", $1}'; }

trees_mb=0
for d in "$CONTENT_DIR" "$FILES_DIR"; do
  [ -d "$d" ] || continue
  trees_mb=$(( trees_mb + $(size_mb "$d") ))
done
free=$(free_mb "$BACKUP_DIR")
need=$(( trees_mb + BACKUP_MIN_FREE_MB ))

if [ -n "$free" ] && [ "$free" -lt "$need" ]; then
  say "SKIPPED: this would need about ${need} MB free (${trees_mb} MB to copy plus a ${BACKUP_MIN_FREE_MB} MB floor) and $BACKUP_DIR has ${free} MB."
  say "SKIPPED: nothing was written. Free space, or lower BACKUP_KEEP. A copy that fills this disk would take the site down."
  note "SKIPPED for space: needed ${need} MB, had ${free} MB"
  exit 0
fi

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
dump="$BACKUP_DIR/db-$stamp.dump"
tarball="$BACKUP_DIR/files-$stamp.tar.gz"

# Both are written to a temporary name and renamed. A half-written dump that is named like a good
# one is worse than no dump, because it is the one somebody reaches for in a hurry.
say "dumping the database"
if ! pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" > "$dump.part" 2>"$BACKUP_DIR/.pg_dump.err"; then
  say "pg_dump failed: $(tail -c 400 "$BACKUP_DIR/.pg_dump.err" 2>/dev/null || echo 'no output')" >&2
  rm -f "$dump.part"
  note "FAILED: pg_dump"
  exit 1
fi
mv "$dump.part" "$dump"
rm -f "$BACKUP_DIR/.pg_dump.err"

# Two -C options rather than one parent, so the two directories need not share a parent. If they
# ever have the same basename under different parents, one would shadow the other in the archive —
# which is why the log below prints what went in.
say "archiving $CONTENT_DIR and $FILES_DIR"
tar_args=()
for d in "$CONTENT_DIR" "$FILES_DIR"; do
  if [ -d "$d" ]; then
    tar_args+=(-C "$(cd "$d/.." && pwd -P)" "$(basename "$d")")
  else
    say "note: $d does not exist, so it is not in the archive."
  fi
done
if [ "${#tar_args[@]}" -eq 0 ]; then
  say "neither CONTENT_DIR nor FILES_DIR exists; no archive written." >&2
  note "FAILED: no directories to archive"
  exit 1
fi
if ! tar -czf "$tarball.part" "${tar_args[@]}"; then
  say "tar failed." >&2
  rm -f "$tarball.part"
  note "FAILED: tar"
  exit 1
fi
mv "$tarball.part" "$tarball"

# --- retention -------------------------------------------------------------------------------
#
# The names are UTC timestamps, so lexical order is chronological and no date parsing is needed.
# Each removal is logged: a retention rule nobody can see is one nobody trusts.
prune() {
  local pattern="$1" kept=0
  # shellcheck disable=SC2012  # ls is safe here: these names are generated, never user input
  for f in $(ls -1 "$BACKUP_DIR"/$pattern 2>/dev/null | sort -r); do
    kept=$(( kept + 1 ))
    if [ "$kept" -gt "$BACKUP_KEEP" ]; then
      say "removing $(basename "$f") (keeping $BACKUP_KEEP)"
      rm -f "$f"
    fi
  done
}
prune 'db-*.dump'
prune 'files-*.tar.gz'
rm -f "$BACKUP_DIR"/*.part

dump_mb=$(( $(wc -c < "$dump") / 1024 / 1024 ))
tar_mb=$(( $(wc -c < "$tarball") / 1024 / 1024 ))
say "done: db-$stamp.dump (${dump_mb} MB), files-$stamp.tar.gz (${tar_mb} MB); $(free_mb "$BACKUP_DIR") MB free."
say "reminder: this is a stopgap on the same disk as the data. It is not an off-box backup."
note "OK: db ${dump_mb} MB, files ${tar_mb} MB, $(free_mb "$BACKUP_DIR") MB free"
exit 0
