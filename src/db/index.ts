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
  // prepare:false keeps this compatible with transaction poolers (Supabase, PgBouncer, RDS Proxy).
  // DB_POOL_MAX caps connections per instance; on serverless hosts set it low (e.g. 3).
  _db = drizzle(postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX || 10) }), { schema });
  return _db;
}
export { schema };
