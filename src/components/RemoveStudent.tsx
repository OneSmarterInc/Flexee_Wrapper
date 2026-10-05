"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The guarded Remove (Spec 19 §1, decisions 6 and 8).
 *
 * Until this, Remove was a submit button that deleted a student's exam attempts, submissions and
 * grades on one click with no warning. Now it asks the server what the removal would cost, shows
 * those numbers, and — when attempts, submissions or scores exist — makes the person type a phrase
 * before it will go through. A student with no records keeps the one-click path, behind a plain
 * confirmation, and so does a member of staff.
 *
 * The dialog is a real `<dialog>` element: `showModal()` gives focus containment and Escape for
 * free, which is what rule 11 asks for and what a hand-rolled overlay usually gets wrong.
 */

export type Cost = {
  attempts: number; submissions: number; scores: number;
  bookmarks: number; threads: number;
  simCompletions: number; simLaunches: number; simTranscripts: number;
};

export default function RemoveStudent({
  sectionId, enrolmentId, name, role, phrase, back,
}: {
  sectionId: string; enrolmentId: string; name: string;
  role: "student" | "instructor"; phrase: string; back: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cost, setCost] = useState<Cost | null>(null);
  const [sentence, setSentence] = useState("");
  const [needsTyping, setNeedsTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const clear = () => { setTyped(""); setError(""); };
    d.addEventListener("close", clear);
    return () => d.removeEventListener("close", clear);
  }, []);

  async function open() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/class/removal-cost?section=${encodeURIComponent(sectionId)}&enrolment=${encodeURIComponent(enrolmentId)}`);
      if (!res.ok) { setError("Could not check what this would delete."); return; }
      const j = await res.json();
      setCost(j.cost ?? null);
      setSentence(j.sentence ?? "");
      setNeedsTyping(!!j.needsTyping);
      dialog.current?.showModal();
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/class/remove", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId, enrolmentIds: [enrolmentId], confirm: typed }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setError(j?.error ?? "Could not remove that student."); return; }
      dialog.current?.close();
      window.location.assign(back);
    } finally { setBusy(false); }
  }

  const lines: [string, number][] = cost ? [
    ["Exam attempts", cost.attempts],
    ["Submissions", cost.submissions],
    ["Grades", cost.scores],
    ["Reading position", cost.bookmarks],
    ["Assistant conversations", cost.threads],
    ["Simulation completions", cost.simCompletions],
    ["Simulation launches", cost.simLaunches],
    ["Simulation transcripts", cost.simTranscripts],
  ] : [];
  const nothing = cost && lines.every(([, v]) => v === 0);

  return (
    <>
      <button type="button" onClick={open} disabled={busy} style={linkBtn}>
        {busy && !cost ? "Checking…" : "Remove"}
      </button>
      <dialog ref={dialog} className="ui fx-dialog" aria-labelledby={`rm-h-${enrolmentId}`}>
        <h2 id={`rm-h-${enrolmentId}`}>Remove {name}?</h2>
        {role === "instructor" ? (
          <p>They lose access to this class. Nothing they created in it is deleted.</p>
        ) : nothing ? (
          <p>They have no work in this class, so nothing is deleted. They lose access to it.</p>
        ) : (
          <>
            <p>{sentence}</p>
            <table>
              <caption>What would be deleted</caption>
              <tbody>
                {lines.filter(([, v]) => v > 0).map(([label, v]) => (
                  <tr key={label}><th scope="row">{label}</th><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <p><strong>This cannot be undone.</strong> To keep their work, withdraw them instead.</p>
          </>
        )}
        {needsTyping && (
          <p>
            <label htmlFor={`rm-t-${enrolmentId}`}>Type <code>{phrase}</code> to confirm</label>
            <input id={`rm-t-${enrolmentId}`} value={typed} onChange={(e) => setTyped(e.target.value)}
              autoComplete="off" spellCheck={false} />
          </p>
        )}
        {error && <p role="alert" className="fx-dialog-error">{error}</p>}
        <div className="fx-dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()} className="nav-button ghost">Cancel</button>
          <button type="button" onClick={remove} className="nav-button danger"
            disabled={busy || (needsTyping && typed.trim().toLowerCase() !== phrase)}>
            {busy ? "Removing…" : nothing || role === "instructor" ? "Remove" : "Delete the records and remove"}
          </button>
        </div>
      </dialog>
    </>
  );
}

const linkBtn = { border: "none", background: "transparent", color: "#b4451f", cursor: "pointer", font: "inherit", padding: 0 } as const;
