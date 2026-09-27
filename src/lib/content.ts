import path from "node:path";
import { contentStore } from "@/lib/storage";

// The content tree produced by the intake tools. Books are read through the content store
// (src/lib/storage.ts), which is either this folder or an S3 bucket, set by CONTENT_STORE.
export const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.cwd(), "content");

export type Figure = {
  id: string;
  kind: "image" | "pending" | "table";
  status?: string;
  src?: string | null;
  alt?: string;
  caption?: string | null;
  number: string;
};
export type Section = { id: string; title: string };

export type EntryManifest = {
  schemaVersion: number;
  id: string;
  book: string;
  kind: "chapter" | "front";
  number: number | null;
  label: string | null;
  title: string;
  version: number;
  contentHash: string;
  content: string;
  sourceHtml?: string;
  sections: Section[];
  figures: Figure[];
};

export type SpineItem = { ref: string; kind: "chapter" | "front" };
export type BookManifest = {
  schemaVersion: number;
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  copyright?: string;
  license?: string;
  defaultEntry: string;
  spine: SpineItem[];
};

async function readJson<T>(key: string): Promise<T> {
  return JSON.parse(await contentStore().readText(key)) as T;
}

export async function listBooks(): Promise<BookManifest[]> {
  const books: BookManifest[] = [];
  for (const d of await contentStore().listDirs("")) {
    if (d.startsWith("_")) continue; // _archive, _staging and reports are intake bookkeeping
    try {
      books.push(await readJson<BookManifest>(`${d}/book.manifest.json`));
    } catch {
      /* not a book dir */
    }
  }
  return books.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getBook(bookId: string): Promise<BookManifest> {
  return readJson<BookManifest>(`${bookId}/book.manifest.json`);
}

export async function getEntry(bookId: string, entryId: string) {
  const key = `${bookId}/${entryId}`;
  const manifest = await readJson<EntryManifest>(`${key}/manifest.json`);
  const markdown = await contentStore().readText(`${key}/${manifest.content}`);
  return { manifest, markdown, key };
}

// spine with resolved titles, for a book's table of contents
export async function getToc(bookId: string) {
  const book = await getBook(bookId);
  const items = await Promise.all(
    book.spine.map(async (s) => {
      const m = await readJson<EntryManifest>(`${bookId}/${s.ref}/manifest.json`);
      return { ref: s.ref, kind: s.kind, number: m.number, title: m.title };
    }),
  );
  return { book, items };
}

// prev / next neighbours in reading order
export function neighbours(book: BookManifest, entryId: string) {
  const i = book.spine.findIndex((s) => s.ref === entryId);
  return {
    prev: i > 0 ? book.spine[i - 1].ref : null,
    next: i >= 0 && i < book.spine.length - 1 ? book.spine[i + 1].ref : null,
  };
}
