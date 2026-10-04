"use client";
import { useState } from "react";

type Row = {
  line: number; name: string; userName: string; orgDefinedId: string; role: string; email: string;
  plan: "create" | "enrol existing" | "already in class"; note?: string; warning?: string;
};
type Preview = {
  rows: Row[];
  skipped: { line: number; name: string; role: string }[];
  problems: { line: number; reason: string; detail?: string }[];
  counts: { willCreate: number; haveAccounts: number; alreadyInClass: number; skipped: number; problems: number };
  missing: { name: string; email: string | null }[];
  domain: string;
};

// The file is read in the browser and sent as text for one preview and one commit. It is never
// uploaded as a file, never stored, and the preview below lives only in this component's state.
export default function D2LImport({ sectionId }: { sectionId: string }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null); setResult(null); setError("");
    if (!file) return;
    const text = await file.text();
    setCsv(text); setFileName(file.name);
    setBusy(true);
    try {
      const res = await fetch("/api/roster/d2l/preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId, csv: text }),
      });
      if (!res.ok) { setError(res.status === 403 ? "Only this class's faculty or an administrator can import." : "Could not read that file."); return; }
      const j = await res.json();
      if (!j.ok) { setError(j.error ?? "Could not read that file."); return; }
      setPreview(j.preview);
    } finally { setBusy(false); }
  }

  async function commit(sendNow: boolean) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/roster/d2l/commit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId, csv, sendNow }),
      });
      if (!res.ok) { setError("Import failed."); return; }
      const r = (await res.json()).result;
      const bits = [
        `${r.created} account${r.created === 1 ? "" : "s"} created`,
        `${r.enrolled} existing account${r.enrolled === 1 ? "" : "s"} enrolled`,
        `${r.alreadyInClass} already in the class`,
      ];
      if (sendNow) bits.push(`${r.invited} invitation${r.invited === 1 ? "" : "s"} sent`);
      if (r.notSent?.length) bits.push(`${r.notSent.length} not sent (${r.notSent[0].reason})`);
      if (r.skippedUsernames) bits.push(`${r.skippedUsernames} D2L username${r.skippedUsernames === 1 ? "" : "s"} not stored (already in use)`);
      setResult(bits.join(" · ") + ". The class list shows each student's invitation state.");
      setPreview(null); setCsv("");
    } finally { setBusy(false); }
  }

  const c = preview?.counts;
  return (
    <div className="ui" style={{ display: "grid", gap: "1rem" }}>
      <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="D2L class list CSV" />
      {busy && <p style={{ color: "var(--muted)" }}>Working…</p>}
      {error && <p style={{ color: "#b4451f" }}>{error}</p>}
      {result && <p style={{ color: "var(--navy)" }}>{result}</p>}

      {preview && c && (
        <>
          <p style={{ color: "var(--muted)" }}>
            <strong>{fileName}</strong> · {c.willCreate} student{c.willCreate === 1 ? "" : "s"} will be created
            {" · "}{c.haveAccounts} already have accounts{" · "}{c.alreadyInClass} already in this class
            {" · "}{c.skipped} row{c.skipped === 1 ? "" : "s"} skipped{" · "}{c.problems} problem{c.problems === 1 ? "" : "s"}.
            {" "}Addresses are the UserName plus <code>@{preview.domain}</code>. <code>OrgDefinedId</code> is read and ignored, never stored.
          </p>

          <div style={{ maxHeight: "20rem", overflow: "auto", border: "1px solid var(--rule)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <caption style={{ captionSide: "top", textAlign: "left", padding: ".4rem .6rem", color: "var(--muted)" }}>
                Students in the file, and what importing would do
              </caption>
              <thead><tr><th style={cell}>Name</th><th style={cell}>Email</th><th style={cell}>D2L username</th><th style={cell}>OrgDefinedId</th><th style={cell}>Result</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td style={cell}>{r.name}</td>
                    <td style={cell}>{r.email}{r.note && <div style={muted}>{r.note}</div>}</td>
                    <td style={cell}>{r.userName}{r.warning && <div style={{ ...muted, color: "#b4451f" }}>{r.warning}</div>}</td>
                    <td style={{ ...cell, color: "var(--muted)" }}>{r.orgDefinedId || "—"} (ignored)</td>
                    <td style={cell}>{r.plan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.skipped.length > 0 && (
            <div>
              <h3 style={h3}>Skipped — not a student role</h3>
              <ul style={list}>{preview.skipped.map((s) => <li key={s.line}>Row {s.line}: {s.name} — role {s.role}</li>)}</ul>
            </div>
          )}
          {preview.problems.length > 0 && (
            <div>
              <h3 style={h3}>Problems</h3>
              <ul style={list}>{preview.problems.map((p, i) => <li key={i}>Row {p.line}: {p.reason}{p.detail ? ` (${p.detail})` : ""}</li>)}</ul>
            </div>
          )}
          {preview.missing.length > 0 && (
            <div>
              <h3 style={h3}>On this class but not in the file</h3>
              <p style={muted}>Nobody is removed by an import. Remove them from the class list if they have dropped.</p>
              <ul style={list}>{preview.missing.map((m, i) => <li key={i}>{m.name}{m.email ? ` · ${m.email}` : ""}</li>)}</ul>
            </div>
          )}

          <div style={{ display: "flex", gap: ".8rem", flexWrap: "wrap" }}>
            <button onClick={() => commit(true)} disabled={busy || preview.rows.length === 0} style={primary}>
              Create accounts and email invitations
            </button>
            <button onClick={() => commit(false)} disabled={busy || preview.rows.length === 0} style={ghost}>
              Create accounts only
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const cell = { border: "1px solid var(--rule)", padding: ".4rem .6rem", textAlign: "left", verticalAlign: "top" } as const;
const muted = { color: "var(--muted)", fontSize: ".78rem" } as const;
const h3 = { font: "inherit", fontWeight: 600, margin: "0 0 .3rem" } as const;
const list = { margin: 0, paddingLeft: "1.2rem", color: "var(--muted)", fontSize: ".85rem" } as const;
const primary = { padding: ".55rem 1rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" } as const;
const ghost = { padding: ".55rem 1rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "transparent", color: "var(--ink)", cursor: "pointer", font: "inherit" } as const;
