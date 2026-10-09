import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Where the three kinds of file live on disk (Spec 28 Addendum D §1).
 *
 * On the AWS box these are directories under /var/lib/flexee, outside the git checkout — on the
 * root disk, since Addendum F dropped the separate volume. The setting is what matters here, not
 * the disk: moving them to a volume later changes three environment variables and nothing else.
 * Until
 * 9 October 2026 `CONTENT_DIR` was `/var/www/Flexee_Wrapper/content` — the git working tree, in
 * which all 148 files under `content/` are tracked — so publishing a book modified tracked files
 * and the deploy's `git pull --ff-only` then refused to overwrite them. `deploy/aws/deploy.sh`
 * refuses to run if any of these resolves inside the checkout.
 *
 * **The defaults keep local development and every suite working unchanged**, and they are
 * deliberately inside the repository, because that is the right place for them there: `content/`
 * is a test fixture as well as seed data — `it-storage.ts` reads it and compares it byte for byte
 * across disk, S3 and Blob. So "not inside the checkout" is a deployment rule, enforced by the
 * deploy script, not an invariant this module asserts.
 *
 * Read through these functions rather than `process.env` directly, so there is one place where a
 * default lives and one place to change.
 */

const repoRoot = () => process.cwd();

/**
 * Published book trees: `<CONTENT_DIR>/<book>/…`.
 *
 * The one setting of the three that already existed and is already honoured everywhere — ten
 * callers read it, from `storage.ts`'s `FsStore` to `sync-content.ts`. Nothing here changes that.
 */
export function contentDir(env: Record<string, string | undefined> = process.env): string {
  return env.CONTENT_DIR || path.join(repoRoot(), "content");
}

/**
 * Assignment attachments and student submissions.
 *
 * Separate from the books on purpose: different retention, different sensitivity, and a different
 * restore urgency. Books are regenerable from Drive in minutes; a submission is not regenerable at
 * all. Keeping them apart means a restore can bring back the irreplaceable half first, and means a
 * snapshot schedule can treat them differently later.
 *
 * Nothing reads this yet — the routes that will arrive in the next commit. It is here now so the
 * setting and its default are decided in one place before two callers invent their own.
 */
export function filesDir(env: Record<string, string | undefined> = process.env): string {
  return env.FILES_DIR || path.join(repoRoot(), "files");
}

/**
 * Where the intake unpacks and builds a book.
 *
 * Defaults to the system temp directory, which is exactly what `library-intake.ts` used before, so
 * nothing changes without the setting. It exists because on the box `/tmp` is on the **root** disk
 * with 9.5 GB free, shared with the OS, npm caches and five services — so moving `CONTENT_DIR` to
 * its own volume would not have moved the unpacking, and a 200 MB zip expands to a tree, is built
 * again, and is copied once more to the archive.
 */
export function intakeWorkDir(env: Record<string, string | undefined> = process.env): string {
  return env.INTAKE_WORK_DIR || tmpdir();
}

/**
 * Is `p` inside `root`? Used by the tests that pin the deploy script's rule, and available to any
 * future check that wants it.
 *
 * Compares resolved paths and treats "equal to" as "inside", because `CONTENT_DIR` being the
 * checkout root is the same fault as it being a directory within it. Purely lexical: it does not
 * resolve symlinks, which is why the deploy script uses `pwd -P` instead of calling this.
 */
export function isInside(p: string, root: string): boolean {
  const a = path.resolve(p), b = path.resolve(root);
  if (a === b) return true;
  return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}
