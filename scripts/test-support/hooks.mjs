// Lets integration tests import real src/lib modules: maps "@/..." to src/, stubs
// "server-only", and swaps "@/db" for an in-memory PGlite database.
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export async function resolve(spec, ctx, next) {
  if (spec === "server-only") return { url: pathToFileURL(path.join(root, "scripts/test-support/empty.mjs")).href, shortCircuit: true };
  if (spec === "@/db") return { url: pathToFileURL(path.join(root, "scripts/test-support/testdb.ts")).href, shortCircuit: true };
  if (spec.startsWith("@/")) {
    const base = path.join(root, "src", spec.slice(2));
    for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  if (spec.startsWith(".") && ctx.parentURL?.includes("/src/") && !path.extname(spec)) {
    const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
