import { publishBookAction, unpublishBookAction, chooseBookAction } from "@/app/class-book-actions";

// The class's book and whether its students can see it. Shown to the class's faculty and to admins.
export default function ClassBookPanel({ sectionId, back, bookId, published, publishedAt, library }: {
  sectionId: string; back: string; bookId: string; published: boolean; publishedAt: Date | null;
  library: { id: string; title: string }[];
}) {
  const title = library.find((b) => b.id === bookId)?.title ?? bookId;
  const box = { border: "1px solid var(--rule)", borderRadius: "8px", padding: ".9rem 1rem", margin: "1rem 0" } as const;
  const field = { padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
  return (
    <div className="ui" style={box}>
      <div className="s" style={{ color: "var(--muted)" }}>Book</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <strong>{title}</strong>{" "}
          {published
            ? <span style={{ color: "var(--navy)" }}>· Published{publishedAt ? ` ${publishedAt.toISOString().slice(0, 10)}` : ""} — students can read it</span>
            : <span style={{ color: "#b4451f" }}>· Not published — students cannot see it yet</span>}
        </div>
        <form action={published ? unpublishBookAction : publishBookAction}>
          <input type="hidden" name="sectionId" value={sectionId} />
          <input type="hidden" name="back" value={back} />
          <button className={`nav-button ${published ? "ghost" : "primary"}`} type="submit">
            {published ? "Unpublish" : "Publish to this class"}
          </button>
        </form>
      </div>
      {!published && library.length > 1 && (
        <form action={chooseBookAction} style={{ display: "flex", gap: ".5rem", marginTop: ".7rem", flexWrap: "wrap" }}>
          <input type="hidden" name="sectionId" value={sectionId} />
          <input type="hidden" name="back" value={back} />
          <select name="bookId" defaultValue={bookId} style={field}>
            {library.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
          <button className="nav-button secondary" type="submit">Use this book</button>
        </form>
      )}
    </div>
  );
}
