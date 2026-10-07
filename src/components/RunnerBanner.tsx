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
 * this appears for exactly two things: the runner is not working, or its token expires within the
 * fortnight.
 */
export type RunnerWarning = { kind: "down" | "expiring"; detail: string } | null;

export default function RunnerBanner({ warning }: { warning: RunnerWarning }) {
  if (!warning) return null;
  return (
    <p className="workspace-alert error ui" role="alert" style={{ display: "block" }}>
      <strong>
        {warning.kind === "down"
          ? "The intake runner is not working."
          : "The intake runner's token is about to expire."}
      </strong>{" "}
      {warning.detail}{" "}
      <Link href="/admin/status">See the status page</Link> for what this does and does not cover.
    </p>
  );
}
