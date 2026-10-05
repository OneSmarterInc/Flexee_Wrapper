import Link from "next/link";
import { login } from "@/app/actions";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };


export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; reset?: string; verified?: string }> }) {
  const sp = await searchParams;
  return (
    <main id="main" className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Sign in</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>One sign-in for students, faculty, and administrators. Your class or administrator role opens the right portal.</p>
      {/* Spec 21 rule 7: the error is announced, and both boxes point at it, so a screen reader
          reads it on reaching the field rather than only at the top of the page. */}
      {sp.error && <p className="ui" id="form-error" role="alert" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      {sp.reset && <p className="ui" role="status" style={{ color: "var(--ok)" }}>Password updated — sign in with your new password.</p>}
      {sp.verified && <p className="ui" role="status" style={{ color: "var(--ok)" }}>Email confirmed.</p>}
      <form action={login} className="ui" style={{ display: "grid", gap: ".7rem" }}>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="field-stack">Email
          <input name="email" type="email" required autoComplete="username" style={fieldStyle}
            aria-describedby={sp.error ? "form-error" : undefined} />
        </label>
        <label className="field-stack">Password
          <input name="password" type="password" required autoComplete="current-password" style={fieldStyle}
            aria-describedby={sp.error ? "form-error" : undefined} />
        </label>
        <button type="submit" className="nav-button primary">Sign in</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}>
        New here? <Link href="/signup">Create an account</Link> · <Link href="/forgot">Forgot password?</Link>
      </p>
    </main>
  );
}
const fieldStyle = { padding: ".6rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
