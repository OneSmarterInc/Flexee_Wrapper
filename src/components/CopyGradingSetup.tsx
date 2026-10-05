"use client";
import { useRef, useState } from "react";

/**
 * Copy a grading setup from another class (Spec 19 §3).
 *
 * Preview first, always: the categories that will arrive, the target's columns that will land in
 * one, the columns that will not, what is being replaced, and how many students' course totals
 * will move. When any score exists the class's own name has to be typed, because the totals really
 * do change and a faculty member should say so on purpose.
 */
type Preview = {
  from: { name: string }; to: { name: string };
  categories: { name: string; weight: number; dropLowest: number }[];
  matched: { title: string; category: string }[];
  unmatched: string[];
  replacing: { categories: number; hasScale: boolean };
  studentsAffected: number;
  letterBands: number;
};

export default function CopyGradingSetup({
  sectionId, choices,
}: { sectionId: string; choices: { id: string; name: string; term: string | null }[] }) {
  const [from, setFrom] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  async function look() {
    if (!from) return;
    setBusy(true); setError(""); setTyped("");
    try {
      const res = await fetch(`/api/class/copy-grading?from=${encodeURIComponent(from)}&to=${encodeURIComponent(sectionId)}`);
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setError(j?.error ?? "Could not read that class's setup."); return; }
      setPreview(j.preview);
      dialog.current?.showModal();
    } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/class/copy-grading", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to: sectionId, confirm: typed }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setError(j?.error ?? "Could not copy that setup."); return; }
      dialog.current?.close();
      window.location.reload();
    } finally { setBusy(false); }
  }

  if (!choices.length) {
    return (
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        You teach no other class to copy a grading setup from.
      </p>
    );
  }
  const needsTyping = (preview?.studentsAffected ?? 0) > 0;

  return (
    <div className="ui" style={{ display: "flex", gap: ".6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: ".2rem", fontSize: ".82rem", color: "var(--muted)" }}>
        Copy the setup from
        <select value={from} onChange={(e) => setFrom(e.target.value)}
          style={{ padding: ".4rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" }}>
          <option value="">Choose a class…</option>
          {choices.map((c) => <option key={c.id} value={c.id}>{c.name}{c.term ? ` · ${c.term}` : ""}</option>)}
        </select>
      </label>
      <button type="button" className="nav-button secondary" disabled={busy || !from} onClick={look}>
        {busy ? "Reading…" : "Preview the copy"}
      </button>
      {error && !preview && <p role="alert" style={{ color: "#b4451f", margin: 0 }}>{error}</p>}

      <dialog ref={dialog} className="ui fx-dialog" aria-labelledby="copy-h">
        <h2 id="copy-h">Copy from {preview?.from.name}?</h2>
        {preview && (
          <>
            <table>
              <caption>The categories that would arrive</caption>
              <tbody>
                {preview.categories.map((c) => (
                  <tr key={c.name}>
                    <th scope="row">{c.name}</th>
                    <td>{c.weight}%{c.dropLowest ? ` · drop ${c.dropLowest}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {preview.letterBands > 0
                ? `Its letter scale (${preview.letterBands} bands) replaces this class's.`
                : "It has no letter scale of its own, so this class's goes back to the default."}
            </p>
            <p>
              This replaces {preview.replacing.categories} categor{preview.replacing.categories === 1 ? "y" : "ies"}
              {preview.replacing.hasScale ? " and the letter scale" : ""} in {preview.to.name}.
            </p>
            {preview.matched.length > 0 && (
              <p style={{ fontSize: ".85rem" }}>
                {preview.matched.length} column{preview.matched.length === 1 ? "" : "s"} would be matched by name:{" "}
                {preview.matched.map((m) => `${m.title} → ${m.category}`).join("; ")}.
              </p>
            )}
            {preview.unmatched.length > 0 && (
              <p style={{ fontSize: ".85rem", color: "#b4451f" }}>
                {preview.unmatched.length} column{preview.unmatched.length === 1 ? "" : "s"} match no copied category
                and would be left uncategorised, not deleted: {preview.unmatched.join(", ")}.
              </p>
            )}
            {needsTyping && (
              <>
                <p>
                  <strong>
                    {preview.studentsAffected} student{preview.studentsAffected === 1 ? "'s" : "s'"} course
                    total{preview.studentsAffected === 1 ? "" : "s"} will change.
                  </strong>
                </p>
                <p>
                  <label htmlFor="copy-t">Type this class&apos;s name — <code>{preview.to.name}</code> — to confirm</label>
                  <input id="copy-t" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                </p>
              </>
            )}
          </>
        )}
        {error && <p role="alert" className="fx-dialog-error">{error}</p>}
        <div className="fx-dialog-actions">
          <button type="button" className="nav-button ghost" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="nav-button primary" onClick={apply}
            disabled={busy || (needsTyping && typed.trim() !== preview?.to.name.trim())}>
            {busy ? "Copying…" : "Replace this class's setup"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
