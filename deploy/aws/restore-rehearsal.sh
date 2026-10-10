#!/usr/bin/env bash
#
# Prove a nightly dump is readable, by restoring it into a scratch database and counting what came
# back (Spec 28 commit 8).
#
# This is the half of a backup that people skip and then regret. A dump that cannot be restored is
# not a backup, and the only way to know is to restore it. It is cheap here because the scratch
# database is on the same server: there is nothing to provision and nothing to pay for.
#
# What it proves: the file is a complete, readable pg_dump archive, and the tables have the rows
# you would expect. What it cannot prove: that the data survives this disk, this instance or this
# account — nothing on this box can prove that. See flexee-backup.sh's header.
#
# ==============================================================================================
#  SAFETY, because this script creates and drops databases.
#
#  * It restores ONLY into a database it created itself, this run, named
#    flexee_restore_check_<timestamp>. The name is built here and cannot be passed in.
#  * It drops ONLY that database, and only if it created it.
#  * It never writes to the live database. The single read it makes there is SELECT count(*), and
#    only when asked with --compare-live.
#  * It prints the host and the database it is about to touch, and refuses to do anything without
#    --yes.
# ==============================================================================================
#
# Usage:
#   deploy/aws/restore-rehearsal.sh --yes                        # the newest dump
#   deploy/aws/restore-rehearsal.sh --yes --dump <file>           # a particular one
#   deploy/aws/restore-rehearsal.sh --yes --compare-live          # also read counts from the live database
#   deploy/aws/restore-rehearsal.sh --yes --keep                  # leave the scratch database for poking at
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/flexee}"
TABLES="${RESTORE_CHECK_TABLES:-users enrolments sections assignments submissions library_uploads chapters questions}"

yes=no dump="" compare=no keep=no
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=yes ;;
    --dump) dump="${2:-}"; shift ;;
    --compare-live) compare=yes ;;
    --keep) keep=yes ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "restore-rehearsal: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$DATABASE_URL" ]; then
  echo "restore-rehearsal: DATABASE_URL is not set, so there is no server to restore into." >&2
  exit 1
fi

# The host and database, pulled out of the URL for the line below. Printed, never the password:
# everything between // and @ is dropped.
host_db="$(printf '%s' "$DATABASE_URL" | sed -e 's#^[a-z+]*://##' -e 's#^[^@]*@##')"
host="${host_db%%/*}"
live_db="${host_db#*/}"; live_db="${live_db%%\?*}"

if [ -z "$dump" ]; then
  # shellcheck disable=SC2012  # generated names, not user input
  dump="$(ls -1 "$BACKUP_DIR"/db-*.dump 2>/dev/null | sort -r | head -1 || true)"
fi
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "restore-rehearsal: no dump found. Looked in $BACKUP_DIR for db-*.dump." >&2
  exit 1
fi

scratch="flexee_restore_check_$(date -u +%Y%m%d%H%M%S)"

echo "restore-rehearsal:"
echo "  server      $host"
echo "  dump        $(basename "$dump") ($(( $(wc -c < "$dump") / 1024 / 1024 )) MB)"
echo "  restore into  $scratch   (created now, dropped at the end)"
echo "  live database $live_db   ($([ "$compare" = yes ] && echo 'read-only, SELECT count(*) only' || echo 'not touched at all'))"

if [ "$yes" != yes ]; then
  echo
  echo "Nothing done. Re-run with --yes if the server above is the one you meant." >&2
  exit 3
fi

# A connection string for the same server, different database. Built by replacing the path, so the
# credentials and options are carried over untouched.
scratch_url="$(printf '%s' "$DATABASE_URL" | sed -e "s#/${live_db}\([?]\|\$\)#/${scratch}\1#")"
if [ "$scratch_url" = "$DATABASE_URL" ]; then
  echo "restore-rehearsal: could not work out a scratch connection string from DATABASE_URL; refusing to guess." >&2
  exit 1
fi

cleanup() {
  if [ "$keep" = yes ]; then
    echo "restore-rehearsal: leaving $scratch in place, as asked. Drop it with: dropdb $scratch"
    return
  fi
  # Belt and braces: the name is built above, but this is the line that drops a database, so it
  # checks the shape of the name before it runs.
  case "$scratch" in
    flexee_restore_check_*) psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"$scratch\";" >/dev/null 2>&1 || true ;;
    *) echo "restore-rehearsal: refusing to drop \"$scratch\" — not a scratch name." >&2 ;;
  esac
}
trap cleanup EXIT

echo "creating $scratch"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$scratch\";"

echo "restoring"
# --no-owner/--no-privileges so the restore does not need the live roles to exist here. Errors are
# counted rather than ignored: pg_restore exits non-zero on a damaged archive, which is the point.
if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch_url" "$dump"; then
  echo "restore-rehearsal: FAILED — the dump did not restore. This dump cannot be relied on." >&2
  exit 1
fi

echo
printf '%-18s %12s' "table" "restored"
[ "$compare" = yes ] && printf ' %12s %s' "live" "same?"
echo
bad=0
for t in $TABLES; do
  n="$(psql "$scratch_url" -tAc "select count(*) from \"$t\"" 2>/dev/null || echo "-")"
  printf '%-18s %12s' "$t" "$n"
  if [ "$compare" = yes ]; then
    # The only statement this script sends to the live database, and it is a count.
    l="$(psql "$DATABASE_URL" -tAc "select count(*) from \"$t\"" 2>/dev/null || echo "-")"
    printf ' %12s' "$l"
    if [ "$n" = "$l" ]; then printf ' yes'; else printf ' NO'; bad=$(( bad + 1 )); fi
  fi
  echo
done

echo
if [ "$compare" = yes ] && [ "$bad" -gt 0 ]; then
  echo "restore-rehearsal: $bad table(s) differ. Rows written after the dump was taken explain a"
  echo "  higher live count; a higher restored count does not have an innocent explanation."
  exit 1
fi
echo "restore-rehearsal: the dump restored and the tables are there."
echo "  This proves the file is readable. It does not make it a backup: it is on the same disk as"
echo "  the database it came from. See $BACKUP_DIR/README.txt."
