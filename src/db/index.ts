import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy singleton so importing this module never opens a connection (keeps
// `next build` working without a database; the connection opens on first query).
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function db() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _db = drizzle(postgres(url, { prepare: false }), { schema });
  return _db;
}
export { schema };
