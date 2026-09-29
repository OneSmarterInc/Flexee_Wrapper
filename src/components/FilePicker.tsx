"use client";
import { useState } from "react";
import { upload } from "@vercel/blob/client";

// Uploads chosen files straight to private Blob storage, then puts the list into a hidden form field
// (JSON: [{ blobPath, fileName, sizeBytes }]) for the form's server action to record.
export default function FilePicker({ name, purpose, assignmentId, prefix, label }: {
  name: string; purpose: "assignment" | "submission"; assignmentId: string; prefix: string; label: string;
}) {
  const [files, setFiles] = useState<{ blobPath: string; fileName: string; sizeBytes: number }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function pick(list: FileList | null) {
    if (!list || !list.length) return; setError(null);
    const added: { blobPath: string; fileName: string; sizeBytes: number }[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 50 * 1024 * 1024) { setError(`${f.name} is larger than 50 MB.`); continue; }
      try {
        setBusy(`Uploading ${f.name}…`);
        const safe = f.name.replace(/[\/\\]/g, "_");
        const b = await upload(`${prefix}${safe}`, f, { access: "private", handleUploadUrl: "/api/files/upload",
          clientPayload: JSON.stringify({ purpose, assignmentId }) });
        added.push({ blobPath: b.pathname, fileName: f.name, sizeBytes: f.size });
      } catch (e) { setError(`${f.name}: ${(e as Error).message || "upload failed"}`); }
    }
    setBusy(null); setFiles((cur) => [...cur, ...added]);
  }
  return (
    <div className="ui" style={{ display: "grid", gap: ".35rem" }}>
      <label>{label} <input type="file" multiple onChange={(e) => pick(e.target.files)} disabled={!!busy} style={{ display: "block", marginTop: ".3rem" }} /></label>
      <input type="hidden" name={name} value={JSON.stringify(files)} />
      {busy && <span style={{ color: "var(--muted)" }}>{busy}</span>}
      {files.map((f, i) => (
        <span key={f.blobPath} style={{ color: "var(--navy)" }}>
          ✓ {f.fileName} <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
            style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer" }}>remove</button>
        </span>
      ))}
      {error && <span style={{ color: "#b4451f" }}>{error}</span>}
    </div>
  );
}
