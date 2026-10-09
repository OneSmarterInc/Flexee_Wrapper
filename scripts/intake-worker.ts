// The book intake, as a long-running worker on the box (Spec 28 commit 7).
//
// It replaces .github/workflows/library-intake.yml. The workflow was dispatched by the app and ran
// on a GitHub runner, which worked while the zip and the published books lived in Vercel Blob and
// the database was reachable from the internet. On the box the zip is a file under FILES_DIR and
// the books are a directory under CONTENT_DIR, and a GitHub runner can reach neither.
//
// There is no queue table and no message broker. `library_uploads` already holds exactly the state
// a queue needs: a row in `checking` is a check waiting to run, and a row in `publishing` is a
// publish waiting to run, both set by the app in the same transaction that recorded the person's
// click. So this polls those two statuses, oldest first, and runs one job at a time.
//
// Settings:
//   DATABASE_URL        the same database the app uses (required)
//   CONTENT_STORE       fs (default) or blob — where the books are published
//   CONTENT_DIR         the content root, for fs
//   FILES_DIR           where the uploaded zip is
//   INTAKE_WORK_DIR     where a book is unpacked and built
//   INTAKE_POLL_MS      how long to wait when there is nothing to do (default 5000)
//   INTAKE_MIN_FREE_MB  the free-disk floor (default 1024)
//
// It reports itself by writing INTAKE_WORK_DIR/intake-worker.heartbeat.json each time round the
// loop, which is the only thing /admin/status can read about a systemd unit the app cannot see.
import { statfsSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { setStatus, waitingIntakes } from "@/lib/library";
import { writeHeartbeat } from "@/lib/intake-heartbeat";
import { contentDir, intakeWorkDir, filesDir } from "@/lib/paths";
import { runJob, contentOps, type BlobOps, type SyncDb } from "./library-intake.ts";

// ---- the per-book lock -----------------------------------------------------------------------

/**
 * One book at a time, across processes.
 *
 * Two jobs on the same book must not run together: both would unpack, both would archive the
 * current live tree under their own timestamp, and the second's `put` would race the first's `del`
 * of what it considers stale. The result is a half-published book, which is the one outcome worse
 * than a failed publish.
 *
 * A Postgres advisory lock rather than a lock table or a file: it is held by a session and released
 * when that session ends, so a worker killed mid-job — OOM, a deploy, the instance stopping — does
 * not leave a lock nobody can clear. A row in a lock table would need a lease and a reaper.
 *
 * **It guards against other processes, not against this one.** Advisory locks are re-entrant within
 * a session: the same connection may take the same lock twice and succeed both times. That is why
 * the loop below runs one job at a time rather than relying on the lock for its own serialisation.
 * What the lock catches is a second worker (a deploy that started one before stopping the old one)
 * or somebody running `library-intake --upload … --action publish` by hand at the wrong moment.
 */
export interface BookLock {
  tryLock(bookId: string): Promise<boolean>;
  unlock(bookId: string): Promise<void>;
  close(): Promise<void>;
}

/** A namespace, so these locks cannot collide with another part of the system taking one. */
export const LOCK_CLASS = 19532;          // 0x4C4C, "FL"

/**
 * A book id as a signed 32-bit key, by FNV-1a.
 *
 * Postgres's two-argument advisory lock takes two int4s, so the id has to become a number. A hash
 * means two different books could in principle share a key, which costs one of them a wait; the
 * alternative, a number stored per book, costs a table and a migration to prevent something that
 * has no consequence. Not `hashtext()`: it is undocumented and its value has changed between major
 * versions, which would make the key depend on the server rather than on the book.
 */
export function bookLockKey(bookId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bookId.length; i++) {
    h ^= bookId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;                           // signed int4, which is what pg_try_advisory_lock takes
}

/** The real thing: one dedicated connection, because a session lock belongs to a session. */
export function advisoryLock(url: string): BookLock {
  // max: 1 is the whole point. `db()` is a pool of up to ten, and a lock taken on one connection
  // and released on another is not released at all.
  const c = postgres(url, { prepare: false, max: 1, idle_timeout: 0 });
  return {
    async tryLock(bookId) {
      const r = await c`select pg_try_advisory_lock(${LOCK_CLASS}::int4, ${bookLockKey(bookId)}::int4) as got`;
      return r[0]?.got === true;
    },
    async unlock(bookId) {
      await c`select pg_advisory_unlock(${LOCK_CLASS}::int4, ${bookLockKey(bookId)}::int4)`;
    },
    async close() { await c.end({ timeout: 5 }); },
  };
}

// ---- free disk -------------------------------------------------------------------------------

/**
 * How much room an intake needs before it starts, and what it does when there is not enough.
 *
 * A 200 MB zip is unpacked, built into a content tree, and then the book's current files are
 * copied to the archive before the new ones are written. Five times the zip is a generous estimate
 * of the peak and a cheap one to check. The floor on top of that is not for the intake: it is for
 * the four other services and the OS on the same 28 GB disk, which do not stop needing space
 * because a book is being added.
 *
 * Refusing is the point. An intake that fills the disk takes down five services, and the last
 * stretch of a publish is the worst moment to run out — the archive copy has been made and the new
 * files are half written.
 */
export const DISK_FACTOR = 5;
export const minFreeBytes = (env = process.env) => Number(env.INTAKE_MIN_FREE_MB || 1024) * 1024 * 1024;

/** Free bytes on the filesystem holding `dir`, or null if it cannot be measured. */
export function freeBytes(dir: string): number | null {
  try {
    const st = statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch { return null; }
}

/**
 * The directories an intake writes to, and the least free space among them.
 *
 * Measured per directory rather than once, because they are three settings and nothing says they
 * are on one filesystem — on the box today they are, and the day someone moves CONTENT_DIR to its
 * own volume this keeps answering the right question.
 */
export function leastFree(env = process.env): { bytes: number | null; where: string } {
  let bytes: number | null = null; let where = "";
  for (const [name, dir] of [["INTAKE_WORK_DIR", intakeWorkDir(env)], ["CONTENT_DIR", contentDir(env)], ["FILES_DIR", filesDir(env)]] as const) {
    if (!existsSync(dir)) continue;
    const free = freeBytes(dir);
    if (free === null) continue;
    if (bytes === null || free < bytes) { bytes = free; where = name; }
  }
  return { bytes, where };
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Is there room to run this job? Returns null when there is, or the sentence to record when not.
 *
 * A filesystem that cannot be measured is not a refusal. statfs is not available everywhere, and
 * refusing every book because a syscall is missing would be a worse failure than the one this
 * prevents.
 */
export function diskRefusal(zipBytes: number, env = process.env): string | null {
  const need = zipBytes * DISK_FACTOR + minFreeBytes(env);
  const { bytes, where } = leastFree(env);
  if (bytes === null || bytes >= need) return null;
  return `There is not enough free space on the server to add this book: it needs about ${mb(need)} free `
    + `and ${where} has ${mb(bytes)}. Nothing was changed. Ask your developer to free space and upload it again.`;
}

// ---- one pass --------------------------------------------------------------------------------

/** The jobs waiting, oldest first. One definition, in lib/library, which /admin/status also asks. */
export const waiting = waitingIntakes;

export type PassResult =
  | { did: "nothing" }
  | { did: "locked-elsewhere"; bookId: string }
  | { did: "refused"; id: string; reason: string }
  | { did: "ran"; id: string; action: "check" | "publish"; outcome: string };

/**
 * Run at most one job, and say what happened.
 *
 * One job per pass, not a batch: the intake spawns python and can take minutes, and the box is
 * shared with four other services. Two at once would double the memory and the CPU for no gain,
 * since a person adding a book is waiting on their own book and not on the queue.
 *
 * A row whose book is locked by another process is skipped rather than waited for, and the pass
 * moves to the next row — a stuck book must not stop a different one.
 */
export async function onePass(opts: {
  lock: BookLock; ops: BlobOps; prefix: string; env?: NodeJS.ProcessEnv; now?: Date;
  // The loader step, injectable for the same reason it is injectable in runJob: it spawns
  // `npm run db:sync-content`, which opens its own connection to DATABASE_URL. A test must be able
  // to stub that rather than reach a real database.
  syncDb?: SyncDb;
}): Promise<PassResult> {
  const env = opts.env ?? process.env;
  const rows = await waiting();
  for (const row of rows) {
    if (!(await opts.lock.tryLock(row.bookId))) {
      writeHeartbeat({ busy: false }, env);     // alive and looking, which is what the file reports
      return { did: "locked-elsewhere", bookId: row.bookId };
    }
    try {
      const action = row.status === "publishing" ? "publish" : "check";
      const refusal = diskRefusal(row.sizeBytes, env);
      if (refusal) {
        // A check that cannot run is stopped: the record is dismissible and says why. A publish
        // that cannot run goes back to ready, which is where it was before the click — the check
        // already passed, so the faculty member can add the book again once there is space.
        // Stopping it instead would leave the record in a state with no way forward but re-upload.
        await setStatus(row.id, action === "publish" ? "ready" : "stopped", { message: refusal });
        console.error(`intake worker: refused ${row.id} (${row.bookId}): ${refusal}`);
        writeHeartbeat({ busy: false }, env);
        return { did: "refused", id: row.id, reason: refusal };
      }
      console.log(`intake worker: ${action} ${row.bookId} (${row.id})`);
      // Spec 28 commit 11: written before the job, because during the job nothing can write it —
      // the intake runs python through spawnSync, which blocks this process entirely. `busy` is
      // what lets /admin/status tell a two-minute publish from a worker that died two minutes ago.
      writeHeartbeat({ busy: true, bookId: row.bookId, uploadId: row.id, action }, env);
      const outcome = await runJob({
        uploadId: row.id, action, blob: opts.ops, prefix: opts.prefix, now: opts.now, syncDb: opts.syncDb,
      });
      console.log(`intake worker: ${action} ${row.bookId} (${row.id}) -> ${outcome}`);
      writeHeartbeat({ busy: false }, env);
      return { did: "ran", id: row.id, action, outcome };
    } finally {
      await opts.lock.unlock(row.bookId);
    }
  }
  writeHeartbeat({ busy: false }, env);
  return { did: "nothing" };
}

// ---- the loop --------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until asked to stop.
 *
 * `stopping` is set by SIGTERM and checked between jobs, never during one. systemd sends SIGTERM on
 * `systemctl restart`, which deploy.sh does on every deploy; killing a publish halfway through
 * would leave a book part-written, so the unit's TimeoutStopSec gives the current job time to
 * finish and this exits after it.
 */
export async function loop(opts: { lock: BookLock; ops: BlobOps; prefix: string; pollMs?: number; syncDb?: SyncDb; stopping: () => boolean }) {
  const pollMs = opts.pollMs ?? Number(process.env.INTAKE_POLL_MS || 5000);
  while (!opts.stopping()) {
    let r: PassResult;
    try {
      r = await onePass({ lock: opts.lock, ops: opts.ops, prefix: opts.prefix, syncDb: opts.syncDb });
    } catch (e: any) {
      // Never exit on an error. A database that is restarting, a disk that is briefly full: the
      // next pass is the right response, and a crash loop would hide the cause behind systemd's
      // restart counter.
      console.error(`intake worker: pass failed: ${String(e?.message ?? e).slice(0, 300)}`);
      await sleep(pollMs);
      continue;
    }
    // Something ran, so look again at once: a publish usually follows a check within seconds.
    if (r.did === "ran") continue;
    await sleep(pollMs);
  }
}

// ---- command line ----------------------------------------------------------------------------

// Run as a script rather than imported by a test: the check library-intake.ts uses.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("intake worker: DATABASE_URL is not set."); process.exit(1); }
  const { ops, prefix, kind } = await contentOps();
  const lock = advisoryLock(url);
  let stop = false;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      if (stop) return;                   // a second signal does not shorten the current job
      stop = true;
      console.log(`intake worker: ${sig} received; finishing the current job, then stopping.`);
    });
  }
  console.log(`intake worker: started. store=${kind} content=${contentDir()} files=${filesDir()} work=${intakeWorkDir()}`);
  writeHeartbeat({ busy: false });            // so /admin/status is right from the first second
  const once = process.argv.includes("--once");
  if (once) {
    const r = await onePass({ lock, ops, prefix });
    console.log(`intake worker: one pass: ${JSON.stringify(r)}`);
  } else {
    await loop({ lock, ops, prefix, stopping: () => stop });
  }
  await lock.close();
  console.log("intake worker: stopped.");
  process.exit(0);
}
