import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
const client = new PGlite();
for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort())
  for (const s of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) { const t = s.trim(); if (t) await client.exec(t); }
const _db = drizzle(client, { schema });
export function db() { return _db; }
export { schema };
