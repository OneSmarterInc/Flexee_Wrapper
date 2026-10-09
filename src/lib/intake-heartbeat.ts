import { writeFileSync, readFileSync, statSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { intakeWorkDir } from "@/lib/paths";

/**
 * What the intake worker last reported, so /admin/status can say something true about a process it
 * cannot see (Spec 28 commit 11).
 *
 * The worker is a separate systemd unit. The app cannot ask systemd anything — it is not root, it
 * may be in a different cgroup, and a page that shelled out to `systemctl` to render would be a
 * worse idea than no check at all. So the worker writes a small file each time round its loop and
 * the status page reads it. One file, no table, no migration.
 *
 * **The file's age is the signal; its contents are context.** `mtime` answers "when did something
 * last look at the queue", which is the question, and it cannot be got wrong by a half-written
 * file. The JSON says what the worker was doing, which is what tells a long publish apart from a
 * dead worker — during `spawnSync` the worker's event loop is blocked, so nothing can tick a
 * heartbeat while python builds a book, and without `busy` a two-minute publish would look exactly
 * like a worker that had died two minutes ago.
 *
 * It lives in `INTAKE_WORK_DIR`, which both units are given. That directory is scratch, so clearing
 * it removes the heartbeat — which is harmless: the worker writes a new one within one poll, and a
 * missing heartbeat is reported as "has not reported", which is then true for a few seconds.
 */

export type Heartbeat = {
  /** ISO time the worker wrote it, for a human reading the file. */
  at: string;
  /** Working on a book, or watching the queue. */
  busy: boolean;
  bookId?: string;
  uploadId?: string;
  action?: "check" | "publish";
  pid?: number;
};

/** Where the file is. Both units read `INTAKE_WORK_DIR` from the same `.env`. */
export const heartbeatPath = (env: Record<string, string | undefined> = process.env) =>
  path.join(intakeWorkDir(env), "intake-worker.heartbeat.json");

/**
 * Write it. Never throws: a worker that could not write its heartbeat must still do its work, and
 * the status line going stale is a smaller problem than a book that is not added.
 *
 * Written to a temporary name and renamed, which is atomic within a directory on every filesystem
 * this runs on, so a reader can never see half a file.
 */
export function writeHeartbeat(h: Omit<Heartbeat, "at" | "pid">, env = process.env): void {
  try {
    const f = heartbeatPath(env);
    mkdirSync(path.dirname(f), { recursive: true });
    const body = JSON.stringify({ ...h, at: new Date().toISOString(), pid: process.pid } satisfies Heartbeat, null, 1);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, f);
  } catch { /* the status line is not worth failing a job for */ }
}

/** Read it, with how long ago it was written. Null when there is none, or it cannot be read. */
export function readHeartbeat(env = process.env): (Heartbeat & { ageMs: number }) | null {
  try {
    const f = heartbeatPath(env);
    const ageMs = Date.now() - statSync(f).mtimeMs;
    let parsed: Partial<Heartbeat> = {};
    try { parsed = JSON.parse(readFileSync(f, "utf8")) as Partial<Heartbeat>; } catch { /* age still counts */ }
    return {
      at: typeof parsed.at === "string" ? parsed.at : new Date(Date.now() - ageMs).toISOString(),
      busy: parsed.busy === true,
      bookId: typeof parsed.bookId === "string" ? parsed.bookId : undefined,
      uploadId: typeof parsed.uploadId === "string" ? parsed.uploadId : undefined,
      action: parsed.action === "check" || parsed.action === "publish" ? parsed.action : undefined,
      pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
      // Clocks: a file written in the future would otherwise read as a negative age and look fresh
      // for ever. Treated as "just now", which is the kindest reading of a wrong clock.
      ageMs: Math.max(0, ageMs),
    };
  } catch { return null; }
}

/**
 * How long a heartbeat may be stale before the worker is presumed gone.
 *
 * Six polls, and never less than a minute. Six rather than two because a poll can be delayed by
 * the box being busy, and a status line that cries wolf teaches people to ignore it.
 */
export const staleAfterMs = (env: Record<string, string | undefined> = process.env) =>
  Math.max(60_000, 6 * Number(env.INTAKE_POLL_MS || 5000));

/**
 * How long a book may be in the intake before that is itself worth reporting.
 *
 * A real book takes one to two minutes. Fifteen is generous enough that a slow box is not an alarm
 * and short enough that a worker killed mid-publish is noticed within the hour it matters.
 */
export const BUSY_TOO_LONG_MS = 15 * 60_000;
