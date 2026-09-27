import path from "node:path";
import { contentStore, NotFoundError } from "@/lib/storage";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
};

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  // reject traversal; only serve from within the content store
  if (parts.some((p) => p === ".." || p.includes("\0") || p.includes("\\"))) {
    return new Response("Bad request", { status: 400 });
  }
  const key = parts.join("/");
  const type = TYPES[path.extname(key).toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 }); // figures only, never manifests or text
  try {
    const bytes = await contentStore().readBytes(key);
    return new Response(bytes.slice(), { // slice() gives the plain ArrayBuffer-backed copy Response expects
      headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    return new Response("Could not read figure", { status: 502 });
  }
}
