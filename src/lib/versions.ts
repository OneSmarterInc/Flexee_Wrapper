import "server-only";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { diffLines } from "diff";
import { db } from "@/db";
import { chapterVersions, sectionContentPins, sections } from "@/db/schema";
import { getBook, getEntry, type EntryManifest } from "@/lib/content";

// Record a new immutable version for an entry from explicit content. Deduped by
// content hash: identical content never creates a second version. Errata versions
// are pushed automatically to every section pinned on this entry.
export async function recordVersion(
  bookId: string, entryId: string, markdown: string, manifest: EntryManifest,
  contentHash: string, kind: "feature" | "errata" = "feature",
) {
  const existing = await db().select().from(chapterVersions)
    .where(and(eq(chapterVersions.bookId, bookId), eq(chapterVersions.entryId, entryId), eq(chapterVersions.contentHash, contentHash))).limit(1);
  if (existing[0]) return { version: existing[0], created: false };

  const top = await db().select({ v: max(chapterVersions.version) }).from(chapterVersions)
    .where(and(eq(chapterVersions.bookId, bookId), eq(chapterVersions.entryId, entryId)));
  const nextVersion = (top[0]?.v ?? 0) + 1;
  const [row] = await db().insert(chapterVersions).values({
    bookId, entryId, version: nextVersion, contentHash, kind,
    title: manifest.title, markdown, manifestJson: JSON.stringify(manifest),
  }).returning();

  if (kind === "errata") {
    const secIds = (await db().select({ id: sections.id }).from(sections).where(eq(sections.bookId, bookId))).map((s) => s.id);
    if (secIds.length) {
      await db().update(sectionContentPins).set({ versionId: row.id, updatedAt: new Date() })
        .where(and(inArray(sectionContentPins.sectionId, secIds), eq(sectionContentPins.entryId, entryId)));
    }
  }
  return { version: row, created: true };
}

// Snapshot the current content tree into the version store (first run -> v1 all).
export async function syncFromTree(bookId: string) {
  const book = await getBook(bookId);
  let created = 0;
  for (const s of book.spine) {
    const { manifest, markdown } = await getEntry(bookId, s.ref);
    const r = await recordVersion(bookId, s.ref, markdown, manifest, manifest.contentHash, "feature");
    if (r.created) created++;
  }
  return created;
}

export async function latestVersion(bookId: string, entryId: string) {
  return (await db().select().from(chapterVersions)
    .where(and(eq(chapterVersions.bookId, bookId), eq(chapterVersions.entryId, entryId)))
    .orderBy(desc(chapterVersions.version)).limit(1))[0] ?? null;
}

export async function getVersion(id: string) {
  return (await db().select().from(chapterVersions).where(eq(chapterVersions.id, id)).limit(1))[0] ?? null;
}

// Pin every entry of a book to its latest version — called when a section is created.
export async function pinSectionToLatest(sectionId: string, bookId: string) {
  const book = await getBook(bookId);
  for (const s of book.spine) {
    const v = await latestVersion(bookId, s.ref);
    if (!v) continue;
    await db().insert(sectionContentPins).values({ sectionId, entryId: s.ref, versionId: v.id })
      .onConflictDoUpdate({ target: [sectionContentPins.sectionId, sectionContentPins.entryId], set: { versionId: v.id, updatedAt: new Date() } });
  }
}

// The student's view: content the section is pinned to, else the working tree.
export async function resolveEntryForSection(sectionId: string, bookId: string, entryId: string) {
  const pin = (await db().select({ versionId: sectionContentPins.versionId }).from(sectionContentPins)
    .where(and(eq(sectionContentPins.sectionId, sectionId), eq(sectionContentPins.entryId, entryId))).limit(1))[0];
  if (pin) {
    const v = await getVersion(pin.versionId);
    if (v) return { markdown: v.markdown, manifest: JSON.parse(v.manifestJson) as EntryManifest };
  }
  return getEntry(bookId, entryId); // fallback: current tree
}

// Per-entry status for the instructor: what the section reads vs what's available.
export async function sectionContentStatus(sectionId: string, bookId: string) {
  const book = await getBook(bookId);
  const pins = await db().select().from(sectionContentPins).where(eq(sectionContentPins.sectionId, sectionId));
  const pinByEntry = new Map(pins.map((p) => [p.entryId, p.versionId]));
  const out = [];
  for (const s of book.spine) {
    const latest = await latestVersion(bookId, s.ref);
    const pinnedId = pinByEntry.get(s.ref) ?? null;
    const pinned = pinnedId ? await getVersion(pinnedId) : null;
    out.push({
      entryId: s.ref, kind: s.kind, title: latest?.title ?? s.ref,
      pinnedVersion: pinned?.version ?? null, latestVersion: latest?.version ?? null,
      latestVersionId: latest?.id ?? null, latestKind: latest?.kind ?? null,
      hasUpdate: !!(latest && pinned && latest.version > pinned.version),
      unpinned: !pinned,
    });
  }
  return out;
}

export async function publishToSection(sectionId: string, entryId: string, versionId: string) {
  await db().insert(sectionContentPins).values({ sectionId, entryId, versionId })
    .onConflictDoUpdate({ target: [sectionContentPins.sectionId, sectionContentPins.entryId], set: { versionId, updatedAt: new Date() } });
}

export type DiffLine = { type: "add" | "del" | "ctx"; value: string };
export async function diffVersions(fromId: string, toId: string): Promise<DiffLine[]> {
  const [a, b] = await Promise.all([getVersion(fromId), getVersion(toId)]);
  if (!a || !b) return [];
  const parts = diffLines(a.markdown, b.markdown);
  const lines: DiffLine[] = [];
  for (const p of parts) {
    const type = p.added ? "add" : p.removed ? "del" : "ctx";
    for (const ln of p.value.replace(/\n$/, "").split("\n")) lines.push({ type, value: ln });
  }
  return lines;
}
