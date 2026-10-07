// The library intake job, run by .github/workflows/library-intake.yml when someone uploads a book
// in the app (action "check") or adds a checked book to the library (action "publish").
//
//   check:   download the uploaded zip from Blob, find the book's register, run the intake
//            (tools/flexee_intake.py with the pinned validator tools/build_questions.py) and write
//            its report and status (ready | stopped) back to the database.
//   publish: check again (the same zip, so the same result), approve into a working content tree,
//            archive the book's current files in Blob (archive/<book>/<time>/), upload the new ones
//            to live/<book>/, and load chapters and questions into the database.
//
// Nothing reaches students here: a class's faculty still publish the book to their class.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getUpload, setStatus } from "@/lib/library";

export interface BlobOps {
  download(pathname: string): Promise<Uint8Array>;
  list(prefix: string): Promise<string[]>;            // pathnames
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  del(pathnames: string[]): Promise<void>;
}

/** Vercel Blob, private. Needs BLOB_READ_WRITE_TOKEN. */
export async function vercelBlob(): Promise<BlobOps> {
  const b = await import("@vercel/blob");
  return {
    async download(p) {
      const r = await b.get(p, { access: "private" });
      if (!r || !r.stream) throw new Error(`upload not found in Blob: ${p}`);
      return new Uint8Array(await new Response(r.stream).arrayBuffer());
    },
    async list(prefix) {
      const out: string[] = []; let cursor: string | undefined;
      do { const r = await b.list({ prefix, cursor }); out.push(...r.blobs.map((x) => x.pathname)); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
      return out;
    },
    async put(p, bytes, contentType) {
      await b.put(p, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
    },
    async copy(from, to) { await b.copy(from, to, { access: "private", addRandomSuffix: false, allowOverwrite: true }); },
    async del(ps) { for (let i = 0; i < ps.length; i += 100) await b.del(ps.slice(i, i + 100)); },
  };
}

const TYPES: Record<string, string> = { ".json": "application/json", ".md": "text/markdown", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp" };
const REPO = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(path.join(dir, d.name), rel)); else out.push(rel);
  }
  return out;
}

/** The folder in the unzipped upload that holds STATE_OF_RECORD.md (the book's CURRENT folder). */
export function findShelf(root: string): string {
  const hits = walk(root).filter((f) => path.basename(f) === "STATE_OF_RECORD.md" && !f.split("/").some((p) => p.startsWith("Archive")));
  if (hits.length === 0) throw new Error("The zip has no STATE_OF_RECORD.md. Upload the book's CURRENT folder (e.g. FZ1001_v2_CURRENT), zipped whole.");
  if (hits.length > 1) throw new Error(`The zip holds more than one book register (${hits.join(", ")}). Upload one book's CURRENT folder.`);
  return path.join(root, path.dirname(hits[0]));
}

function registerVersion(shelf: string) {
  const t = readFileSync(path.join(shelf, "STATE_OF_RECORD.md"), "utf8").replace(/\\/g, "").replace(/\*/g, "");
  return t.match(/Register version:\s*v?([\d.]+)/)?.[1] ?? null;
}

function intake(args: string[]) {
  // PYTHONIOENCODING: the intake's report carries arrows and dashes, which a Windows console's
  // cp1252 stdout cannot encode — without this the tool dies printing its own report and the job
  // reads that as a stopped intake. A no-op where stdout is already UTF-8, as in CI.
  const r = spawnSync("python3", [path.join(REPO, "tools/flexee_intake.py"), ...args], {
    encoding: "utf8", cwd: REPO, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

export type SyncDb = (contentDir: string) => void;
/** Load chapters and questions from a content tree into the database (the existing loader scripts). */
export const syncDbWithScripts: SyncDb = (contentDir) => {
  for (const s of ["db:sync-content", "db:sync-questions"]) {
    const r = spawnSync("npm", ["run", "-s", s], { cwd: REPO, encoding: "utf8", env: { ...process.env, CONTENT_DIR: contentDir } });
    if (r.status !== 0) throw new Error(`${s} failed: ${(r.stderr || r.stdout).slice(-800)}`);
  }
};

export async function runJob(opts: { uploadId: string; action: "check" | "publish"; blob: BlobOps; syncDb?: SyncDb; runUrl?: string; prefix?: string; now?: Date }) {
  const { uploadId, action, blob } = opts; const prefix = opts.prefix ?? "live/";
  const up = await getUpload(uploadId);
  if (!up) throw new Error(`no such upload: ${uploadId}`);
  if (process.env.INTAKE_BOOK_ID && process.env.INTAKE_BOOK_ID !== up.bookId) throw new Error("The workflow book id does not match the upload.");
  if (action === "check" && up.status !== "checking") return "skipped";
  if (action === "publish" && (up.status !== "publishing" || !up.publishedBy)) return "skipped";
  const runUrl = opts.runUrl ?? null;
  let work: string | undefined;
  try {
    work = mkdtempSync(path.join(tmpdir(), "library-"));
    const zip = path.join(work, "upload.zip");
    const bytes = await blob.download(up.blobPath);
    if (bytes.byteLength > 200 * 1024 * 1024) throw new Error("The book zip exceeds 200 MB.");
    writeFileSync(zip, bytes);
    const unz = spawnSync("python3", [path.join(REPO, "tools/safe_unzip.py"), zip, path.join(work, "shelf")], { encoding: "utf8" });
    if (unz.status !== 0) throw new Error(`The upload is not a readable zip file. ${(unz.stderr || "").trim()}`);
    const shelf = findShelf(path.join(work, "shelf"));
    const regV = registerVersion(shelf);
    const out = path.join(work, "content");
    const validator = path.join(REPO, "tools/build_questions.py");

    // Spec 16: bring the last admitted lock down so the integrity gate has something to compare.
    // The gate reads <out>/<book>/intake.lock.json, and this job builds in a fresh temp directory,
    // so without this every run reported "first admission" and the check never fired.
    //
    // A failure here is never fatal: an absent lock is a genuine first admission, and an unreadable
    // one is reported as a warning and treated the same way. Nothing is written to storage.
    let lockNote = "";
    try {
      const lockBytes = await blob.download(`${prefix}${up.bookId}/intake.lock.json`);
      const dir = path.join(out, up.bookId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "intake.lock.json"), lockBytes);
      JSON.parse(new TextDecoder().decode(lockBytes));        // readable? the gate will parse it too
    } catch (e: any) {
      const existing = await blob.list(`${prefix}${up.bookId}/intake.lock.json`).catch(() => []);
      if (existing.length) {
        lockNote = `The previous intake lock could not be read (${String(e?.message ?? e).slice(0, 120)}); `
          + "this run was checked as a first admission.";
        console.error(`Library intake: ${lockNote}`);
        rmSync(path.join(out, up.bookId, "intake.lock.json"), { force: true });
      }
    }

    const check = intake(["--book-id", up.bookId, "--local", shelf, "--validator", validator, "--out", out]);
    const reportFile = path.join(out, `_intake_report_${up.bookId}.md`);
    const report = existsSync(reportFile) ? readFileSync(reportFile, "utf8") : check.out.slice(-6000);
    if (check.code !== 0) {
      await setStatus(uploadId, "stopped", { report, registerVersion: regV, runUrl, message: "The intake stopped. Nothing was added to the library." });
      return "stopped";
    }
    if (action === "check") {
      await setStatus(uploadId, "ready", { report, registerVersion: regV, runUrl, message: lockNote || null });
      return "ready";
    }

    // publish
    const appr = intake(["--book-id", up.bookId, "--out", out, "--approve"]);
    if (appr.code !== 0) throw new Error(`approve failed: ${appr.out.slice(-800)}`);
    const tree = path.join(out, up.bookId);
    if (!existsSync(path.join(tree, "book.manifest.json"))) throw new Error("approve produced no book tree");
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const current = await blob.list(`${prefix}${up.bookId}/`);
    for (const p of current) await blob.copy(p, `archive/${up.bookId}/${stamp}/${p.slice(prefix.length + up.bookId.length + 1)}`);
    const files = walk(tree).filter((rel) => rel !== "questions.json" && rel !== "objectives.json");
    const next = files.map((rel) => `${prefix}${up.bookId}/${rel}`);
    try {
      for (let i = 0; i < files.length; i++) {
        const rel = files[i];
        await blob.put(next[i], new Uint8Array(readFileSync(path.join(tree, rel))), TYPES[path.extname(rel).toLowerCase()] ?? "application/octet-stream");
      }
      (opts.syncDb ?? syncDbWithScripts)(out);
      const stale = current.filter((p) => !next.includes(p));
      if (stale.length) await blob.del(stale);
    } catch (error) {
      // Restore the old live tree if publishing or the database load fails.
      try {
        for (const p of current) await blob.copy(`archive/${up.bookId}/${stamp}/${p.slice(prefix.length + up.bookId.length + 1)}`, p);
        const added = next.filter((p) => !current.includes(p));
        if (added.length) await blob.del(added);
      } catch (restoreError) {
        throw new Error(`Publishing failed and restoring the previous book failed: ${String(restoreError)}`, { cause: error });
      }
      throw error;
    }
    await setStatus(uploadId, "published", { report, registerVersion: regV, runUrl, publishedAt: new Date(),
      message: `In the library. ${current.length ? `The previous version is archived under archive/${up.bookId}/${stamp}/.` : ""}` });
    return "published";
  } catch (e: any) {
    console.error(`Library intake failed: ${String(e?.message ?? e).slice(0, 600)}`);
    await setStatus(uploadId, "failed", { runUrl, message: `The job failed: ${String(e?.message ?? e).slice(0, 600)}` });
    return "failed";
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

// ---- command line (the GitHub Action) ------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const uploadId = arg("upload"), action = arg("action");
  if (!uploadId || (action !== "check" && action !== "publish" && action !== "fail")) {
    console.error("usage: library-intake --upload <id> --action check|publish|fail"); process.exit(1);
  }
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
  if (action === "fail") { // the workflow's safety net if the job died before reporting
    const up = await getUpload(uploadId!);
    // Keep the specific error already recorded by runJob; only report an unhandled interruption.
    if (up && (up.status === "checking" || up.status === "publishing")) {
      await setStatus(uploadId!, "failed", { runUrl: runUrl ?? null, message: "The intake job stopped unexpectedly. See the run log." });
    }
    process.exit(0);
  }
  const status = await runJob({ uploadId: uploadId!, action: action as "check" | "publish", blob: await vercelBlob(), runUrl });
  console.log(`upload ${uploadId}: ${status}`);
  process.exit(status === "failed" ? 1 : 0);
}
