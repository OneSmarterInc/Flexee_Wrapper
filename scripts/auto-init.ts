// Called by Vercel's production build after Neon has supplied DATABASE_URL.
// Apply migrations on every deployment, and load bundled content only into an
// empty database. In particular, never repin an existing class on a redeploy.
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.VERCEL_ENV !== "production") {
  console.log("Database initialization skipped outside Vercel production.");
  process.exit(0);
}

const runtimeUrl = process.env.DATABASE_URL;
if (!runtimeUrl) {
  console.error("Production build needs DATABASE_URL from the connected Postgres store.");
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED || runtimeUrl;
if (url !== runtimeUrl) {
  // The direct and pooled Neon endpoints must name the same branch and DB.
  // Refuse to seed a stale database if a manual variable survived the switch.
  const direct = new URL(url);
  const runtime = new URL(runtimeUrl);
  if (runtime.hostname.replace("-pooler.", ".") !== direct.hostname ||
      runtime.pathname !== direct.pathname || runtime.username !== direct.username) {
    throw new Error("DATABASE_URL and DATABASE_URL_UNPOOLED point to different databases.");
  }
}

const childEnv = { ...process.env, DATABASE_URL: url };
async function run(file: string, label: string) {
  console.log(`\n=== ${label} ===`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", file], {
      cwd: process.cwd(), env: childEnv, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${label} exited with ${code}`)));
  });
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  // A transaction-scoped advisory lock works with both direct and pooled Neon
  // URLs. It serializes overlapping production builds, including migration.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(49503000)`;
    await run("scripts/migrate.ts", "apply migrations");

    const [state] = await tx`SELECT
      EXISTS (SELECT 1 FROM chapter_versions) AS has_chapters,
      EXISTS (SELECT 1 FROM learning_objectives) AS has_objectives,
      EXISTS (SELECT 1 FROM questions) AS has_questions,
      EXISTS (SELECT 1 FROM sections) AS has_sections,
      EXISTS (SELECT 1 FROM section_content_pins) AS has_pins`;

    if (!state.has_chapters) await run("scripts/sync-content.ts", "load initial chapters");
    if (!state.has_questions || !state.has_objectives) {
      await run("scripts/sync-questions.ts", "load initial question bank");
    }
    if (!state.has_sections || !state.has_pins) {
      await run("scripts/seed.ts", "create initial book sections");
    }

    const [ready] = await tx`SELECT
      EXISTS (SELECT 1 FROM chapter_versions) AS has_chapters,
      EXISTS (SELECT 1 FROM questions) AS has_questions,
      EXISTS (SELECT 1 FROM sections) AS has_sections`;
    if (!ready.has_chapters || !ready.has_questions || !ready.has_sections) {
      throw new Error("Database initialization incomplete: check the bundled books and build log.");
    }
  });
  console.log("Database ready.");
} finally {
  await sql.end();
}
