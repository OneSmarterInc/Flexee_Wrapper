// Integration test for the content store (src/lib/storage.ts), content.ts and the figure route.
// The S3 side runs against a mocked S3 that holds a byte-for-byte copy of the real content tree,
// so it proves the app serves identical books from a folder and from a bucket.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { FsStore, S3Store, BlobStore, CachedStore, NotFoundError, storeFromEnv, setContentStore, safeKey } from "@/lib/storage";
import { listBooks, getBook, getEntry, getToc } from "@/lib/content";
import { GET as assetGET } from "@/app/api/asset/[...path]/route";

const ROOT = path.join(process.cwd(), "content");
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

// --- a mocked bucket holding the real content tree under the prefix "live/"
async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...await walk(path.join(dir, d.name), rel)); else out.push(rel);
  }
  return out;
}
const PREFIX = "live/";
const objects = new Map<string, Uint8Array>();
for (const rel of await walk(ROOT)) objects.set(PREFIX + rel, new Uint8Array(await fs.readFile(path.join(ROOT, rel))));
const s3mock = mockClient(S3Client);
let s3Gets = 0;
s3mock.on(GetObjectCommand).callsFake((input: any) => {
  s3Gets++;
  const body = objects.get(input.Key);
  if (!body) { const e: any = new Error("NoSuchKey"); e.name = "NoSuchKey"; throw e; }
  return { Body: { transformToByteArray: async () => body } };
});
s3mock.on(ListObjectsV2Command).callsFake((input: any) => {
  // one "folder" per page, to exercise pagination
  const dirs = [...new Set([...objects.keys()].filter((k) => k.startsWith(input.Prefix))
    .map((k) => k.slice(input.Prefix.length)).filter((r) => r.includes("/")).map((r) => r.split("/")[0]))].sort();
  const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
  const page = dirs.slice(start, start + 1);
  const more = start + 1 < dirs.length;
  return { CommonPrefixes: page.map((d) => ({ Prefix: input.Prefix + d + "/" })), IsTruncated: more,
           NextContinuationToken: more ? String(start + 1) : undefined };
});
const s3 = new S3Store("flexee-books-test", "live", new S3Client({ region: "us-east-2" }));

// --- a simulated Vercel Blob store (private) holding the same tree, with the @vercel/blob call shapes
const blobAccessSeen = new Set<string>();
const fakeBlob = {
  async get(pathname: string, opts: { access: string }) {
    blobAccessSeen.add(opts.access);
    const body = objects.get(pathname);
    return body ? { statusCode: 200, stream: new Blob([body]).stream(), blob: { pathname } } : null;
  },
  async list({ prefix, mode, cursor }: { prefix: string; mode: string; cursor?: string }) {
    assert.equal(mode, "folded");
    const folders = [...new Set([...objects.keys()].filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length)).filter((r) => r.includes("/")).map((r) => prefix + r.split("/")[0] + "/"))].sort();
    const start = cursor ? Number(cursor) : 0; const page = folders.slice(start, start + 1); const more = start + 1 < folders.length;
    return { blobs: [], folders: page, hasMore: more, cursor: more ? String(start + 1) : undefined };
  },
};
const blob = new BlobStore("live", "private", fakeBlob);
const fsStore = new FsStore(ROOT);

console.log("Content store");
await t("keys refuse traversal", () => {
  assert.throws(() => safeKey("sad/../../etc/passwd"));
  assert.throws(() => safeKey("sad\\..\\x"));
  assert.equal(safeKey("/sad//ch01/./manifest.json"), "sad/ch01/manifest.json");
});
await t("disk and S3 list the same book folders (S3 across several pages)", async () => {
  assert.deepEqual(await s3.listDirs(""), await fsStore.listDirs(""));
  assert.deepEqual(await s3.listDirs("sad"), await fsStore.listDirs("sad"));
});
await t("disk and Blob list the same book folders (Blob across several pages)", async () => {
  assert.deepEqual(await blob.listDirs(""), await fsStore.listDirs(""));
  assert.deepEqual(await blob.listDirs("sad"), await fsStore.listDirs("sad"));
});
await t("a missing key is a NotFoundError on all three", async () => {
  await assert.rejects(fsStore.readText("sad/nope.json"), NotFoundError);
  await assert.rejects(s3.readText("sad/nope.json"), NotFoundError);
  await assert.rejects(blob.readText("sad/nope.json"), NotFoundError);
});
await t("settings choose the store and refuse a half-configured S3", () => {
  assert.equal(storeFromEnv({ CONTENT_STORE: "fs", CONTENT_CACHE_SECONDS: "0" }).kind, "fs");
  assert.equal(storeFromEnv({ CONTENT_STORE: "s3", CONTENT_BUCKET: "b" }).kind, "s3");
  assert.equal(storeFromEnv({ CONTENT_STORE: "blob" }).kind, "blob");
  assert.equal((storeFromEnv({ CONTENT_STORE: "blob", CONTENT_CACHE_SECONDS: "0" }) as BlobStore).access, "private"); // private unless told otherwise
  assert.throws(() => storeFromEnv({ CONTENT_STORE: "blob", CONTENT_BLOB_ACCESS: "open" }), /private/);
  assert.throws(() => storeFromEnv({ CONTENT_STORE: "s3" }), /CONTENT_BUCKET/);
  assert.throws(() => storeFromEnv({ CONTENT_STORE: "gcs" }), /must be/);
});
await t("the cache serves repeat reads without asking S3 again, and never caches a failure", async () => {
  const c = new CachedStore(s3, 60_000); const before = s3Gets;
  await c.readText("sad/book.manifest.json"); await c.readText("sad/book.manifest.json");
  assert.equal(s3Gets - before, 1);
  await assert.rejects(c.readText("sad/missing.json"), NotFoundError);
  objects.set(PREFIX + "sad/missing.json", new TextEncoder().encode("{}"));
  assert.equal(await c.readText("sad/missing.json"), "{}"); // a later success is not blocked by the earlier failure
  objects.delete(PREFIX + "sad/missing.json");
});

console.log("Books read identically from disk and from S3");
async function snapshot() {
  const books = await listBooks();
  const out: any = { books: books.map((b) => [b.id, b.title, b.spine.length]) };
  for (const b of books) {
    out[b.id] = { book: await getBook(b.id), toc: await getToc(b.id), entries: {} as any };
    for (const s of b.spine) {
      const e = await getEntry(b.id, s.ref);
      out[b.id].entries[s.ref] = { title: e.manifest.title, figures: e.manifest.figures.length, md: e.markdown };
    }
  }
  return out;
}
setContentStore(fsStore); const fromDisk = await snapshot();
setContentStore(new CachedStore(s3, 60_000)); const fromS3 = await snapshot();
setContentStore(new CachedStore(blob, 60_000)); const fromBlob = await snapshot();
await t("every book, table of contents, chapter text and figure list matches — disk, S3 and Blob", () => {
  assert.deepEqual(fromS3, fromDisk);
  assert.deepEqual(fromBlob, fromDisk);
  assert.deepEqual([...blobAccessSeen], ["private"]); // books were read as private blobs
  const chapters = Object.values(fromDisk).filter((v: any) => v?.entries).reduce((n: number, v: any) => n + Object.keys(v.entries).length, 0);
  console.log(`      ${fromDisk.books.length} books, ${chapters} entries compared`);
});
await t("intake bookkeeping folders (_archive, _staging) are never listed as books", async () => {
  objects.set(PREFIX + "_archive/sad_old/book.manifest.json", new TextEncoder().encode(JSON.stringify({ id: "x", title: "Old", spine: [] })));
  setContentStore(s3);
  assert.ok(!(await listBooks()).some((b) => b.title === "Old"));
  objects.delete(PREFIX + "_archive/sad_old/book.manifest.json");
});

console.log("Figure route");
const call = (p: string) => assetGET(new Request("http://x/api/asset/" + p), { params: Promise.resolve({ path: p.split("/") }) });
const aFigure = [...objects.keys()].find((k) => k.startsWith(PREFIX + "sad/") && k.endsWith(".png"))!.slice(PREFIX.length);
await t(`serves a figure from Blob (${aFigure})`, async () => {
  setContentStore(blob);
  const r = await call(aFigure);
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal((await r.arrayBuffer()).byteLength, objects.get(PREFIX + aFigure)!.byteLength);
  setContentStore(s3);
});
await t(`serves a figure from S3 (${aFigure})`, async () => {
  const r = await call(aFigure);
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal((await r.arrayBuffer()).byteLength, objects.get(PREFIX + aFigure)!.byteLength);
});
await t("refuses the answer key and any non-image (it used to serve them)", async () => {
  for (const p of ["mis3000/questions.json", "sad/book.manifest.json", "sad/ch01/manifest.json"]) {
    assert.equal((await call(p)).status, 404, p);
  }
});
await t("refuses path traversal", async () => { assert.equal((await call("../package.json")).status, 400); });
await t("a missing figure is 404, not an error", async () => { assert.equal((await call("sad/ch01/figures/none.png")).status, 404); });

s3mock.restore();
console.log(`\n${passed} passed`);
