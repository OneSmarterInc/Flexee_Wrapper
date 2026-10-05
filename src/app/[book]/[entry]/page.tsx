import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { neighboursWithTitles } from "@/lib/content";
import { resolveEntryForSection } from "@/lib/versions";
import { renderEntry } from "@/lib/render";
import { currentUser } from "@/lib/auth";
import { enrolmentForBook } from "@/lib/enrolment";
import Spine from "@/components/Spine";
import ProgressBar from "@/components/ProgressBar";
import Bookmarker from "@/components/Bookmarker";
import LogoutButton from "@/components/LogoutButton";
import BackButton from "@/components/BackButton";
import PageTurn from "@/components/PageTurn";
import FigureList from "@/components/FigureList";
import AssistantPanel from "@/components/AssistantPanel";
import { panelFor } from "@/lib/assistant/panel";
import { entryPageTitle } from "@/lib/page-title";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ book: string; entry: string }> }) =>
  entryPageTitle(params);


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
  const { html, figures } = await renderEntry(markdown, manifest, `/api/asset/${book}/${entry}`);
  const { prev, next } = await neighboursWithTitles(book, entry);
  const panel = await panelFor(user!.id, book);

  return (
    <>
      <ProgressBar />
      <LogoutButton />
      <Bookmarker bookId={book} entryId={entry} chapterVersion={manifest.version} />
      <div className="shell">
        <Spine bookId={book} current={entry} />
        <main id="main" className="reading">
          <PageTurn bookId={book} prev={prev} next={next} />
          <div className="reading-inner">
            <div className="reader-toolbar ui">
              <BackButton fallbackHref={`/${book}`} />
              <Link className="nav-button ghost" href={`/${book}`}>Course home</Link>
              {prev
                ? <Link className="nav-button secondary" href={`/${book}/${prev.ref}`} aria-label={`Previous: ${prev.label}`} title={prev.label}>‹ Previous</Link>
                : <span />}
              {next
                ? <Link className="nav-button secondary" href={`/${book}/${next.ref}`} aria-label={`Next: ${next.label}`} title={next.label}>Next ›</Link>
                : <span />}
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
                  <FigureList figures={figures} />
                </nav>
              )}
              {manifest.sections.length <= 1 && <FigureList figures={figures} />}
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </article>
            {panel?.show && <AssistantPanel bookId={book} notice={panel.notice} />}
            {panel && !panel.show && <p className="ui assistant-notice" role="status">{panel.message}</p>}
            <nav className="entry-nav ui">
              {prev ? (
                <Link className="prev" href={`/${book}/${prev.ref}`} aria-label={`Previous: ${prev.label}`}><span className="dir">Previous</span><span className="t">Back</span></Link>
              ) : <span />}
              {next ? (
                <Link className="next" href={`/${book}/${next.ref}`} aria-label={`Next: ${next.label}`}><span className="dir">Next</span><span className="t">Continue</span></Link>
              ) : <span />}
            </nav>
          </div>
        </main>
      </div>
    </>
  );
}
