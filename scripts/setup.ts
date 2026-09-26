// One-shot production setup: migrate, then load content, objectives+questions, and seed sections.
// docker compose run --rm app npm run db:setup
import { spawnSync } from "node:child_process";
const steps = [["scripts/migrate.ts","migrate"],["scripts/sync-content.ts","sync content"],["scripts/sync-questions.ts","sync objectives+questions"],["scripts/seed.ts","seed sections"]];
for (const [file,label] of steps) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", file], { stdio: "inherit", env: process.env });
  if (r.status !== 0) { console.error(`Step failed: ${label}`); process.exit(r.status ?? 1); }
}
console.log("\nSetup complete.");
