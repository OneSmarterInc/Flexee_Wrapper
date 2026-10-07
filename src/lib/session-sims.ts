/**
 * Which RapidSims have live class sessions, and which of those read a class roster.
 *
 * Two lists, not one, and keeping them in one file is the point (Addendum B §2). The old platform
 * had a single `SESSION_SIMS` set used for three different questions, and its own code then
 * disagreed with itself: the set held nine sims including `rapidsimplus-02`, while
 * `session-entry.js`'s titles held only the eight numbered ones, so a session link for +02 was
 * accepted by the launch and refused by the entry page. C2-2 v1.1 §1 settles it — +02 does neither,
 * because it has a facilitator console of its own.
 *
 * SESSION_SIMS: may appear in a `/session.html` invite link and may be launched in session mode.
 * ROSTER_SIMS: of those, the five whose consoles call POST /api/session-enrolments.
 *
 * ROSTER_SIMS is a subset, which is asserted rather than assumed — a sim that could call the roster
 * without being allowed a session would be a hole, since the roster trusts `pass.mode === "session"`.
 */
export const SESSION_SIMS: ReadonlySet<string> = new Set([
  "rapid-03-midland",
  "rapid-04-whose-number",
  "rapid-05-approve",
  "rapid-06-switch",
  "rapid-07-bought",
  "rapid-08-later",
  "rapid-09-money-land",
  "rapid-10-bubble",
]);

/** Sims 03, 04, 05, 08 and 09 — the five with a `lib/course-enrolments.js` in Disaster_New. */
export const ROSTER_SIMS: ReadonlySet<string> = new Set([
  "rapid-03-midland",
  "rapid-04-whose-number",
  "rapid-05-approve",
  "rapid-08-later",
  "rapid-09-money-land",
]);

export const isSessionSim = (simId: unknown) => typeof simId === "string" && SESSION_SIMS.has(simId);
export const isRosterSim = (simId: unknown) => typeof simId === "string" && ROSTER_SIMS.has(simId);

/**
 * The `platform:` prefix on a roster row's participant id.
 *
 * Not decoration, and not ours to rename. Each sim builds the same string itself from the arriving
 * student's pass — `sim03/api/session.js`: ``id = launched ? `platform:${launched.sub}` : …`` — and
 * matches it against the roster row to find them. A different prefix means every launched student
 * fails to match their own row and team assignment silently breaks. C2-2 §2 says so; the sim's code
 * is where it is actually enforced.
 */
export const participantId = (userId: string) => `platform:${userId}`;
