// Lets command-line jobs (e.g. scripts/library-intake.ts in GitHub Actions) import real src/ modules:
// maps "@/..." to src/ and stubs "server-only". Unlike scripts/test-support, it uses the real database.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("../../", import.meta.url).pathname);
export async function resolve(spec, ctx, next) {
  if (spec === "server-only") return { url: pathToFileURL(path.join(root, "scripts/test-support/empty.mjs")).href, shortCircuit: true };
  if (spec.startsWith("@/")) {
    const base = path.join(root, "src", spec.slice(2));
    for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  if (spec.startsWith(".") && ctx.parentURL?.includes("/src/") && !path.extname(spec)) {
    const base = path.resolve(path.dirname(new URL(ctx.parentURL).pathname), spec);
    for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
