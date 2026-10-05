import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { getSyllabus } from "@/lib/course";
import { setSyllabusAction } from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import { classPageTitle } from "@/lib/page-title";
export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ section: string }> }) =>
  classPageTitle("Syllabus", params);


export default async function Syllabus({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/syllabus`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const [syl, sp] = await Promise.all([getSyllabus(section), searchParams]);
  return (
    <main id="main" className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Syllabus</h1>
      {sp.saved && <p className="ui" style={{ color: "var(--ok)" }}>Saved.</p>}
      <form action={setSyllabusAction} className="ui" style={{ display: "grid", gap: ".6rem" }}>
        <input type="hidden" name="sectionId" value={section} />
        <textarea name="content" rows={18} defaultValue={syl?.content ?? ""} placeholder="Course syllabus — policies, grading, schedule overview…" style={{ padding: ".7rem", border: "1px solid var(--rule)", borderRadius: "8px", background: "var(--panel)", color: "var(--ink)", font: "inherit", lineHeight: 1.5 }} />
        <button type="submit" className="nav-button primary">Save syllabus</button>
      </form>
    </main>
  );
}
