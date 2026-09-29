import Link from "next/link";
import { login } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; reset?: string; verified?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Sign in</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>One sign-in for students, faculty, and administrators. Your class or administrator role opens the right portal.</p>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {sp.reset && <p className="ui" style={{ color: "#2a7d3f" }}>Password updated — sign in with your new password.</p>}
      {sp.verified && <p className="ui" style={{ color: "#2a7d3f" }}>Email confirmed.</p>}
      <form action={login} className="ui" style={{ display: "grid", gap: ".7rem" }}>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <input name="email" type="email" placeholder="Email" required style={fieldStyle} />
        <input name="password" type="password" placeholder="Password" required style={fieldStyle} />
        <button type="submit" style={btnStyle}>Sign in</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}>
        New here? <Link href="/signup">Create an account</Link> · <Link href="/forgot">Forgot password?</Link>
      </p>
    </main>
  );
}
const fieldStyle = { padding: ".6rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const btnStyle = { padding: ".6rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" } as const;
