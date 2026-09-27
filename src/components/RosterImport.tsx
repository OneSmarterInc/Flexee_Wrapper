"use client";
import { useState } from "react";
import Papa from "papaparse";

type Row = Record<string, string>;
const guess = (headers: string[], re: RegExp) => headers.find((h) => re.test(h)) ?? "";

// A tolerant roster importer: parse the CSV, guess which columns hold email and
// name, let the instructor correct the mapping, then show exactly what will be
// committed before it is. Extra columns and blank rows are ignored.
export default function RosterImport({ sectionId }: { sectionId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [emailCol, setEmailCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [firstCol, setFirstCol] = useState("");
  const [lastCol, setLastCol] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: "greedy",
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(hs); setRows(res.data);
        setEmailCol(guess(hs, /e-?mail/i));
        setNameCol(guess(hs, /full.?name|^name$/i));
        setFirstCol(guess(hs, /first/i));
        setLastCol(guess(hs, /last|surname/i));
        setResult(null);
      },
    });
  }

  const nameOf = (r: Row) =>
    (nameCol && r[nameCol]) || [r[firstCol], r[lastCol]].filter(Boolean).join(" ").trim() || undefined;
  const valid = rows
    .map((r) => ({ email: (emailCol ? r[emailCol] : "").trim(), name: nameOf(r) }))
    .filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));

  async function commit() {
    setBusy(true);
    try {
      const res = await fetch("/api/roster/commit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId, rows: valid }),
      });
      const j = await res.json();
      setResult(res.ok ? `Added ${j.enrolled} enrolled and ${j.invited} invited (they enrol on first sign-in).` : "Import failed.");
    } finally { setBusy(false); }
  }

  const sel = (v: string, set: (s: string) => void, label: string) => (
    <label style={{ display: "grid", gap: ".2rem", fontSize: ".82rem", color: "var(--muted)" }}>
      {label}
      <select value={v} onChange={(e) => set(e.target.value)} style={{ padding: ".35rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" }}>
        <option value="">—</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="ui" style={{ display: "grid", gap: "1rem" }}>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      {headers.length > 0 && (
        <>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {sel(emailCol, setEmailCol, "Email column")}
            {sel(nameCol, setNameCol, "Name column")}
            {sel(firstCol, setFirstCol, "First name")}
            {sel(lastCol, setLastCol, "Last name")}
          </div>
          <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>
            {rows.length} rows parsed · {valid.length} with a valid email will be added.
          </p>
          <div style={{ maxHeight: "18rem", overflow: "auto", border: "1px solid var(--rule)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead><tr><th style={cell}>Email</th><th style={cell}>Name</th></tr></thead>
              <tbody>
                {valid.slice(0, 200).map((r, i) => (
                  <tr key={i}><td style={cell}>{r.email}</td><td style={cell}>{r.name ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={commit} disabled={busy || valid.length === 0}
            style={{ padding: ".55rem 1rem", border: "none", borderRadius: "6px", background: "var(--navy)", color: "#fff", cursor: "pointer", font: "inherit", width: "fit-content" }}>
            {busy ? "Adding…" : `Add ${valid.length} to the roster`}
          </button>
          {result && <p style={{ color: "var(--navy)" }}>{result}</p>}
        </>
      )}
    </div>
  );
}
const cell = { border: "1px solid var(--rule)", padding: ".4rem .6rem", textAlign: "left" } as const;
