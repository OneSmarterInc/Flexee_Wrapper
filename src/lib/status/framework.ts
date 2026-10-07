/**
 * Spec 24 §1: the frame every status check runs in.
 *
 * Pure and with no database, so the rules can be tested without one, and so the page importing it
 * costs nothing. Three properties it exists to hold:
 *
 *  - **One check never breaks the page.** Every check runs inside its own catch and its own
 *    timeout; a thrown error, a rejected promise and a check that simply never returns all become
 *    a result, not an exception. The page shows the other five.
 *  - **A timeout is a result, not a hang.** Five seconds, so a dead network cannot make an
 *    administrator stare at a blank page — the very situation they opened it to diagnose.
 *  - **Nothing secret is carried.** A result holds a state, a sentence and some facts; there is no
 *    field for a value, which is why `facts` is a list of label-and-text pairs that the checks
 *    build from "set" and "not set" rather than from anything read out of the environment.
 */

/** Plain words, never carried by colour alone (§1). */
export type State = "ok" | "attention" | "down" | "not-configured" | "unknown";

export const STATE_WORDS: Record<State, string> = {
  ok: "OK",
  attention: "Needs attention",
  down: "Down",
  "not-configured": "Not configured",
  unknown: "Unknown",
};

export type Fact = { label: string; text: string };

export type Result = {
  state: State;
  /** One sentence a non-developer can act on. */
  detail: string;
  /** Supporting lines: a latency, an expiry date, which settings are set. Never a value. */
  facts?: Fact[];
  /** What this check cannot prove, said out loud where it matters (§2, decision 7). */
  caveat?: string;
  /** How long the check took, filled in by the runner. */
  ms?: number;
};

export type Check = {
  id: string;
  /** The line's name on the page. */
  name: string;
  run: () => Promise<Result>;
};

export const TIMEOUT_MS = 5_000;
export const CACHE_MS = 10 * 60 * 1_000;

/**
 * Race a promise against a timeout, telling the two outcomes apart.
 *
 * Failing and hanging are different things and want different sentences: the first version of this
 * collapsed both into `onTimeout`, so a check that threw in 0 ms reported "No answer within 5
 * seconds" — which sends a reader looking for a network problem that is not there.
 */
function withTimeout<T>(
  p: Promise<T>, ms: number, onTimeout: () => T, onReject: () => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    // Deliberately not unref'd. An unref'd timer lets the process exit before it fires, which
    // would turn "timed out" into "never answered at all" — and a check that hangs is the one case
    // this exists for. The timer is cleared the moment the check settles, so the only thing it ever
    // holds open is an invocation that has already sent its answer.
    p.then((v) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(v);
    }).catch(() => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve(onReject());
    });
  });
}

/**
 * Run one check, alone. Never throws, never hangs, and always says how long it took.
 *
 * A thrown error does not carry its message into the result. An exception's text is written for a
 * developer and can quote a connection string, a key or a recipient back at us; the sentence a
 * reader gets is written here instead, and the check's own code is what decides the wording for
 * cases it understands.
 */
export async function runCheck(
  check: Check, now = () => Date.now(), timeoutMs = TIMEOUT_MS,
): Promise<Result> {
  const started = now();
  const secs = Math.round(timeoutMs / 1000);
  const timedOut = (): Result => ({
    state: "down",
    // The real timeout in the sentence, so the page never says five seconds about a test's twenty
    // milliseconds — and so a suite can prove the behaviour without waiting five seconds for it.
    detail: secs ? `No answer within ${secs} seconds.` : `No answer within ${timeoutMs} ms.`,
  });
  /**
   * A check that threw. The message is deliberately not carried: an exception's text is written for
   * a developer and can quote a connection string, a key or a recipient back at us. A check that
   * understands its own failure says so itself, in its own words, and returns a result rather than
   * throwing — this is the sentence for the ones that do not get the chance.
   */
  const failed = (): Result => ({
    state: "down",
    detail: "The check could not be completed. The details are in the server log.",
  });
  let r: Result;
  try {
    r = await withTimeout(Promise.resolve().then(check.run), timeoutMs, timedOut, failed);
  } catch {
    // Only reachable if withTimeout's own machinery throws; a check's error is caught inside it.
    r = { state: "unknown", detail: "The check could not be run." };
  }
  if (!r || typeof r !== "object" || !(r.state in STATE_WORDS)) {
    r = { state: "unknown", detail: "The check returned nothing usable." };
  }
  return { ...r, ms: Math.max(0, now() - started) };
}

export type Snapshot = {
  /** Keyed by check id. */
  results: Record<string, Result>;
  at: number;
  /** True when every line came from the cache rather than from a fresh call. */
  cached: boolean;
};

/**
 * Run every check in parallel, each isolated. One failure cannot prevent the others appearing,
 * which `test:status-checks` proves with a check that throws beside one that works.
 */
export async function runAll(
  checks: Check[], now = () => Date.now(), timeoutMs = TIMEOUT_MS,
): Promise<Snapshot> {
  const pairs = await Promise.all(checks.map(async (c) => [c.id, await runCheck(c, now, timeoutMs)] as const));
  return { results: Object.fromEntries(pairs), at: now(), cached: false };
}

/**
 * The ten-minute cache (§1), in process.
 *
 * In process rather than in the database, which is the honest fit: on serverless each instance
 * keeps its own ten minutes, so two page loads can land on two instances and make two sets of
 * calls. That is a known property, written down in the change note, not a bug — the alternative is
 * a migration for a page an administrator opens occasionally.
 */
export class StatusCache {
  private snapshot: Snapshot | null = null;
  private inFlight: Promise<Snapshot> | null = null;
  readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = CACHE_MS, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs; this.now = now;
  }

  /** The cached snapshot while it is fresh, else a new one. `force` ignores the cache entirely. */
  async get(checks: Check[], opts: { force?: boolean } = {}): Promise<Snapshot> {
    const fresh = this.snapshot && this.now() - this.snapshot.at < this.ttlMs;
    if (fresh && !opts.force) return { ...this.snapshot!, cached: true };
    // Two readers arriving together share one run rather than doubling the calls.
    if (this.inFlight && !opts.force) return this.inFlight;
    const run = runAll(checks, this.now).then((s) => {
      this.snapshot = s;
      this.inFlight = null;
      return s;
    }, (e) => {
      this.inFlight = null;
      throw e;
    });
    this.inFlight = run;
    return run;
  }

  /** How old the held snapshot is, for "last checked" on the page. */
  ageMs() {
    return this.snapshot ? this.now() - this.snapshot.at : null;
  }

  clear() { this.snapshot = null; this.inFlight = null; }
}

/** The one the page uses. A module-level instance is what makes the cache per instance. */
export const statusCache = new StatusCache();

/** "4 minutes ago", for the line under the table. */
export function agoWords(ms: number | null): string {
  if (ms == null) return "not yet";
  const s = Math.round(ms / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** The worst state present, for a one-line summary at the top. */
export function overall(results: Record<string, Result>): State {
  const order: State[] = ["down", "attention", "unknown", "not-configured", "ok"];
  for (const s of order) {
    if (Object.values(results).some((r) => r.state === s)) return s;
  }
  return "ok";
}
