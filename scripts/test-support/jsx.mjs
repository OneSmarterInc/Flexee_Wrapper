// Lets a test import a real .tsx component. Node's type stripping removes TypeScript annotations
// but does not transform JSX, so a .tsx file cannot be loaded without this. esbuild does the
// transform in memory; nothing is written and no build step is involved.
//
// Only scripts/test-support/register-tsx.mjs registers this, so the other suites' loader is
// unchanged. Used so component tests exercise the real components instead of a copy of their markup.
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { transform } from "esbuild";

// next/link and next/navigation only resolve inside Next's own bundler, so a component that uses
// them cannot be imported here without a stand-in. The stubs render the same anchor and make the
// router a no-op, which is all a markup test needs; anything depending on real routing is tested
// through the pure helpers in src/lib instead.
const STUBS = new Map([
  ["next/link", "next-link.mjs"],
  ["next/navigation", "next-navigation.mjs"],
]);
const here = path.dirname(fileURLToPath(import.meta.url));

export async function resolve(spec, ctx, next) {
  const stub = STUBS.get(spec);
  if (stub) return { url: pathToFileURL(path.join(here, stub)).href, shortCircuit: true };
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, ctx);
  const source = await readFile(fileURLToPath(url), "utf8");
  const { code } = await transform(source, {
    loader: "tsx",
    jsx: "automatic",
    format: "esm",
    target: "node20",
    sourcefile: fileURLToPath(url),
  });
  return { format: "module", source: code, shortCircuit: true };
}
