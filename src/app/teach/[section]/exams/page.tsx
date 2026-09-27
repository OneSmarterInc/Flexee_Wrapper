import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { examsForSection, questionCounts } from "@/lib/assessment";
import { createExamAction, examStatusAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const field = { padding: ".5rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;
const cell = { border: "1px solid var(--rule)", padding: ".45rem .7rem", textAlign: "left" } as const;

export default async function Exams({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/exams`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [list, counts] = await Promise.all([examsForSection(section), questionCounts(sec.bookId)]);

  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Exams</h1>

      <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead><tr><th style={cell}>Title</th><th style={cell}>Blueprint</th><th style={cell}>Status</th><th style={cell}></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td style={cell} colSpan={4}>No exams yet.</td></tr>}
          {list.map((e) => {
            const bp = JSON.parse(e.blueprintJson);
            const summary = bp.mode === "draw" ? bp.rules.map((r: any) => `${r.count} × ch${r.chapter} (${r.difficulty})`).join(", ") : `${bp.ids.length} fixed`;
            return (
              <tr key={e.id}>
                <td style={cell}><Link href={`/teach/${section}/exams/${e.id}`}>{e.title}</Link></td>
                <td style={cell}>{summary}</td>
                <td style={cell}>{e.status}</td>
                <td style={cell}>
                  <form action={examStatusAction} style={{ display: "inline" }}>
                    <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="examId" value={e.id} />
                    <input type="hidden" name="status" value={e.status === "open" ? "closed" : "open"} />
                    <button style={{ border: "none", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit" }}>
                      {e.status === "open" ? "Close" : "Open"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ color: "var(--navy)", marginTop: "2rem" }}>New exam</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        Bank: {counts.total} questions across chapter{counts.chapters.length === 1 ? "" : "s"} {counts.chapters.join(", ") || "—"}.
      </p>
      <form action={createExamAction} className="ui" style={{ display: "grid", gap: ".6rem", maxWidth: "30rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input name="title" placeholder="Exam title" required style={field} />
        <div style={{ display: "flex", gap: ".5rem" }}>
          <select name="chapter" style={{ ...field, flex: 1 }}>
            {counts.chapters.map((c) => <option key={c} value={c}>Chapter {c}</option>)}
          </select>
          <select name="difficulty" style={{ ...field, flex: 1 }}>
            <option value="any">any difficulty</option><option value="recall">recall</option>
            <option value="apply">apply</option><option value="analyse">analyse</option>
          </select>
          <input name="count" type="number" min={1} defaultValue={5} style={{ ...field, width: "5rem" }} title="How many questions" />
        </div>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <select name="feedback" style={{ ...field, flex: 1 }} title="When students see answers">
            <option value="after_close">feedback after close</option>
            <option value="immediate">feedback immediately</option>
          </select>
          <input name="attemptLimit" type="number" min={1} defaultValue={1} style={{ ...field, width: "6rem" }} title="Attempts allowed" />
        </div>
        <button type="submit" style={{ ...field, cursor: "pointer", background: "var(--navy)", color: "#fff", border: "none" }}>Create exam (draft)</button>
      </form>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: ".6rem" }}>
        A draw serves a random selection per student. Create as a draft, then open it when the class is ready.
      </p>
    </main>
  );
}
