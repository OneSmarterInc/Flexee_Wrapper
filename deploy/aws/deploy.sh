#!/usr/bin/env bash
#
# Deploy the Flexee Wrapper on the AWS box. Run by .github/workflows/deploy.yml on the
# self-hosted runner; also safe to run by hand over Session Manager.
#
# PROVENANCE, which matters until the two copies are reconciled: this file was written on
# 9 October 2026 from a description of the script living at /var/www/Flexee_Wrapper/deploy.sh,
# not copied from it. **The box's copy is what actually runs.** Reconcile them — copy this over
# it, or paste the box's version here — before trusting either. The differences this version
# deliberately introduces are the three marked CHANGE below.
#
# The sequence is otherwise as described: flock, fetch, pull --ff-only, npm ci, migrate, build,
# restart, check.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/Flexee_Wrapper}"
LOCK="${DEPLOY_LOCK:-/tmp/flexee-wrapper-deploy.lock}"

# One deploy at a time. -n so a second push fails fast instead of queueing behind a build.
#
# flock's absence is reported separately from a held lock. Written this way because the obvious
# `flock -n 9 || { echo "another deploy holds the lock"; exit 1; }` says exactly the wrong thing
# when flock is not installed, and that is a confusing half-hour for whoever meets it.
command -v flock >/dev/null 2>&1 || { echo "deploy: flock is not installed; refusing to run without a lock." >&2; exit 1; }
exec 9>"$LOCK"
flock -n 9 || { echo "deploy: another deploy holds $LOCK; nothing done."; exit 1; }

cd "$APP_DIR"

# --- CHANGE 1 (Spec 28 Addendum D §3): refuse to run if the content lives in the checkout --------
#
# CONTENT_DIR was /var/www/Flexee_Wrapper/content, which is this git working tree, and all 148
# files under content/ are tracked. So publishing a book modified tracked files and the
# `git pull --ff-only` below then refused to overwrite them: the first deploy after any book
# publish failed, and clearing it by discarding local changes replaced the published book with the
# repository's committed copy.
#
# The fix is that the live directories sit outside the checkout. This assertion is what stops the
# fault returning the next time someone sets a path by hand.
#
# Note that inside the checkout is the *correct* place for a developer's machine, where ./content
# is a test fixture. The rule is a deployment rule, which is why it lives here and not in the app.
# Both sides are canonicalised the same way, with `cd` and `pwd -P`, and neither `realpath` nor
# `git rev-parse --show-toplevel` is used. The first draft used both and silently never matched,
# because git reports a Windows-style path where realpath reports a POSIX one — so the assertion
# passed every case including the one it existed to catch. `pwd -P` also resolves symlinks, which
# is the stronger check, and it is the same on every platform.
#
# A directory that does not exist is itself a refusal: the app would serve no books, so a deploy
# that proceeds is worse than one that stops and says why.
repo_root="$(cd "$APP_DIR" && pwd -P)"
for var in CONTENT_DIR FILES_DIR INTAKE_WORK_DIR; do
  path="${!var:-}"
  [ -n "$path" ] || continue
  [ -d "$path" ] || {
    echo "deploy: refusing to run. $var=$path is not a directory." >&2
    echo "  Create it, or correct the setting. Expected something like /var/lib/flexee/content." >&2
    exit 1
  }
  resolved="$(cd "$path" && pwd -P)"
  case "$resolved/" in
    "$repo_root"/*)
      echo "deploy: refusing to run." >&2
      echo "  $var=$path resolves to $resolved, inside the git checkout at $repo_root." >&2
      echo "  Book content and student files must live outside it, or a publish and a pull will" >&2
      echo "  fight over the same files: content/ is tracked, so a publish modifies tracked files" >&2
      echo "  and the next git pull --ff-only refuses. Expected /var/lib/flexee/content." >&2
      exit 1
      ;;
  esac
done

git fetch --prune origin
git pull --ff-only origin main

npm ci

# --- CHANGE 2 (Spec 28 Addendum C/D): db:deploy, not db:migrate -----------------------------------
#
# `db:migrate` is drizzle-kit, which reads drizzle.config.ts, where dbCredentials.url is
# `process.env.DATABASE_URL || "postgres://localhost/flexee"`. drizzle-kit 0.31.10 does not depend
# on dotenv and that config does not load it, so with DATABASE_URL absent from this script's
# environment it does not fail — it migrates whatever `flexee` resolves to on the local server,
# which exists at 127.0.0.1:5432.
#
# `db:deploy` is scripts/migrate.ts: it loads .env through --env-file-if-exists and **refuses**
# without DATABASE_URL. If this line now stops the deploy, that is the bug surfacing, not a
# regression: put DATABASE_URL in the .env beside this script, or export it above.
npm run db:deploy

npm run build

# --- CHANGE 3 (Spec 28 Addendum C): restart the worker too ----------------------------------------
#
# Once flexee-intake.service exists, restarting only flexee-wrapper leaves the old worker running
# against new code. Guarded, so this script still works before that unit is installed.
# The two sudo lines below are spelled exactly as the box's own script spells them, without the
# .service suffix, and must stay that way: sudoers matches the command line as written, so a rule
# permitting `/usr/bin/systemctl restart flexee-wrapper` does not permit
# `systemctl restart flexee-wrapper.service`. Whichever spelling the working rule uses is the one
# this file has to use. The runbook gives the rule for flexee-intake in the same spelling.
sudo systemctl restart flexee-wrapper
if systemctl list-unit-files flexee-intake.service >/dev/null 2>&1 \
   && systemctl is-enabled --quiet flexee-intake.service 2>/dev/null; then
  sudo systemctl restart flexee-intake
fi

# A restart that fails leaves the unit inactive, and the deploy should say so rather than succeed.
systemctl is-active --quiet flexee-wrapper
if systemctl list-unit-files flexee-intake.service >/dev/null 2>&1 \
   && systemctl is-enabled --quiet flexee-intake.service 2>/dev/null; then
  systemctl is-active --quiet flexee-intake
fi

echo "deploy: $(git rev-parse --short HEAD) is live."
