import { cookies } from "next/headers";
import { verifyDeepLinkState } from "@/lib/lti";
import { listBooks } from "@/lib/content";
export const dynamic = "force-dynamic";
const btn = { padding: ".4rem .9rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" } as const;

export default async function DeepLinkSelect() {
  const dl = (await cookies()).get("lti_dl")?.value;
  let ok = false;
  try { if (dl) { await verifyDeepLinkState(dl); ok = true; } } catch { ok = false; }
  if (!ok) return <main className="catalog"><h1>Choose content</h1><p className="ui" style={{ color: "#b4451f" }}>This page must be opened from your LMS via a deep-linking launch.</p></main>;
  const books = await listBooks();
  return (
    <main className="catalog">
      <h1>Choose a book to add</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>Select the Flexee book to place in this course. It will be added as a link students launch.</p>
      {books.map((b) => (
        <div key={b.id} className="book-card ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div className="t">{b.title}</div><div className="s">{b.subtitle ?? ""}</div></div>
          <form action="/api/lti/deeplink/return" method="post">
            <input type="hidden" name="book" value={b.id} />
            <button type="submit" style={btn}>Add this book</button>
          </form>
        </div>
      ))}
    </main>
  );
}
