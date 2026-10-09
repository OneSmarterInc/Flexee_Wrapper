"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerUploadAction } from "@/app/library/actions";
import { displayBookId, looksDoubleZipped } from "@/lib/book-id";

const field = { padding: ".55rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

// Sends the zip to /api/library/upload, which streams it to disk, then records the upload, which
// starts the intake. The book id says which library book this is a version of.
//
// Spec 28 commit 6: this used @vercel/blob/client's upload(), which sent the bytes from the browser
// straight to Blob with a one-time token, so a 32 MB zip never passed through the server. It does
// now. Two consequences a person can see: the progress line is the browser's own upload again
// rather than Blob's, and the server names the file — the route returns the key it wrote, which is
// what goes to registerUploadAction, instead of this form composing `uploads/<id>/<name>` itself.
export default function UploadForm({ books }: { books: { id: string; title: string }[] }) {
  const router = useRouter();
  const [bookId, setBookId] = useState(books[0]?.id ?? "__new");
  const [newId, setNewId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = bookId === "__new" ? newId.trim().toLowerCase() : bookId;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!file) return setError("Choose the book's zip file.");
    if (!/\.zip$/i.test(file.name)) return setError("Upload a .zip of the book's CURRENT folder.");
    if (!/^[a-z][a-z0-9]{1,30}$/.test(id)) return setError("Book id: lowercase letters and digits, starting with a letter (e.g. mis4950).");
    // Checked here as well as in the route, because the route can only answer after the whole body
    // has arrived — and refusing a 300 MB zip after ten minutes of uploading is a poor way to say it.
    if (file.size > 200 * 1024 * 1024) return setError(`${file.name} is larger than 200 MB.`);
    try {
      setBusy(`Uploading ${(file.size / 1e6).toFixed(1)} MB…`);
      const q = new URLSearchParams({ bookId: id, name: file.name });
      const res = await fetch(`/api/library/upload?${q}`, { method: "POST", body: file });
      const saved = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(saved.error || `The upload failed (${res.status}).`);
      setBusy("Starting the check…");
      const r = await registerUploadAction({ bookId: id, blobPath: saved.blobPath, fileName: saved.fileName, sizeBytes: saved.sizeBytes });
      if (!r.ok) { setBusy(null); return setError(r.error); }
      router.push(`/library/${r.id}`);
    } catch (err) {
      setBusy(null); setError((err as Error).message || "The upload failed.");
    }
  }

  return (
    <form onSubmit={submit} className="ui" style={{ display: "grid", gap: ".6rem", maxWidth: "36rem" }}>
      <label>Which book is this?
        <select value={bookId} onChange={(e) => setBookId(e.target.value)} style={{ ...field, display: "block", marginTop: ".3rem", width: "100%" }}>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title} ({displayBookId(b.id)}) — a new version</option>)}
          <option value="__new">A new book…</option>
        </select>
      </label>
      {bookId === "__new" && (
        <input placeholder="New book id, e.g. mis4950" value={newId} onChange={(e) => setNewId(e.target.value)} style={field} />
      )}
      {/* Spec 22 §5: a soft warning, not a refusal. ".zip.zip" happens when a browser has already
          unzipped the download and the folder was zipped again, which usually means the archive
          holds one folder containing the lanes rather than the lanes themselves. Often it is still
          the right file, so the form says so and lets it through. */}
      {file && looksDoubleZipped(file.name) && (
        <p className="ui" role="status" style={{ color: "var(--danger)", margin: 0, fontSize: ".88rem" }}>
          That file is named <strong>{file.name}</strong> — ending <code>.zip.zip</code> usually
          means it was zipped twice, and the intake will see one folder where it expects the lanes.
          You can upload it anyway; if the check stops on a missing lane, this is why.
        </p>
      )}
      <label>The book's folder as a zip — in Google Drive, right-click the book's CURRENT folder and choose Download
        <input type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "block", marginTop: ".3rem" }} />
      </label>
      <button className="nav-button primary" type="submit" disabled={!!busy}>{busy ?? "Upload and check"}</button>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </form>
  );
}
