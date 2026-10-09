import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Where book content lives. Every read of a book — manifests, chapter text, figures — goes
 * through a ContentStore, so the app does not care whether books sit in a local folder or in
 * Amazon S3. Keys are "/"-separated paths relative to the content root, e.g. "sad/ch01/manifest.json".
 *
 * Settings (environment variables):
 *   CONTENT_STORE   "fs" (default), "blob" (Vercel Blob) or "s3"
 *   CONTENT_DIR     fs: the content folder (default ./content)
 *   CONTENT_PREFIX  blob and s3: path prefix for published books, e.g. "live/" (default "")
 *   CONTENT_BLOB_ACCESS  blob: "private" (default) or "public". Keep books private: private blobs
 *                   are readable only with the store's token, which never leaves the server
 *   BLOB_READ_WRITE_TOKEN  blob: set automatically when a Blob store is connected to the Vercel project
 *   CONTENT_BUCKET  s3: bucket name
 *   AWS_REGION      s3: bucket region (credentials come from the standard AWS environment:
 *                   an IAM role on AWS, or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY elsewhere)
 *   CONTENT_CACHE_SECONDS  how long an instance keeps a read in memory (default 300; 0 disables)
 */
export interface ContentStore {
  readonly kind: "fs" | "blob" | "s3";
  readText(key: string): Promise<string>;
  readBytes(key: string): Promise<Uint8Array>;
  /** Immediate child "folders" of a prefix, e.g. listDirs("") -> ["mis3000", "sad"]. */
  listDirs(prefix: string): Promise<string[]>;
}

export class NotFoundError extends Error {
  constructor(key: string) { super(`content not found: ${key}`); this.name = "NotFoundError"; }
}

/**
 * Directories inside the content root that are not books (Spec 28 commit 7).
 *
 * `listDirs("")` is how a book is found — `listBooks()` reads a manifest out of each name it
 * returns, and `/admin/status` counts them. In Vercel Blob the published books sat under the
 * `live/` prefix, so the intake's own directories were never among them. On a filesystem
 * `CONTENT_DIR` *is* the content root, and `runJob` writes `archive/<book>/<stamp>/` beside the
 * books, so the archive would be counted as a book — `/admin/status` would report "1 book folder"
 * on a store holding none, which is worse than reporting none, because it reads as healthy.
 *
 * `listBooks()` was already safe by accident: it tries to read `book.manifest.json` and skips a
 * directory that has none. The status check deliberately does not read manifests — it makes one
 * listing call and times it — so it needs this list.
 *
 * The leading underscore is the older convention for the same thing (`_staging`, and `_archive`,
 * which is what `content.ts` has always expected the archive to be called). Both rules are kept:
 * the underscore for anything the intake tools write, these names for what `runJob` writes.
 *
 * `uploads` is here for a different reason — nothing should ever put it in the content root, since
 * book zips live under `FILES_DIR`. It is listed so that a `CONTENT_DIR` and `FILES_DIR` pointed at
 * the same directory by mistake does not invent a book, and `live` in case a store root is ever
 * used as a content root.
 */
export const NOT_BOOK_DIRS: readonly string[] = ["archive", "uploads", "live"];

/** Is this a directory name that could be a book? Used wherever `listDirs("")` is turned into books. */
export function isBookDir(name: string): boolean {
  return !name.startsWith("_") && !NOT_BOOK_DIRS.includes(name.toLowerCase());
}

/** Keys come from URLs and manifests; refuse anything that could climb out of the content root. */
export function safeKey(key: string): string {
  const parts = key.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || p.includes("\0") || p.includes("\\"))) {
    throw new Error(`unsafe content key: ${key}`);
  }
  return parts.join("/");
}

export class FsStore implements ContentStore {
  readonly kind = "fs" as const;
  readonly root: string;
  constructor(root: string) { this.root = root; }
  private file(key: string) {
    const f = path.join(this.root, ...safeKey(key).split("/"));
    if (!path.resolve(f).startsWith(path.resolve(this.root))) throw new Error(`unsafe content key: ${key}`);
    return f;
  }
  async readText(key: string) {
    try { return await fs.readFile(this.file(key), "utf8"); }
    catch (e: any) { if (e?.code === "ENOENT") throw new NotFoundError(key); throw e; }
  }
  async readBytes(key: string) {
    try { return new Uint8Array(await fs.readFile(this.file(key))); }
    catch (e: any) { if (e?.code === "ENOENT") throw new NotFoundError(key); throw e; }
  }
  async listDirs(prefix: string) {
    try {
      const d = await fs.readdir(this.file(prefix || "."), { withFileTypes: true });
      return d.filter((x) => x.isDirectory()).map((x) => x.name).sort();
    } catch (e: any) { if (e?.code === "ENOENT") return []; throw e; }
  }
}

export class S3Store implements ContentStore {
  readonly kind = "s3" as const;
  readonly bucket: string;
  readonly prefix: string;
  private client: any;
  constructor(bucket: string, prefix = "", client?: any) {
    this.bucket = bucket;
    this.prefix = prefix && !prefix.endsWith("/") ? prefix + "/" : prefix;
    this.client = client;
  }
  private async s3() {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({ region: process.env.AWS_REGION });
    }
    return this.client;
  }
  private k(key: string) { return this.prefix + safeKey(key); }
  async readBytes(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const out = await (await this.s3()).send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return new Uint8Array(await out.Body.transformToByteArray());
    } catch (e: any) {
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) throw new NotFoundError(key);
      throw e;
    }
  }
  async readText(key: string) { return new TextDecoder().decode(await this.readBytes(key)); }
  async listDirs(prefix: string) {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const base = this.prefix + (prefix ? safeKey(prefix) + "/" : "");
    const dirs = new Set<string>(); let token: string | undefined;
    do {
      const out = await (await this.s3()).send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: base, Delimiter: "/", ContinuationToken: token }));
      for (const p of out.CommonPrefixes ?? []) dirs.add(p.Prefix.slice(base.length).replace(/\/$/, ""));
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return [...dirs].filter(Boolean).sort();
  }
}

/** Vercel Blob. Books are stored private: only the server, holding the store's token, can read them. */
export class BlobStore implements ContentStore {
  readonly kind = "blob" as const;
  readonly prefix: string;
  readonly access: "private" | "public";
  private api: any;
  constructor(prefix = "", access: "private" | "public" = "private", api?: any) {
    this.prefix = prefix && !prefix.endsWith("/") ? prefix + "/" : prefix;
    this.access = access;
    this.api = api;
  }
  private async blob() { return (this.api ??= await import("@vercel/blob")); }
  private k(key: string) { return this.prefix + safeKey(key); }
  async readBytes(key: string) {
    const r = await (await this.blob()).get(this.k(key), { access: this.access });
    if (!r || !r.stream) throw new NotFoundError(key);
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  }
  async readText(key: string) { return new TextDecoder().decode(await this.readBytes(key)); }
  async listDirs(prefix: string) {
    const base = this.prefix + (prefix ? safeKey(prefix) + "/" : "");
    const dirs = new Set<string>(); let cursor: string | undefined;
    do {
      const out = await (await this.blob()).list({ prefix: base, mode: "folded", cursor });
      for (const f of out.folders ?? []) dirs.add(f.slice(base.length).replace(/\/$/, ""));
      cursor = out.hasMore ? out.cursor : undefined;
    } while (cursor);
    return [...dirs].filter(Boolean).sort();
  }
}

/** Keeps recent reads in memory for a few minutes, so S3 is not asked for the same manifest on every page. */
export class CachedStore implements ContentStore {
  private cache = new Map<string, { at: number; value: Promise<any> }>();
  readonly inner: ContentStore;
  readonly ttlMs: number;
  readonly maxEntries: number;
  constructor(inner: ContentStore, ttlMs: number, maxEntries = 2000) {
    this.inner = inner; this.ttlMs = ttlMs; this.maxEntries = maxEntries;
  }
  get kind() { return this.inner.kind; }
  private get<T>(k: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(k), now = Date.now();
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = load();
    value.catch(() => this.cache.delete(k)); // never cache a failure
    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(k, { at: now, value });
    return value;
  }
  readText(key: string) { return this.get("t:" + key, () => this.inner.readText(key)); }
  readBytes(key: string) { return this.get("b:" + key, () => this.inner.readBytes(key)); }
  listDirs(prefix: string) { return this.get("d:" + prefix, () => this.inner.listDirs(prefix)); }
  clear() { this.cache.clear(); }
}

export function storeFromEnv(env: Record<string, string | undefined> = process.env): ContentStore {
  const kind = (env.CONTENT_STORE || "fs").toLowerCase();
  let base: ContentStore;
  if (kind === "blob") {
    const access = (env.CONTENT_BLOB_ACCESS || "private") as "private" | "public";
    if (access !== "private" && access !== "public") throw new Error('CONTENT_BLOB_ACCESS must be "private" or "public"');
    base = new BlobStore(env.CONTENT_PREFIX || "", access);
  } else if (kind === "s3") {
    if (!env.CONTENT_BUCKET) throw new Error("CONTENT_STORE=s3 needs CONTENT_BUCKET");
    base = new S3Store(env.CONTENT_BUCKET, env.CONTENT_PREFIX || "");
  } else if (kind === "fs") {
    base = new FsStore(env.CONTENT_DIR || path.join(process.cwd(), "content"));
  } else {
    throw new Error(`CONTENT_STORE must be "fs", "blob" or "s3", not "${kind}"`);
  }
  const ttl = Number(env.CONTENT_CACHE_SECONDS ?? 300);
  return ttl > 0 ? new CachedStore(base, ttl * 1000) : base;
}

let _store: ContentStore | null = null;
export function contentStore(): ContentStore {
  return (_store ??= storeFromEnv());
}
/** Tests only. */
export function setContentStore(s: ContentStore | null) { _store = s; }
