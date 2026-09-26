import { promises as fs } from "node:fs";
import path from "node:path";
import { CONTENT_DIR } from "@/lib/content";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
};

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  // reject traversal; only serve from within the content tree
  if (parts.some((p) => p === ".." || p.includes("\0"))) {
    return new Response("Bad request", { status: 400 });
  }
  const file = path.join(CONTENT_DIR, ...parts);
  if (!file.startsWith(path.resolve(CONTENT_DIR))) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const buf = await fs.readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
