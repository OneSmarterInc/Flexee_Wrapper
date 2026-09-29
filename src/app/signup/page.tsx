import Link from "next/link";
import { signup } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Create an account</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Use one account for learning or teaching. An administrator adds faculty and students to classes.</p>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      <form action={signup} className="ui" style={{ display: "grid", gap: ".7rem" }}>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <input name="name" placeholder="Your name" required style={fieldStyle} />
        <input name="email" type="email" placeholder="Email" required style={fieldStyle} />
        <input name="password" type="password" placeholder="Password (8+ characters)" required minLength={8} style={fieldStyle} />
        <button type="submit" style={btnStyle}>Create account</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", marginTop: "1rem" }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
const fieldStyle = { padding: ".6rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const btnStyle = { padding: ".6rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" } as const;
