import Link from "next/link";
import { redirect } from "next/navigation";
import { listBooks } from "@/lib/content";
import { currentUser } from "@/lib/auth";
import { userEnrolments } from "@/lib/enrolment";
import { enroll, enrollByCodeAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";
const field = { padding: ".45rem .6rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; need?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [books, enrol, sp] = await Promise.all([listBooks(), userEnrolments(user!.id), searchParams]);
  const enrolled = new Set(enrol.map((e) => e.bookId));

  return (
    <main className="catalog">
      <LogoutButton />
      <h1>Flexee Reader</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Signed in as {user!.displayName} · <Link href="/teach">Teaching</Link>
      </p>
      {sp.error && <p className="ui" style={{ color: "#b4451f" }}>{sp.error}</p>}
      {sp.need && <p className="ui" style={{ color: "#b4451f" }}>Enroll to open that book.</p>}

      <form action={enrollByCodeAction} className="ui" style={{ display: "flex", gap: ".5rem", margin: "1rem 0 2rem" }}>
        <input name="code" placeholder="Join a section with a code" style={field} />
        <button type="submit" style={{ ...field, cursor: "pointer", color: "var(--link)", borderColor: "var(--link)", background: "transparent" }}>Join</button>
      </form>

      {books.map((b) => (
        <div key={b.id} className="book-card">
          <div className="t">{b.title}</div>
          <div className="s">{b.subtitle ?? ""}</div>
          <div className="ui" style={{ marginTop: ".8rem" }}>
            {enrolled.has(b.id) ? (
<><Link href={`/${b.id}`}>Open →</Link> · <Link href={`/${b.id}/exams`}>Exams</Link></>
            ) : (
              <form action={enroll} style={{ display: "inline" }}>
                <input type="hidden" name="bookId" value={b.id} />
                <button type="submit" style={{ padding: ".35rem .8rem", border: "1px solid var(--link)", borderRadius: "6px", background: "transparent", color: "var(--link)", cursor: "pointer", font: "inherit" }}>Enroll</button>
              </form>
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
