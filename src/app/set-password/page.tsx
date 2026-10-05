import Link from "next/link";
import { setPasswordAction } from "@/app/actions";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Set your password" };

const field = { padding: ".6rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

// Where a set-your-password invitation lands. The same page reports an expired or already-used
// link, and points at Forgot password, which is the remedy the invitation email names.
export default async function SetPassword({ searchParams }: { searchParams: Promise<{ token?: string; error?: string; expired?: string }> }) {
  const sp = await searchParams;
  const dead = sp.expired === "1";
  return (
    <main id="main" className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Choose your password</h1>
      {dead ? (
        <>
          <p className="ui" role="alert" style={{ color: "var(--danger)" }}>That link has expired or has already been used.</p>
          <p className="ui" style={{ color: "var(--muted)" }}>
            Use <Link href="/forgot">Forgot password</Link> with your university email and we will send you a new one.
          </p>
        </>
      ) : (
        <>
          <p className="ui" style={{ color: "var(--muted)" }}>Set the password you will use to sign in. This link works once.</p>
          {sp.error && <p className="ui" id="form-error" role="alert" style={{ color: "var(--danger)" }}>{sp.error}</p>}
          <form action={setPasswordAction} className="ui" style={{ display: "grid", gap: ".7rem" }}>
            <input type="hidden" name="token" value={sp.token ?? ""} />
            <label className="field-stack">New password, at least 8 characters
              <input name="password" type="password" required minLength={8} autoComplete="new-password" style={field}
                aria-describedby={sp.error ? "form-error" : undefined} />
            </label>
            <button type="submit" className="nav-button primary">Set password and sign in</button>
          </form>
        </>
      )}
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}><Link href="/login">Back to sign in</Link></p>
    </main>
  );
}
