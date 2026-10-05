import { resetAction } from "@/app/actions";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Choose a new password" };

const field = { padding: ".6rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main id="main" className="catalog" style={{ maxWidth: "24rem" }}>
      <h1>Set a new password</h1>
      {sp.error && <p className="ui" id="form-error" role="alert" style={{ color: "var(--danger)" }}>{sp.error}</p>}
      <form action={resetAction} className="ui" style={{ display: "grid", gap: ".7rem" }}>
        <input type="hidden" name="token" value={sp.token ?? ""} />
        <label className="field-stack">New password, at least 8 characters
          <input name="password" type="password" required minLength={8} autoComplete="new-password" style={field}
            aria-describedby={sp.error ? "form-error" : undefined} />
        </label>
        <button type="submit" className="nav-button primary">Set password</button>
      </form>
    </main>
  );
}
