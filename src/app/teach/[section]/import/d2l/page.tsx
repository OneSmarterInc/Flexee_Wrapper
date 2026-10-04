import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { classById } from "@/lib/admin";
import { canImport, emailDomain } from "@/lib/d2l-import";
import D2LImport from "@/components/D2LImport";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function ImportFromD2L({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/import/d2l`)}`);
  if (!(await canImport(user!.id, section))) redirect("/faculty");
  const sec = await classById(section);
  if (!sec) redirect("/faculty");
  return (
    <main className="catalog">
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Import from D2L</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        Export the class list from D2L and upload it here. Nothing is written until you confirm:
        the file is read in your browser, counted against this class, and never stored.
        Each student&apos;s address is their <code>UserName</code> plus <code>@{emailDomain()}</code>,
        and each account is created with no password — students choose their own by following the
        link you send them. Only rows whose role is <strong>Student</strong> are imported.
      </p>
      <D2LImport sectionId={section} />
    </main>
  );
}
