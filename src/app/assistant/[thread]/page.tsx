import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { messagesFor, threadFor } from "@/lib/assistant/store";
import { formatLocal } from "@/lib/time";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

/**
 * One conversation (Spec 20 §3). Readable by the student who owns it and the class's faculty, and
 * by nobody else — `threadFor` decides, and this page has no opinion of its own.
 *
 * The email a faculty reply triggers links here, which is why it exists as a page rather than only
 * as a panel.
 */
export default async function Thread({ params }: { params: Promise<{ thread: string }> }) {
  const { thread } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/assistant/${thread}`)}`);
  const t = await threadFor(user!.id, thread);
  if (!t) notFound();
  const messages = await messagesFor(thread);

  return (
    <main className="catalog" style={{ maxWidth: "44rem" }}>
      <LogoutButton />
      <p className="ui">
        <Link href={t.as === "faculty" ? `/teach/${t.sectionId}/assistant` : "/student"}>
          ← {t.as === "faculty" ? "Class assistant" : "My classes"}
        </Link>
      </p>
      <h1>{t.title}</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        {t.as === "faculty"
          ? "A student's conversation with the assistant, and your replies."
          : "Your conversation with the assistant. Your instructor can see it."}
      </p>
      <ol className="assistant-turns ui" aria-label="Conversation">
        {messages.map((m) => (
          <li key={m.id} className={m.role === "student" ? "assistant-mine" : "assistant-theirs"}>
            <span className="assistant-who">
              {m.role === "student" ? "Question" : m.role === "instructor" ? "Your instructor" : "Assistant"}
              {" · "}{formatLocal(m.createdAt)}
            </span>
            {/* Stored text, shown as text. */}
            <p>{m.body}</p>
            {m.citations.length > 0 && (
              <nav aria-label="Where this came from">
                <span className="assistant-who">In the book</span>
                <ul>{m.citations.map((c) => <li key={c.href}><a href={c.href}>{c.label}</a></li>)}</ul>
              </nav>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
