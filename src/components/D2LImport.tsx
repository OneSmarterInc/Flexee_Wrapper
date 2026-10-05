"use client";
import { useState } from "react";
import { confirmLabel, emailSentence, nothingToWrite } from "@/lib/d2l";

type Row = {
  line: number; name: string; userName: string; orgDefinedId: string; role: string; email: string;
  plan: "create" | "enrol existing" | "already in class";
  demo: boolean; withdrawn?: boolean; matchedBy?: "username" | "email"; emailOnFile?: string; hasPassword?: boolean;
  note?: string; warning?: string;
};
type Preview = {
  rows: Row[];
  skipped: { line: number; name: string; role: string }[];
  problems: { line: number; reason: string; detail?: string }[];
  counts: {
    willCreate: number; haveAccounts: number; alreadyInClass: number;
    skipped: number; problems: number; demo: number; withdrawn: number; willEmail: number;
  };
  missing: { name: string; email: string | null }[];
  domain: string;
};

// The file is read in the browser and sent as text for one preview and one commit. It is never
// uploaded as a file, never stored, and the preview below lives only in this component's state.
//
// Spec 18: creating the accounts and emailing them are two separate clicks. The first says exactly
// what it will write; the second says how many people it will email, and where.
export default function D2LImport({ sectionId }: { sectionId: string }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<{ count: number; domain: string } | null>(null);
  const [emailResult, setEmailResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null); setResult(null); setError(""); setEmailStep(null); setEmailResult(null);
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

  async function createAccounts() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/roster/d2l/commit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId, csv, sendNow: false }),
      });
      if (!res.ok) { setError("Import failed. Nothing was written."); return; }
      const r = (await res.json()).result;
      const bits = [
        `${r.created} account${r.created === 1 ? "" : "s"} created`,
        `${r.enrolled} existing account${r.enrolled === 1 ? "" : "s"} enrolled`,
        `${r.alreadyInClass} already in the class`,
      ];
      if (r.demo) bits.push(`${r.demo} demo account${r.demo === 1 ? "" : "s"} (never emailed)`);
      if (r.withdrawn) bits.push(`${r.withdrawn} withdrawn earlier and left withdrawn — restore from the class list`);
      if (r.emailDiffers) bits.push(`${r.emailDiffers} matched by D2L username with a different email on file (not invited)`);
      if (r.skippedUsernames) bits.push(`${r.skippedUsernames} D2L username${r.skippedUsernames === 1 ? "" : "s"} not stored (already in use)`);
      if (r.problems?.length) bits.push(`${r.problems.length} problem row${r.problems.length === 1 ? "" : "s"} skipped`);
      setResult(bits.join(" · ") + ".");
      setPreview(null); setCsv("");
      // Ask the server who would be emailed, so the second step states a number nobody guessed.
      const q = await fetch(`/api/roster/d2l/invite?section=${encodeURIComponent(sectionId)}`);
      if (q.ok) { const j = await q.json(); setEmailStep({ count: j.count, domain: j.domain }); }
    } finally { setBusy(false); }
  }

  async function emailInvitations() {
    setBusy(true);
    try {
      const res = await fetch(`/api/roster/d2l/invite?section=${encodeURIComponent(sectionId)}`, { method: "POST" });
      if (!res.ok) { setError("Could not send the invitations."); return; }
      const j = await res.json();
      const bits = [`${j.sent} invitation${j.sent === 1 ? "" : "s"} sent`];
      if (j.failed) bits.push(`${j.failed} not sent (${j.reason})`);
      if (j.limited) bits.push(`${j.limited} already had three this hour`);
      setEmailResult(bits.join(" · ") + ". The class list shows each student's state.");
      setEmailStep(null);
    } finally { setBusy(false); }
  }

  const c = preview?.counts;
  const toEnrol = preview ? preview.rows.filter((r) => r.plan === "enrol existing").length : 0;
  // Nothing to write means nothing to confirm. The live test ran a file whose only importable row
  // was D2L's demo student, and the dark "email invitations" button was still inviting a click.
  const plan = { willCreate: c?.willCreate ?? 0, toEnrol };
  const nothingToDo = !!c && nothingToWrite(plan);
  const planLabel = c ? confirmLabel(plan) : "";

  return (
    <div className="ui" style={{ display: "grid", gap: "1rem" }}>
      <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="D2L class list CSV" />
      {busy && <p style={{ color: "var(--muted)" }}>Working…</p>}
      {error && <p style={{ color: "#b4451f" }}>{error}</p>}
      {result && <p style={{ color: "var(--navy)" }}>{result}</p>}

      {emailStep && (
        <div style={{ border: "1px solid var(--rule)", borderRadius: "8px", padding: ".8rem" }}>
          <p style={{ margin: "0 0 .6rem" }}>
            {emailSentence(emailStep.count, emailStep.domain)}
            {emailStep.count > 0
              ? " The demo account is never emailed."
              : " Every student in this class has set a password, or is the demo account."}
          </p>
          <button onClick={emailInvitations} disabled={busy || emailStep.count === 0} style={primary}>
            Email {emailStep.count} invitation{emailStep.count === 1 ? "" : "s"} now
          </button>
        </div>
      )}
      {emailResult && <p style={{ color: "var(--navy)" }}>{emailResult}</p>}

      {preview && c && (
        <>
          <p style={{ color: "var(--muted)" }}>
            <strong>{fileName}</strong> · {c.willCreate} student{c.willCreate === 1 ? "" : "s"} will be created
            {" · "}{c.haveAccounts} already have accounts{" · "}{c.alreadyInClass} already in this class
            {c.demo ? ` · ${c.demo} demo` : ""}
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
                    <td style={cell}>{r.name}{r.demo && <span style={tag}>Demo</span>}</td>
                    <td style={cell}>{r.email}{r.note && <div style={muted}>{r.note}</div>}</td>
                    <td style={cell}>{r.userName}{r.warning && <div style={{ ...muted, color: "#b4451f" }}>{r.warning}</div>}</td>
                    <td style={{ ...cell, color: "var(--muted)" }}>{r.orgDefinedId || "—"} (ignored)</td>
                    <td style={cell}>
                      {r.demo ? "demo account: created, never emailed" : r.plan}
                      {r.withdrawn && <div style={{ ...muted, color: "#b4451f" }}>withdrawn earlier — restore from the class list</div>}
                      {r.emailOnFile && <div style={muted}>existing account, email on file differs ({r.emailOnFile}) — enrolled, not invited</div>}
                      {!r.demo && !r.emailOnFile && r.matchedBy === "username" && <div style={muted}>matched by D2L username</div>}
                    </td>
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
              <h3 style={h3}>Problems — these rows are not imported</h3>
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

          <div>
            <button onClick={createAccounts} disabled={busy || nothingToDo} style={nothingToDo ? disabled : primary}>
              {planLabel}
            </button>
            <p style={{ ...muted, marginTop: ".5rem" }}>
              {nothingToDo
                ? "Nothing in this file would be written, so there is nothing to confirm."
                : "No email is sent by this step. Emailing is the next one, and it says how many it will send."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const cell = { border: "1px solid var(--rule)", padding: ".4rem .6rem", textAlign: "left", verticalAlign: "top" } as const;
const muted = { color: "var(--muted)", fontSize: ".78rem" } as const;
const tag = { marginLeft: ".4rem", padding: ".05rem .35rem", border: "1px solid var(--rule)", borderRadius: "4px", fontSize: ".7rem", color: "var(--muted)" } as const;
const h3 = { font: "inherit", fontWeight: 600, margin: "0 0 .3rem" } as const;
const list = { margin: 0, paddingLeft: "1.2rem", color: "var(--muted)", fontSize: ".85rem" } as const;
const primary = { padding: ".55rem 1rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit" } as const;
const disabled = { ...primary, background: "var(--rule)", color: "var(--muted)", cursor: "not-allowed" } as const;
