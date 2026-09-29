// Apply all generated migrations to the database (production-safe; no drizzle-kit).
// docker compose run --rm app npm run db:deploy
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false });
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
console.log("migrations applied.");
await sql.end();
