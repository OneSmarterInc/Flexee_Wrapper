import Link from "next/link";

/**
 * Spec 24 §2: the warning that follows an administrator about.
 *
 * Shown on the Library page and the Administration dashboard, **admins only** (decision 6). The
 * Library page is open to any instructor, and faculty are not shown this: it names an
 * infrastructure problem they cannot fix, and if an upload does fail they already get the message
 * Spec 22 wrote, which tells them what to do.
 *
 * A banner that appears for a condition nobody can act on is a banner people learn to ignore, so
 * this appears for exactly two things: the intake is not working, or something about it needs an
 * administrator (a GitHub token expiring within the fortnight; a worker that has stopped
 * reporting).
 *
 * Spec 28 commit 11: the headline arrives with the warning rather than being chosen here from the
 * `kind`. There are now two things that can run an intake — a GitHub workflow and a systemd unit
 * on the box — and `runnerWarning` is where which one is known. This component had hard-coded
 * "the intake runner's token is about to expire", a sentence about a token that does not exist on
 * the box.
 */
export type RunnerWarning = { kind: "down" | "expiring"; headline: string; detail: string } | null;

export default function RunnerBanner({ warning }: { warning: RunnerWarning }) {
  if (!warning) return null;
  return (
    <p className="workspace-alert error ui" role="alert" style={{ display: "block" }}>
      <strong>{warning.headline}</strong>{" "}
      {warning.detail}{" "}
      <Link href="/admin/status">See the status page</Link> for what this does and does not cover.
    </p>
  );
}
