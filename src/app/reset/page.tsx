import { resetAction } from "@/app/actions";
export const dynamic = "force-dynamic";
const field = { padding: ".6rem .7rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Set a new password</h1>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      <form action={resetAction} className="ui" style={{ display: "grid", gap: ".7rem" }}>
        <input type="hidden" name="token" value={sp.token ?? ""} />
        <input name="password" type="password" placeholder="New password (8+ characters)" required minLength={8} style={field} />
        <button type="submit" className="nav-button primary">Set password</button>
      </form>
    </main>
  );
}
