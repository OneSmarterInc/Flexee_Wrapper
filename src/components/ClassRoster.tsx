"use client";
import { useMemo, useRef, useState } from "react";

/**
 * The class list, with checkboxes and one bar of actions (Spec 19 §1).
 *
 * Faculty managed a class one student at a time: a Remove on each row, a resend per student. A
 * class of thirty with late adds, drops and a failed email needs to be worked on in groups, so the
 * rows live here and the selection with them.
 *
 * Accessibility (rule 11): each checkbox is named for its student, so a screen reader announces
 * "Select Maria Alvarez" rather than "checkbox"; the bar is a live region, so a selection is
 * announced as it changes; select-all covers **the rows shown**, never the ones a filter is
 * hiding; and the confirmation is a real `<dialog>`, which brings focus containment and Escape
 * with it.
 */

export type RosterRow = {
  enrolmentId: string;
  userId: string;
  name: string;
  email: string | null;
  state: string;          // what the Account column reads
  stateKey: "set up" | "invited" | "link copied" | "link expired" | "not sent" | "none" | "demo";
  demo: boolean;
  withdrawn: boolean;
  withdrawnOn: string | null;
};

type Quick = { key: string; label: string; match: (r: RosterRow) => boolean };

export default function ClassRoster({
  sectionId, rows, showWithdrawn, phrase,
}: { sectionId: string; rows: RosterRow[]; showWithdrawn: boolean; phrase: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<{ sentence: string; needsTyping: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // The rows on screen. Select-all and the quick selections both work from this, never from the
  // whole class: a checkbox that picks something the reader cannot see is a trap.
  const visible = useMemo(() => rows.filter((r) => showWithdrawn || !r.withdrawn), [rows, showWithdrawn]);
  const visibleIds = useMemo(() => new Set(visible.map((r) => r.enrolmentId)), [visible]);
  const selected = useMemo(() => visible.filter((r) => picked.has(r.enrolmentId)), [visible, picked]);
  const allShown = visible.length > 0 && selected.length === visible.length;

  const quick: Quick[] = [
    { key: "not-set-up", label: "Not set up", match: (r) => !r.demo && !r.withdrawn && r.stateKey !== "set up" },
    { key: "invited", label: "Invited", match: (r) => r.stateKey === "invited" },
    { key: "demo", label: "Demo", match: (r) => r.demo },
    { key: "withdrawn", label: "Withdrawn", match: (r) => r.withdrawn },
  ];

  const set = (ids: string[]) => setPicked(new Set(ids));
  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function act(action: "resend" | "withdraw" | "restore" | "remove", confirm?: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/class/act", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId, action, enrolmentIds: [...picked].filter((id) => visibleIds.has(id)), confirm }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        if (j?.needsTyping) {
          setPending({ sentence: j.error, needsTyping: true });
          dialog.current?.showModal();
          return;
        }
        setError(j?.error ?? "That did not work.");
        return;
      }
      dialog.current?.close();
      setMessage(j.message ?? "Done.");
      setPicked(new Set());
      // The page's own counts, states and toggles are server-rendered, so a reload is how they
      // come back in step with what just happened.
      window.location.reload();
    } finally { setBusy(false); }
  }

  async function startRemove() {
    setBusy(true); setError("");
    try {
      const q = [...picked].filter((id) => visibleIds.has(id)).map((id) => `enrolment=${encodeURIComponent(id)}`).join("&");
      const res = await fetch(`/api/class/removal-cost?section=${encodeURIComponent(sectionId)}&${q}`);
      if (!res.ok) { setError("Could not check what this would delete."); return; }
      const j = await res.json();
      setPending({ sentence: j.sentence, needsTyping: !!j.needsTyping });
      setTyped("");
      dialog.current?.showModal();
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="roster-bar ui" role="status" aria-live="polite">
        {selected.length === 0
          ? <span className="roster-hint">Select students to act on several at once.</span>
          : (
            <>
              <strong>{selected.length} selected</strong>
              <button type="button" className="nav-button secondary" disabled={busy} onClick={() => act("resend")}>Resend invitation</button>
              <button type="button" className="nav-button secondary" disabled={busy} onClick={() => act("withdraw")}>Withdraw</button>
              <button type="button" className="nav-button secondary" disabled={busy} onClick={() => act("restore")}>Restore</button>
              <button type="button" className="nav-button danger" disabled={busy} onClick={startRemove}>Remove…</button>
              <button type="button" className="nav-button ghost" disabled={busy} onClick={() => set([])}>Clear</button>
            </>
          )}
      </div>
      <div className="roster-quick ui">
        <span className="roster-hint">Select:</span>
        {quick.map((q) => {
          const ids = visible.filter(q.match).map((r) => r.enrolmentId);
          return (
            <button key={q.key} type="button" className="nav-button ghost" disabled={!ids.length}
              onClick={() => set(ids)}>{q.label} ({ids.length})</button>
          );
        })}
      </div>
      {message && <p className="ui" role="status" style={{ color: "var(--navy)" }}>{message}</p>}
      {error && <p className="ui" role="alert" style={{ color: "#b4451f" }}>{error}</p>}

      <table className="ui roster-table">
        <caption>
          {visible.length} row{visible.length === 1 ? "" : "s"} shown. Selecting all covers these rows only.
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <input type="checkbox" checked={allShown} aria-label="Select all shown students"
                onChange={() => set(allShown ? [] : visible.map((r) => r.enrolmentId))} />
            </th>
            <th scope="col">Name</th><th scope="col">Email</th><th scope="col">Account</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.enrolmentId} className={r.withdrawn ? "roster-withdrawn" : undefined}>
              <td>
                <input type="checkbox" checked={picked.has(r.enrolmentId)}
                  aria-label={`Select ${r.name}`} onChange={() => toggle(r.enrolmentId)} />
              </td>
              <td>
                {r.name}
                {r.demo && <span className="roster-tag">Demo</span>}
                {r.withdrawn && <span className="roster-tag">Withdrawn</span>}
              </td>
              <td>{r.email ?? "—"}</td>
              <td>{r.withdrawn && r.withdrawnOn ? `Withdrawn ${r.withdrawnOn}` : r.state}</td>
            </tr>
          ))}
          {visible.length === 0 && <tr><td colSpan={4}>No students to show.</td></tr>}
        </tbody>
      </table>

      <dialog ref={dialog} className="ui fx-dialog" aria-labelledby="roster-rm-h">
        <h2 id="roster-rm-h">Remove {selected.length} student{selected.length === 1 ? "" : "s"}?</h2>
        <p>{pending?.sentence}</p>
        <p><strong>This cannot be undone.</strong> To keep their work, withdraw them instead.</p>
        {pending?.needsTyping && (
          <p>
            <label htmlFor="roster-rm-t">Type <code>{phrase}</code> to confirm</label>
            <input id="roster-rm-t" value={typed} onChange={(e) => setTyped(e.target.value)}
              autoComplete="off" spellCheck={false} />
          </p>
        )}
        {error && <p role="alert" className="fx-dialog-error">{error}</p>}
        <div className="fx-dialog-actions">
          <button type="button" className="nav-button ghost" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="nav-button danger" disabled={busy || (!!pending?.needsTyping && typed.trim().toLowerCase() !== phrase)}
            onClick={() => act("remove", typed)}>
            {busy ? "Removing…" : "Delete the records and remove"}
          </button>
        </div>
      </dialog>
    </>
  );
}
