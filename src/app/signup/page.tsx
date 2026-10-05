import Link from "next/link";
import { signup } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; sent?: string; exists?: string }> }) {
  const sp = await searchParams;
  // Spec 17: an address that already belongs to an account made by the import gets a
  // set-your-password link and this neutral line — never a dead end, and never a hint about
  // whether that account exists.
  if (sp.sent) {
    return (
      <main className="catalog" style={{ maxWidth: "24rem" }}>
        <h1>Check your email</h1>
        <p className="ui">{sp.sent}</p>
        <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}><Link href="/login">Back to sign in</Link></p>
      </main>
    );
  }
  return (
    <main className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Create an account</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Use one account for learning or teaching. An administrator adds faculty and students to classes.</p>
      {sp.error && <p className="ui" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      {sp.exists && (
        <p className="ui" style={{ color: "var(--muted)" }}>
          <Link href="/login">Sign in</Link> instead, or use <Link href="/forgot">Forgot password</Link> if you cannot remember it.
        </p>
      )}
      <form action={signup} className="ui" style={{ display: "grid", gap: ".7rem" }}>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <input name="name" placeholder="Your name" required style={fieldStyle} />
        <input name="email" type="email" placeholder="Email" required style={fieldStyle} />
        <input name="password" type="password" placeholder="Password (8+ characters)" required minLength={8} style={fieldStyle} />
        <button type="submit" className="nav-button primary">Create account</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
const fieldStyle = { padding: ".6rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
