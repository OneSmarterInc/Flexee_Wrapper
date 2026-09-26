import { promises as fs } from "node:fs";
import path from "node:path";

// The content tree produced by the intake tools. Override with CONTENT_DIR.
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

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

export async function listBooks(): Promise<BookManifest[]> {
  const dirs = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  const books: BookManifest[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const mp = path.join(CONTENT_DIR, d.name, "book.manifest.json");
    try {
      books.push(await readJson<BookManifest>(mp));
    } catch {
      /* not a book dir */
    }
  }
  return books.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getBook(bookId: string): Promise<BookManifest> {
  return readJson<BookManifest>(path.join(CONTENT_DIR, bookId, "book.manifest.json"));
}

export async function getEntry(bookId: string, entryId: string) {
  const dir = path.join(CONTENT_DIR, bookId, entryId);
  const manifest = await readJson<EntryManifest>(path.join(dir, "manifest.json"));
  const markdown = await fs.readFile(path.join(dir, manifest.content), "utf8");
  return { manifest, markdown, dir };
}

// spine with resolved titles, for a book's table of contents
export async function getToc(bookId: string) {
  const book = await getBook(bookId);
  const items = await Promise.all(
    book.spine.map(async (s) => {
      const m = await readJson<EntryManifest>(
        path.join(CONTENT_DIR, bookId, s.ref, "manifest.json"),
      );
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
