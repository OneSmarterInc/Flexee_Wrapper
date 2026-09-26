import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import RosterImport from "@/components/RosterImport";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/import`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Import roster</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Upload a class-list CSV. Extra columns and blank rows are ignored; correct the column
        mapping if the guesses are wrong, then review before adding. Students already signed up
        are enrolled immediately; the rest are invited and enrol on first sign-in.
      </p>
      <RosterImport sectionId={section} />
    </main>
  );
}
