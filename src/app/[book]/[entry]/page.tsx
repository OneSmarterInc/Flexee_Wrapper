import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBook, neighbours } from "@/lib/content";
import { resolveEntryForSection } from "@/lib/versions";
import { renderEntry } from "@/lib/render";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import Spine from "@/components/Spine";
import ProgressBar from "@/components/ProgressBar";
import Bookmarker from "@/components/Bookmarker";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ book: string; entry: string }> }) {
  const { book, entry } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${book}/${entry}`)}`);
  const enr = await enrolmentForBook(user!.id, book);
  if (!enr) redirect(`/?need=${book}`);

  let data;
  try {
    data = await resolveEntryForSection(enr.sectionId, book, entry);
  } catch {
    notFound();
  }
  const { manifest, markdown } = data!;
  const bookManifest = await getBook(book);
  const html = await renderEntry(markdown, manifest, `/api/asset/${book}/${entry}`);
  const { prev, next } = neighbours(bookManifest, entry);

  return (
    <>
      <ProgressBar />
      <LogoutButton />
      <Bookmarker bookId={book} entryId={entry} chapterVersion={manifest.version} />
      <div className="shell">
        <Spine bookId={book} current={entry} />
        <main className="reading">
          <div className="reading-inner">
            <div className="reader-toolbar ui">
              <BackButton fallbackHref={`/${book}`} />
              <Link className="nav-button ghost" href={`/${book}`}>Course home</Link>
              <Link className="nav-button secondary" href={`/${book}/exams`}>Exams</Link>
            </div>
            <article>
              {manifest.sections.length > 1 && (
                <nav className="sections" aria-label="In this chapter">
                  <h2>In this chapter</h2>
                  <ol>
                    {manifest.sections.map((s) => (
                      <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
                    ))}
                  </ol>
                </nav>
              )}
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </article>
            <nav className="entry-nav ui">
              {prev ? (
                <Link className="prev" href={`/${book}/${prev}`}><span className="dir">Previous</span><span className="t">Back</span></Link>
              ) : <span />}
              {next ? (
                <Link className="next" href={`/${book}/${next}`}><span className="dir">Next</span><span className="t">Continue</span></Link>
              ) : <span />}
            </nav>
          </div>
        </main>
      </div>
    </>
  );
}
