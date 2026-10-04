/**
 * Remove test accounts and test classes (Spec 18 §4).
 *
 *   npm run cleanup:test-data -- --domain rehearsal.invalid
 *   npm run cleanup:test-data -- --domain rehearsal.invalid --class <id> --apply
 *
 * A **dry run by default**: it prints, per table, what it would delete, and deletes nothing. Only
 * `--apply` deletes, and only after the operator types the database host back.
 *
 * What it will not do without being told:
 *   --include-work      an account holding an exam attempt, a submission or a grade is spared
 *   --include-faculty   an admin, or anyone who teaches a class, is spared
 *
 * Only reserved test domains are accepted (.invalid, .test, .example, .localhost), so this cannot
 * be pointed at wright.edu by a slip of the keyboard.
 *
 * It prints counts. No names, no addresses, no ids — except the class id the operator passed in,
 * which they already have.
 */
import { createInterface } from "node:readline/promises";
import { planCleanup, applyCleanup, hostOf, confirmed, type CleanupPlan } from "@/lib/cleanup";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const exact = argv.indexOf(`--${name}`);
  if (exact >= 0 && argv[exact + 1] && !argv[exact + 1].startsWith("--")) return argv[exact + 1];
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined ? joined.slice(name.length + 3) : undefined;
};

const options = {
  domain: value("domain"),
  sectionId: value("class"),
  includeWork: flag("include-work"),
  includeFaculty: flag("include-faculty"),
};
const apply = flag("apply");

function report(plan: CleanupPlan) {
  console.log("");
  console.log(`  domain:   ${plan.domain ?? "(none)"}`);
  console.log(`  class:    ${plan.sectionId ? "1 class, by id" : "(none)"}`);
  console.log("");
  console.log(`  accounts matching the domain:        ${plan.accounts.matched}`);
  console.log(`  accounts that would be deleted:      ${plan.accounts.deleting}`);
  if (plan.accounts.sparedHoldingWork)
    console.log(`  spared, they hold work:              ${plan.accounts.sparedHoldingWork}   (--include-work to delete them too)`);
  if (plan.accounts.sparedFacultyOrAdmin)
    console.log(`  spared, faculty or administrators:   ${plan.accounts.sparedFacultyOrAdmin}   (--include-faculty to delete them too)`);
  console.log("");
  const tables = Object.keys(plan.perTable).sort();
  if (!tables.length) console.log("  no rows would be deleted");
  else {
    console.log("  rows, per table:");
    const width = Math.max(...tables.map((t) => t.length));
    for (const t of tables) console.log(`    ${t.padEnd(width)}  ${plan.perTable[t]}`);
  }
  if (plan.orphanedUploads) {
    console.log("");
    console.log(`  uploaded files left in Blob storage: ${plan.orphanedUploads}`);
    console.log("    (their rows go; the objects stay. Nothing here deletes a blob.)");
  }
  console.log("");
}

try {
  const plan = await planCleanup(options);
  if (!apply) {
    console.log("DRY RUN — nothing will be deleted. Add --apply to do it.");
    report(plan);
    process.exit(0);
  }

  const host = hostOf(process.env.DATABASE_URL);
  if (!host) {
    console.error("DATABASE_URL is not set, or has no host. Refusing to delete anything.");
    process.exit(1);
  }
  console.log("ABOUT TO DELETE — this cannot be undone.");
  report(plan);
  console.log(`  database: ${host}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question("  Type the database host above to confirm: ");
  rl.close();
  if (!confirmed(typed, host)) {
    console.error("\nThat does not match. Nothing was deleted.");
    process.exit(1);
  }
  const done = await applyCleanup(options);
  console.log("\nDeleted.");
  report(done);
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
