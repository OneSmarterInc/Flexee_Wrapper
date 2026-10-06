"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readHeaders, type Headers as FileHeaders } from "@/lib/score-import";

/**
 * Spec 23 §1 and §3: import a column's scores from a CSV, with a preview first.
 *
 * The file is read in the browser and sent as text; it is never uploaded anywhere and never
 * written. The preview is computed on the server against the real class, because a plan a browser
 * worked out is not evidence of anything.
 *
 * Rule 11: the file input and the score-column picker are labelled, the preview's tables have
 * captions and column headers, the confirmation is a real checkbox, and nothing here is reachable
 * only by mouse.
 */

type Excluded = { line: number; identifier: string; reason: string };
type Preview = {
  column: { id: string; title: string; maxPoints: number; kind: string };
  refusal: string | null;
  file: { rowCount: number; scoreHeader: string | null; identifierHeader: string | null; ignored: string[] };
  changes: { name: string; line: number; from: number | null; to: number | null; rounded: boolean }[];
  counts: Record<string, number>;
  excluded: Excluded[];
  noRowFor: string[];
  samples: { name: string; from: number; to: number | null }[];
  needsReplaceTick: boolean;
  fatal: string | null;
};

export type Column = { id: string; title: string; maxPoints: number };
export type Category = { id: string; name: string };

export default function ScoreImport({
  sectionId, column, categories = [], mode = "column",
}: {
  sectionId: string;
  /** The column being filled. Omitted when the file is making a new one. */
  column?: Column;
  categories?: Category[];
  mode?: "column" | "new";
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<FileHeaders | null>(null);
  const [scoreIndex, setScoreIndex] = useState<number | null>(null);
  const [percentages, setPercentages] = useState(false);
  const [clearBlanks, setClearBlanks] = useState(false);
  const [allowOver, setAllowOver] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [title, setTitle] = useState("");
  const [maxPoints, setMaxPoints] = useState(10);
  const [categoryId, setCategoryId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const id = mode === "new" ? "new-column" : column!.id;

  function reset() {
    setPreview(null); setConfirmReplace(false); setError("");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    reset();
    if (!f) { setFileName(""); setText(""); setHeaders(null); return; }
    const t = await f.text();
    setFileName(f.name);
    setText(t);
    const h = readHeaders(t);
    setHeaders(h);
    const first = h.scoreColumns[0];
    setScoreIndex(first ? first.index : null);
    // A D2L header carries the item's own title and maximum, which are a sensible starting point
    // for a column the file is about to create.
    if (mode === "new" && first) {
      if (first.itemTitle && !title) setTitle(first.itemTitle);
      if (first.fileMax) setMaxPoints(first.fileMax);
    }
  }

  async function ask() {
    setBusy(true); setError(""); setPreview(null);
    try {
      const body: Record<string, unknown> = {
        sectionId, text, percentages, clearBlanks, allowOverMaximum: allowOver,
        ...(scoreIndex != null ? { scoreIndex } : {}),
      };
      // A column that does not exist yet is described rather than looked up: the maximum the form
      // gives is what a score is judged over and what a percentage converts against.
      if (mode === "new") body.newColumn = { title, maxPoints };
      else body.lineItemId = column!.id;
      const res = await fetch("/api/class/score-import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setError(j?.error || "That file could not be read."); return; }
      setPreview(j.preview as Preview);
      dialog.current?.showModal();
    } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = {
        sectionId, text, percentages, clearBlanks, allowOverMaximum: allowOver, confirmReplace,
        ...(scoreIndex != null ? { scoreIndex } : {}),
      };
      if (mode === "new") body.newColumn = { title, maxPoints, categoryId: categoryId || null };
      else body.lineItemId = column!.id;
      const res = await fetch("/api/class/score-import", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setError(j?.error || "The import did not go through."); return; }
      dialog.current?.close();
      router.refresh();
    } finally { setBusy(false); }
  }

  const c = preview?.counts ?? {};
  const blocked = !!preview && (preview.changes.length === 0 || (preview.needsReplaceTick && !confirmReplace));

  return (
    <div className="ui score-import">
      <label className="field-stack" htmlFor={`file-${id}`}>
        {mode === "new" ? "A CSV of scores to make a column from" : `A CSV of scores for ${column!.title}`}
        <input id={`file-${id}`} type="file" accept=".csv,text/csv" onChange={onFile} />
      </label>

      {fileName && <p style={{ color: "var(--muted)", fontSize: ".85rem", margin: ".2rem 0" }}>{fileName}</p>}

      {headers && headers.scoreColumns.length === 0 && (
        <p role="alert" style={{ color: "var(--danger)" }}>
          No column of scores in that file. It needs a header called Score, Points or Grade.
        </p>
      )}

      {headers && headers.scoreColumns.length > 0 && (
        <>
          <label className="field-stack" htmlFor={`score-col-${id}`}>Which column holds the scores
            <select id={`score-col-${id}`} value={scoreIndex ?? ""}
              onChange={(e) => { setScoreIndex(Number(e.target.value)); reset(); }}>
              {headers.scoreColumns.map((sc) => (
                <option key={sc.index} value={sc.index}>
                  {sc.header}{sc.fileMax ? ` (out of ${sc.fileMax} in the file)` : ""}
                </option>
              ))}
            </select>
          </label>

          {mode === "new" && (
            <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "end", margin: ".4rem 0" }}>
              <label className="field-stack">Column title
                <input value={title} onChange={(e) => { setTitle(e.target.value); reset(); }}
                  placeholder="e.g. Studio session" required />
              </label>
              <label className="field-stack">Max points
                <input type="number" min={1} value={maxPoints}
                  onChange={(e) => { setMaxPoints(Number(e.target.value)); reset(); }} style={{ width: "6rem" }} />
              </label>
              {categories.length > 0 && (
                <label className="field-stack">Category
                  <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); reset(); }}>
                    <option value="">Uncategorised</option>
                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <fieldset style={{ border: "1px solid var(--field-border)", borderRadius: "8px", padding: ".6rem .8rem", margin: ".5rem 0" }}>
            <legend style={{ fontSize: ".8rem", color: "var(--muted)", padding: "0 .3rem" }}>How to read the file</legend>
            <label className="checkbox-label">
              <input type="checkbox" checked={percentages} onChange={(e) => { setPercentages(e.target.checked); reset(); }} />
              The values are percentages of the maximum points
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={clearBlanks} onChange={(e) => { setClearBlanks(e.target.checked); reset(); }} />
              Clear the score where a row is blank
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={allowOver} onChange={(e) => { setAllowOver(e.target.checked); reset(); }} />
              Allow scores above the maximum (bonus marks)
            </label>
          </fieldset>

          <button className="nav-button primary" type="button" onClick={ask}
            disabled={busy || !text || (mode === "new" && !title.trim())}>
            {busy ? "Reading…" : "Preview the import"}
          </button>
        </>
      )}

      {error && !preview && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}

      <dialog ref={dialog} className="fx-dialog" aria-labelledby={`imp-h-${id}`}>
        <h2 id={`imp-h-${id}`}>
          {preview ? `${preview.file.rowCount} row${preview.file.rowCount === 1 ? "" : "s"} read from ${fileName}` : "Preview"}
        </h2>
        {preview?.refusal && <p role="alert" style={{ color: "var(--danger)" }}>{preview.refusal}</p>}
        {preview?.fatal && <p role="alert" style={{ color: "var(--danger)" }}>{preview.fatal}</p>}

        {preview && !preview.refusal && !preview.fatal && (
          <>
            <table>
              <caption>What this file would do</caption>
              <tbody>
                <tr><th scope="row">Scores to add</th><td>{c.newScores ?? 0}</td></tr>
                <tr><th scope="row">Scores to change</th><td>{c.replaced ?? 0}</td></tr>
                {clearBlanks && <tr><th scope="row">Scores to clear</th><td>{c.cleared ?? 0}</td></tr>}
                <tr><th scope="row">Values rounded to two decimals</th><td>{c.rounded ?? 0}</td></tr>
                <tr><th scope="row">Rows for nobody in this class</th><td>{c.unmatched ?? 0}</td></tr>
                <tr><th scope="row">The same student twice</th><td>{c.duplicates ?? 0}</td></tr>
                <tr><th scope="row">Not a number</th><td>{c.notNumeric ?? 0}</td></tr>
                <tr><th scope="row">Below zero</th><td>{c.belowZero ?? 0}</td></tr>
                <tr><th scope="row">Above the maximum</th><td>{c.overMaximum ?? 0}</td></tr>
                <tr><th scope="row">Withdrawn students, skipped</th><td>{c.withdrawnSkipped ?? 0}</td></tr>
                <tr><th scope="row">The demo account, skipped</th><td>{c.demoSkipped ?? 0}</td></tr>
                <tr><th scope="row">Blank, left alone</th><td>{clearBlanks ? 0 : (c.blank ?? 0)}</td></tr>
                <tr><th scope="row">Students in the class with no row</th><td>{c.noRow ?? 0}</td></tr>
              </tbody>
            </table>

            {preview.samples.length > 0 && (
              <table>
                <caption>The first scores that would change</caption>
                <thead><tr><th scope="col">Student</th><th scope="col">Now</th><th scope="col">Would be</th></tr></thead>
                <tbody>
                  {preview.samples.map((s) => (
                    <tr key={s.name}><td>{s.name}</td><td>{s.from}</td><td>{s.to == null ? "cleared" : s.to}</td></tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview.excluded.length > 0 && (
              <table>
                <caption>Rows that will not be applied</caption>
                <thead><tr><th scope="col">Row</th><th scope="col">In the file</th><th scope="col">Why</th></tr></thead>
                <tbody>
                  {preview.excluded.slice(0, 20).map((x) => (
                    <tr key={`${x.line}-${x.identifier}`}><td>{x.line}</td><td>{x.identifier}</td><td>{x.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.excluded.length > 20 && (
              <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>
                and {preview.excluded.length - 20} more. Fix the file and upload it again to see them all.
              </p>
            )}

            {preview.noRowFor.length > 0 && (
              <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>
                No row for: {preview.noRowFor.slice(0, 8).join(", ")}
                {preview.noRowFor.length > 8 ? `, and ${preview.noRowFor.length - 8} more` : ""}.
                Their scores are left as they are.
              </p>
            )}

            {preview.needsReplaceTick && (
              <label className="checkbox-label" style={{ marginTop: ".6rem" }}>
                <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
                Replace the {(c.replaced ?? 0) + (c.cleared ?? 0)} score
                {(c.replaced ?? 0) + (c.cleared ?? 0) === 1 ? "" : "s"} already entered.
              </label>
            )}
            {preview.changes.length === 0 && (
              <p role="status" style={{ color: "var(--muted)" }}>There is nothing to apply from this file.</p>
            )}
          </>
        )}

        {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="fx-dialog-actions">
          <button className="nav-button ghost" type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button className="nav-button primary" type="button" onClick={apply} disabled={busy || blocked}>
            {busy ? "Applying…" : mode === "new" ? "Create the column and import" : "Import these scores"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
