import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { emailStatus } from "@/lib/recovery";
import { changeEmailAction, resendVerifyAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account settings" };

const field = { padding: ".6rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Account({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; verified?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");
  const [s, sp] = await Promise.all([emailStatus(user!.id), searchParams]);
  return (
    <main id="main" className="catalog" style={{ maxWidth: "28rem" }}>
      <LogoutButton />
      <p className="ui"><Link href="/">&larr; Home</Link></p>
      <h1>Your account</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Signed in as {user!.displayName}.</p>
      {sp.verified && <p className="ui" role="status" style={{ color: "var(--ok)" }}>Email confirmed.</p>}
      {sp.sent && <p className="ui" style={{ color: "var(--muted)" }}>Check your inbox for a confirmation link.</p>}
      {sp.error && <p className="ui" id="form-error" role="alert" style={{ color: "var(--danger)" }}>{sp.error}</p>}

      {s && (
        <div className="book-card ui">
          <div className="t" style={{ fontSize: "1rem" }}>{s.email}</div>
          <div className="s">{s.verified ? "Email confirmed" : "Email not yet confirmed"}</div>
          {!s.verified && (
            <form action={resendVerifyAction} style={{ marginTop: ".6rem" }}>
              <button type="submit" style={{ ...field, cursor: "pointer", color: "var(--link)", borderColor: "var(--link)", background: "transparent" }}>Resend confirmation</button>
            </form>
          )}
        </div>
      )}

      <h2 style={{ color: "var(--navy)", marginTop: "1.4rem" }}>Change email</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>If you signed up with a typo, correct it here &mdash; we&apos;ll send a new confirmation.</p>
      <form action={changeEmailAction} className="ui" style={{ display: "flex", gap: ".5rem" }}>
        <label className="field-stack" style={{ flex: 1 }}>New email
          <input name="email" type="email" required autoComplete="email" style={field}
            aria-describedby={sp.error ? "form-error" : undefined} />
        </label>
        <button type="submit" className="nav-button primary">Update</button>
      </form>
    </main>
  );
}
