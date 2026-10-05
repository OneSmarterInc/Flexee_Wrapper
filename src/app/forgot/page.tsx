import Link from "next/link";
import { forgotAction } from "@/app/actions";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reset your password" };

const field = { padding: ".6rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Forgot({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const sp = await searchParams;
  return (
    <main id="main" className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Reset password</h1>
      {sp.sent ? (
        <p className="ui" style={{ color: "var(--muted)" }}>If an account exists for that email, we&apos;ve sent a reset link. Check your inbox.</p>
      ) : (
        <form action={forgotAction} className="ui" style={{ display: "grid", gap: ".7rem" }}>
          <label className="field-stack">Your email
            <input name="email" type="email" required autoComplete="username" style={field} />
          </label>
          <button type="submit" className="nav-button primary">Send reset link</button>
        </form>
      )}
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}><Link href="/login">Back to sign in</Link></p>
    </main>
  );
}
