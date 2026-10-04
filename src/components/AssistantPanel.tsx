"use client";
import { useRef, useState } from "react";

/**
 * The student's assistant panel (Spec 20 §6).
 *
 * It is a form and a list: a textarea, a button, and the turns so far. That is deliberate —
 * everything works from the keyboard because nothing here is a custom control, and each new answer
 * is announced because the turn list is a polite live region.
 *
 * The answer arrives as text and a list of citations. The text is rendered as text, never as
 * markup: `src/lib/assistant/answer.ts` has already reduced any link a model wrote to its own
 * words, and the citations below are built from addresses the server checked against this class's
 * own book.
 */

export type Citation = { entryId: string; anchor: string | null; label: string; href: string };
type Turn =
  | { role: "student"; body: string }
  | { role: "assistant"; body: string; citations: Citation[]; offerInstructor: boolean };

export default function AssistantPanel({
  bookId, notice, threadId: initialThread, assignmentId,
}: { bookId: string; notice: string; threadId?: string; assignmentId?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [threadId, setThreadId] = useState(initialThread);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setTurns((t) => [...t, { role: "student", body: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookId, question: q, threadId, assignmentId }),
      });
      if (!res.ok) {
        setTurns((t) => [...t, { role: "assistant", body: "The assistant is not available just now.", citations: [], offerInstructor: false }]);
        return;
      }
      const j = await res.json();
      if (!j.ok) {
        setTurns((t) => [...t, { role: "assistant", body: j.message, citations: [], offerInstructor: false }]);
        return;
      }
      setThreadId(j.threadId);
      setTurns((t) => [...t, { role: "assistant", body: j.text, citations: j.citations ?? [], offerInstructor: !!j.offerInstructor }]);
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  async function askInstructor() {
    if (!threadId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/instructor", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      if (res.ok) setAsked(true);
    } finally { setBusy(false); }
  }

  return (
    <section className="assistant ui" aria-labelledby="assistant-heading">
      <h2 id="assistant-heading">Ask about this book</h2>
      <p className="assistant-notice">{notice}</p>

      <ol className="assistant-turns" aria-live="polite" aria-label="Conversation">
        {turns.map((turn, i) => (
          <li key={i} className={turn.role === "student" ? "assistant-mine" : "assistant-theirs"}>
            <span className="assistant-who">{turn.role === "student" ? "You asked" : "Assistant"}</span>
            {/* Text, as text. Nothing from a model is ever parsed as markup. */}
            <p>{turn.body}</p>
            {turn.role === "assistant" && turn.citations.length > 0 && (
              <nav aria-label="Where this came from">
                <span className="assistant-who">In the book</span>
                <ul>
                  {turn.citations.map((c) => (
                    <li key={c.href}><a href={c.href}>{c.label}</a></li>
                  ))}
                </ul>
              </nav>
            )}
            {turn.role === "assistant" && turn.offerInstructor && !asked && (
              <button type="button" className="nav-button ghost" onClick={askInstructor} disabled={busy || !threadId}>
                Ask your instructor
              </button>
            )}
          </li>
        ))}
      </ol>
      {asked && <p role="status">Your instructor has been sent this conversation. They will reply here.</p>}

      <form onSubmit={send}>
        <label htmlFor="assistant-question">Your question</label>
        <textarea
          id="assistant-question" ref={box} rows={3} maxLength={1000} value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What does the book say about…?"
        />
        <div className="assistant-actions">
          <button type="submit" className="nav-button primary" disabled={busy || !question.trim()}>
            {busy ? "Asking…" : "Ask"}
          </button>
          <span className="assistant-hint">It answers from this book only, and it will not discuss the chapters&apos; review questions.</span>
        </div>
      </form>
    </section>
  );
}
