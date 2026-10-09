"use client";
import { useState } from "react";

// Uploads chosen files to /api/files/upload, which streams them to the data volume, then puts the
// list into a hidden form field (JSON: [{ blobPath, fileName, sizeBytes }]) for the form's server
// action to record.
//
// Spec 28 commit 5: this used @vercel/blob/client's upload(), which sent the bytes from the browser
// straight to Blob with a one-time token. They go through the app now. The hidden field's shape is
// unchanged, so the server actions that read it did not have to move; the file is sent as the raw
// request body rather than as multipart, so the server can stream it to disk instead of holding it
// in memory; and the `prefix` prop is gone, because the server builds the key from the prefix it
// has authorised, and the client no longer has any say in where a file lands.
export default function FilePicker({ name, purpose, assignmentId, label }: {
  name: string; purpose: "assignment" | "submission"; assignmentId: string; label: string;
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
        const q = new URLSearchParams({ purpose, assignmentId, name: f.name });
        const res = await fetch(`/api/files/upload?${q}`, { method: "POST", body: f });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
        added.push({ blobPath: data.blobPath, fileName: data.fileName, sizeBytes: data.sizeBytes });
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
      {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}
