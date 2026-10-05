"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { registerUploadAction } from "@/app/library/actions";
import { displayBookId } from "@/lib/book-id";

const field = { padding: ".55rem .7rem", border: "1px solid var(--field-border)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

// Sends the zip straight from the browser to private Blob storage, then records the upload,
// which starts the intake. The book id says which library book this is a version of.
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
    try {
      setBusy(`Uploading ${(file.size / 1e6).toFixed(1)} MB…`);
      const blob = await upload(`uploads/${id}/${file.name}`, file, { access: "private", handleUploadUrl: "/api/library/upload" });
      setBusy("Starting the check…");
      const r = await registerUploadAction({ bookId: id, blobPath: blob.pathname, fileName: file.name, sizeBytes: file.size });
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
      <label>The book's folder as a zip — in Google Drive, right-click the book's CURRENT folder and choose Download
        <input type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "block", marginTop: ".3rem" }} />
      </label>
      <button className="nav-button primary" type="submit" disabled={!!busy}>{busy ?? "Upload and check"}</button>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </form>
  );
}
