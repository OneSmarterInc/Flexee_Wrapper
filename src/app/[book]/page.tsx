import Link from "next/link";
import { redirect } from "next/navigation";
import { getBook, getEntry } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook, getBookmark } from "@/lib/enrolment";
import { listAnnouncements, upcoming, getSyllabus } from "@/lib/course";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function CourseHome({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/" + book)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);

  const manifest = await getBook(book);
  const bm = await getBookmark(enr.id, book);
  let entry = manifest.defaultEntry;
  if (bm) { try { await getEntry(book, bm.entryId); entry = bm.entryId; } catch {} }
  const resumeHref = `/${book}/${entry}${bm?.sectionAnchor ? `#${bm.sectionAnchor}` : ""}`;

  const [ann, due, syl] = await Promise.all([listAnnouncements(enr.sectionId), upcoming(enr.sectionId, 5), getSyllabus(enr.sectionId)]);

  return (
    <main className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <h1>{manifest.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>{manifest.subtitle ?? ""}</p>
      <Link href={resumeHref}>
        <div className="book-card" style={{ borderColor: "var(--link)" }}>
          <div className="t">{bm ? "Continue reading →" : "Start reading →"}</div>
          <div className="s">{bm ? "Pick up where you left off" : "Open the book"}</div>
        </div>
      </Link>

      {due.length > 0 && (
        <>
          <h2 style={{ color: "var(--navy)", marginTop: "1.4rem" }}>What's due</h2>
          <ul className="ui" style={{ listStyle: "none", padding: 0 }}>
            {due.map((d) => (
              <li key={d.id} style={{ borderBottom: "1px solid var(--rule)", padding: ".4rem 0" }}>
                <strong>{d.dueAt ? new Date(d.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</strong>
                {"  "}{d.title}{d.kind ? <span style={{ color: "var(--muted)" }}> · {d.kind}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 style={{ color: "var(--navy)", marginTop: "1.4rem" }}>Announcements</h2>
      {ann.length === 0 ? <p className="ui" style={{ color: "var(--muted)" }}>Nothing yet.</p> : ann.slice(0, 5).map((a) => (
        <div key={a.id} className="book-card">
          <div className="t" style={{ fontSize: "1.02rem" }}>{a.title}</div>
          <div className="s ui" style={{ marginBottom: ".3rem" }}>{new Date(a.createdAt).toLocaleDateString()}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>
        </div>
      ))}

      {syl?.content && (
        <details style={{ marginTop: "1.4rem" }}>
          <summary className="ui" style={{ cursor: "pointer", color: "var(--navy)", fontWeight: 600 }}>Syllabus</summary>
          <div style={{ whiteSpace: "pre-wrap", marginTop: ".6rem" }}>{syl.content}</div>
        </details>
      )}
    </main>
  );
}
