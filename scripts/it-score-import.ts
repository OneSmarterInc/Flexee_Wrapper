// Integration test: Spec 23 rules 2, 3, 5, 6, 7, 8 and 10 — matching, the preview, and applying.
//
// Every student here is invented and every address is a reserved .invalid one, so no real student
// data is in the repository. The two checks worth having are the census — the preview writes
// nothing, proved by counting every table either side rather than by reading the function — and the
// log capture, which runs the whole flow with every console channel recorded and then searches that
// transcript for the students' own names, addresses and scores.
import assert from "node:assert/strict";
import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { gradebook, listLineItems, addManualItem, setScore, setSimRule } from "@/lib/gradebook";
import { previewScoreImport, applyScoreImport, replaceLabel, nothingToApply } from "@/lib/score-preview";
import { actionsFor, describeAction } from "@/lib/class-actions";

const { users, identities, enrolments, sections, lineItems, lineItemScores, classActions,
        sims, classSims, exams, examAttempts } = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

// ------------------------------------------------------------------------------- an invented class

async function account(name: string, email: string, d2l?: string) {
  const [u] = await db().insert(users).values({ displayName: name, ...(d2l ? { d2lUsername: d2l } : {}) }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}

const admin = await account("Ada Admin", "admin@flexee.invalid");
await setAdminByEmail("admin@flexee.invalid");
const prof = await account("Pat Professor", "prof@flexee.invalid");
const other = await account("Other Professor", "prof2@flexee.invalid");

const sec = await createSection(prof.id, "sad", "Spring Section A", "2027 Spring", { teach: true });
await db().update(sections).set({ bookPublishedAt: new Date() }).where(eq(sections.id, sec.id));

type Who = { name: string; email: string; d2l?: string; enrolmentId: string; userId: string };
const roster: Record<string, Who> = {};
async function student(key: string, name: string, email: string, d2l?: string,
                       opts: { withdrawn?: boolean; demo?: boolean } = {}) {
  const u = await account(name, email, d2l);
  const [e] = await db().insert(enrolments).values({
    sectionId: sec.id, userId: u.id, role: "student",
    ...(opts.withdrawn ? { withdrawnAt: new Date(), withdrawnBy: prof.id } : {}),
    ...(opts.demo ? { isDemo: true } : {}),
  }).returning();
  roster[key] = { name, email, d2l, enrolmentId: e.id, userId: u.id };
}

await student("maria", "Maria Alvarez", "maria.alvarez@example.invalid", "alvarez.7");
await student("sean", "Sean O'Brien", "sean.obrien@example.invalid", "obrien.3");
await student("kofi", "Kofi Mensah", "kofi.mensah@example.invalid");          // no D2L username
await student("lena", "Lena Petrova", "lena.petrova@example.invalid", "petrova.2");
await student("noah", "Noah Adeyemi", "noah.adeyemi@example.invalid", "adeyemi.4");
await student("gone", "Withdrawn Wendy", "wendy@example.invalid", "wendy.9", { withdrawn: true });
await student("demo", "Demo Student", "demo@example.invalid", "demo.1", { demo: true });

await addManualItem(sec.id, "Studio session", 10, 1);
const col = (await listLineItems(sec.id)).find((i) => i.title === "Studio session")!;
console.log(`\na class of ${Object.keys(roster).length} (one withdrawn, one demo), column out of ${col.maxPoints}`);

// ------------------------------------------------------------------------------------ the census

const TABLES = ["users", "identities", "sessions", "sections", "enrolments", "line_items",
  "line_item_scores", "class_actions", "exam_attempts", "submissions", "bookmarks",
  "assistant_threads", "sim_completions", "grading_categories", "letter_scales"];

async function census() {
  const out: Record<string, number> = {};
  for (const tb of TABLES) {
    const r: any = await db().execute(sql.raw(`SELECT COUNT(*)::int AS c FROM "${tb}"`));
    const rows = r.rows ?? r;
    out[tb] = Number(rows[0].c);
  }
  return out;
}

const pointsOf = async (enrolmentId: string) =>
  (await db().select().from(lineItemScores)
    .where(and(eq(lineItemScores.lineItemId, col.id), eq(lineItemScores.enrolmentId, enrolmentId))).limit(1))[0]?.points ?? null;

// A file naming students the two ways the spec allows, plus every kind of problem.
const FILE = [
  `Name,Email,OrgDefinedId,Score,Comment`,
  `"Alvarez, Maria",maria.alvarez@example.invalid,W001,8,"good, thorough"`,
  `"O'Brien, Sean",obrien.3,W002,9.5,matched by D2L username`,
  `"Mensah, Kofi",kofi.mensah@example.invalid,W003,,no score yet`,
  `"Petrova, Lena",lena.petrova@example.invalid,W004,7.129,needs rounding`,
  `"Nobody, Nemo",nemo@example.invalid,W005,5,not in this class`,
  `"Alvarez, Maria",maria.alvarez@example.invalid,W001,3,the same student twice`,
  `"Adeyemi, Noah",noah.adeyemi@example.invalid,W008,abc,not a number`,
  `"Withdrawn, Wendy",wendy.9,W006,6,withdrawn`,
  `"Demo, Student",demo.1,W007,10,the demo account`,
].join("\r\n") + "\r\n";

await t("the preview writes nothing at all, proved by a census over 15 tables", async () => {
  const before = await census();
  const p = await previewScoreImport(sec.id, col.id, FILE);
  const after = await census();
  assert.deepEqual(after, before, "the preview wrote something");
  assert.ok(p.changes.length > 0, "and it produced no plan either, so the census proves nothing");
  console.log(`      ${p.changes.length} changes planned, ${p.excluded.length} rows excluded, nothing written`);
});

await t("matching is by stored D2L username first, then by email", async () => {
  const p = await previewScoreImport(sec.id, col.id, FILE);
  const by = new Map(p.changes.map((c) => [c.name, c]));
  assert.ok(by.has("Maria Alvarez"), "matched by email");
  assert.ok(by.has("Sean O'Brien"), "matched by D2L username");
  assert.equal(by.get("Maria Alvarez")!.to, 8);
  assert.equal(by.get("Sean O'Brien")!.to, 9.5);

  // A student with no D2L username is still reachable by email.
  assert.equal(roster.kofi.d2l, undefined);
  const only = await previewScoreImport(sec.id, col.id, `Email,Score\nkofi.mensah@example.invalid,4\n`);
  assert.deepEqual(only.changes.map((c) => [c.name, c.to]), [["Kofi Mensah", 4]]);

  // And the username column matches a stored username, not an email's local part.
  const byName = await previewScoreImport(sec.id, col.id, `UserName,Score\npetrova.2,6\n`);
  assert.deepEqual(byName.changes.map((c) => [c.name, c.to]), [["Lena Petrova", 6]]);
});

await t("when one string is one student's username and another's email, the username wins", async () => {
  // Rule 2 says username first, then email, and this is the case where the order decides rather
  // than being a formality. d2l.ts documents it: "a UserName that is already an address is used as
  // it is", so a stored D2L username really can be an address — and it can be somebody else's.
  const shared = "shared.id@example.invalid";
  await student("twin", "Twin Username", "twin.real@example.invalid", shared);
  await student("owner", "Email Owner", shared, "owner.5");

  const p = await previewScoreImport(sec.id, col.id, `Email,Score
${shared},6
`);
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].name, "Twin Username",
    "matched by email first — rule 2 asks for the D2L username first");
  assert.equal(p.changes[0].enrolmentId, roster.twin.enrolmentId);

  // and the other student is then simply one the file says nothing about
  assert.ok(p.noRowFor.includes("Email Owner"));
  delete roster.twin; delete roster.owner;     // out of the shared fixtures below
  await db().delete(enrolments).where(eq(enrolments.userId, (await db().select().from(users)
    .where(eq(users.displayName, "Twin Username")).limit(1))[0].id));
  await db().delete(enrolments).where(eq(enrolments.userId, (await db().select().from(users)
    .where(eq(users.displayName, "Email Owner")).limit(1))[0].id));
});

await t("unmatched and duplicate rows are listed by the identifier as typed, and excluded", async () => {
  const p = await previewScoreImport(sec.id, col.id, FILE);
  assert.equal(p.counts.unmatched, 1);
  assert.equal(p.counts.duplicates, 1);
  const un = p.excluded.find((e) => e.reason === "no student in this class")!;
  assert.equal(un.identifier, "nemo@example.invalid", "the identifier is not echoed as typed");
  assert.equal(un.line, 5);
  const dup = p.excluded.find((e) => e.reason.startsWith("the same student as row"))!;
  assert.equal(dup.reason, "the same student as row 1");
  // the duplicate's value is not applied: Maria keeps the first row's 8, not the second's 3
  assert.equal(p.changes.filter((c) => c.name === "Maria Alvarez").length, 1);
  assert.equal(p.changes.find((c) => c.name === "Maria Alvarez")!.to, 8);
});

await t("a withdrawn student and the demo account are skipped, and reported as such", async () => {
  const p = await previewScoreImport(sec.id, col.id, FILE);
  assert.equal(p.counts.withdrawnSkipped, 1);
  assert.equal(p.counts.demoSkipped, 1);
  assert.ok(p.excluded.some((e) => e.reason === "withdrawn from this class"));
  assert.ok(p.excluded.some((e) => e.reason === "the demo account"));
  // Reported as skipped, never as unmatched — they are in the class, which is the point.
  for (const e of p.excluded) {
    if (e.identifier === "wendy.9" || e.identifier === "demo.1") {
      assert.notEqual(e.reason, "no student in this class", e.identifier);
    }
  }
  assert.ok(!p.changes.some((c) => c.enrolmentId === roster.gone.enrolmentId));
  assert.ok(!p.changes.some((c) => c.enrolmentId === roster.demo.enrolmentId));
});

await t("a non-numeric value is excluded and listed; a blank means no change", async () => {
  const p = await previewScoreImport(sec.id, col.id, FILE);
  assert.equal(p.counts.notNumeric, 1);
  assert.ok(p.excluded.some((e) => e.reason === "not a number"));
  assert.equal(p.counts.blank, 1);
  // Kofi's row is blank, so he is not in the plan at all
  assert.ok(!p.changes.some((c) => c.enrolmentId === roster.kofi.enrolmentId));
});

await t("rounding is counted, and the preview says how many values moved", async () => {
  const p = await previewScoreImport(sec.id, col.id, FILE);
  assert.equal(p.counts.rounded, 1, "Lena's 7.129 should be the only rounded value");
  const lena = p.changes.find((c) => c.name === "Lena Petrova")!;
  assert.equal(lena.to, 7.13);
  assert.equal(lena.rounded, true);
  assert.equal(p.changes.find((c) => c.name === "Maria Alvarez")!.rounded, false);
});

await t("students in the class with no row are named, and a withdrawn one is not among them", async () => {
  const p = await previewScoreImport(sec.id, col.id, `Email,Score\nmaria.alvarez@example.invalid,8\n`);
  assert.deepEqual([...p.noRowFor].sort(), ["Kofi Mensah", "Lena Petrova", "Noah Adeyemi", "Sean O'Brien"]);
  assert.equal(p.counts.noRow, 4);
  assert.ok(!p.noRowFor.includes("Withdrawn Wendy"), "a withdrawn student reads as an oversight");
  assert.ok(!p.noRowFor.includes("Demo Student"));
});

await t("the percentage toggle converts against the column's maximum", async () => {
  const text = `Email,Score\nmaria.alvarez@example.invalid,80\n`;

  // Read as points, 80 on a column out of 10 is over the maximum and is excluded. That is the
  // clearest reason the toggle is explicit rather than guessed: the same text is either an
  // impossible score or a perfectly ordinary one.
  const asPoints = await previewScoreImport(sec.id, col.id, text);
  assert.equal(asPoints.changes.length, 0);
  assert.equal(asPoints.counts.overMaximum, 1);
  assert.equal(asPoints.excluded[0].reason, "above the maximum of 10");

  const asPct = await previewScoreImport(sec.id, col.id, text, { percentages: true });
  assert.deepEqual(asPct.changes.map((c) => c.to), [8]);
  assert.equal(asPct.counts.overMaximum, 0);

  // and a value in range either way converts as the arithmetic says
  const nine = `Email,Score\nmaria.alvarez@example.invalid,9\n`;
  assert.deepEqual((await previewScoreImport(sec.id, col.id, nine)).changes.map((c) => c.to), [9]);
  assert.deepEqual((await previewScoreImport(sec.id, col.id, nine, { percentages: true })).changes.map((c) => c.to), [0.9]);
});

await t("a value above the maximum is excluded, unless faculty allow bonus marks", async () => {
  const text = `Email,Score\nmaria.alvarez@example.invalid,15\n`;
  const strict = await previewScoreImport(sec.id, col.id, text);
  assert.equal(strict.counts.overMaximum, 1);
  assert.equal(strict.changes.length, 0);
  assert.equal(strict.excluded[0].reason, "above the maximum of 10");

  const bonus = await previewScoreImport(sec.id, col.id, text, { allowOverMaximum: true });
  assert.equal(bonus.counts.overMaximum, 0);
  assert.deepEqual(bonus.changes.map((c) => c.to), [15]);
});

// -------------------------------------------------------------------------- the tick, and applying

await t("with nothing already entered, no tick is needed", async () => {
  assert.equal(await pointsOf(roster.maria.enrolmentId), null);
  const p = await previewScoreImport(sec.id, col.id, FILE);
  assert.equal(p.needsReplaceTick, false);
  assert.equal(replaceLabel(p), null);
  assert.equal(p.counts.newScores, 3);
  assert.equal(p.counts.replaced, 0);
  assert.equal(nothingToApply(p), false);
});

await t("applying writes exactly the plan, and nothing else", async () => {
  const before = await census();
  const r = await applyScoreImport(prof.id, sec.id, col.id, FILE);
  assert.equal(r.ok, true, "ok" in r ? "" : (r as { error: string }).error);
  assert.equal(await pointsOf(roster.maria.enrolmentId), 8);
  assert.equal(await pointsOf(roster.sean.enrolmentId), 9.5);
  assert.equal(await pointsOf(roster.lena.enrolmentId), 7.13);
  assert.equal(await pointsOf(roster.kofi.enrolmentId), null, "a blank row wrote a score");
  assert.equal(await pointsOf(roster.gone.enrolmentId), null, "a withdrawn student was written to");
  assert.equal(await pointsOf(roster.demo.enrolmentId), null, "the demo account was written to");

  const after = await census();
  assert.equal(after.line_item_scores - before.line_item_scores, 3, "more rows than the plan");
  assert.equal(after.class_actions - before.class_actions, 1, "the action was not logged once");
  for (const tb of TABLES) {
    if (tb === "line_item_scores" || tb === "class_actions") continue;
    assert.equal(after[tb], before[tb], `${tb} changed`);
  }
});

await t("replacing an existing score needs the tick, and the count is what changes", async () => {
  const text = `Email,Score\nmaria.alvarez@example.invalid,10\nkofi.mensah@example.invalid,5\n`;
  const p = await previewScoreImport(sec.id, col.id, text);
  assert.equal(p.counts.replaced, 1, "Maria's 8 becomes 10");
  assert.equal(p.counts.newScores, 1, "Kofi has none yet");
  assert.equal(p.needsReplaceTick, true);
  assert.equal(replaceLabel(p), "Replace the 1 score already entered (1 changed).");
  assert.deepEqual(p.samples, [{ name: "Maria Alvarez", from: 8, to: 10 }]);

  const refused = await applyScoreImport(prof.id, sec.id, col.id, text);
  assert.equal(refused.ok, false);
  assert.match((refused as { error: string }).error, /Replace the 1 score/);
  assert.equal(await pointsOf(roster.maria.enrolmentId), 8, "it was replaced without the tick");
  assert.equal(await pointsOf(roster.kofi.enrolmentId), null, "and the new one was written anyway");

  const done = await applyScoreImport(prof.id, sec.id, col.id, text, { confirmReplace: true });
  assert.equal(done.ok, true);
  assert.equal(await pointsOf(roster.maria.enrolmentId), 10);
  assert.equal(await pointsOf(roster.kofi.enrolmentId), 5);
});

await t("a score already exactly right is not counted as a change", async () => {
  const p = await previewScoreImport(sec.id, col.id, `Email,Score\nmaria.alvarez@example.invalid,10\n`);
  assert.equal(p.counts.replaced, 0);
  assert.equal(p.counts.matched, 1);
  assert.equal(p.changes.length, 0);
  assert.equal(nothingToApply(p), true);
  assert.equal(p.needsReplaceTick, false, "it asked to confirm a change that is not one");
});

await t("clearing blanks counts as a replacement, and needs the same tick", async () => {
  const text = `Email,Score\nmaria.alvarez@example.invalid,\nkofi.mensah@example.invalid,\n`;
  const noClear = await previewScoreImport(sec.id, col.id, text);
  assert.equal(noClear.changes.length, 0, "a blank changed something without being asked to");
  assert.equal(noClear.counts.blank, 2);

  const p = await previewScoreImport(sec.id, col.id, text, { clearBlanks: true });
  assert.equal(p.counts.cleared, 2);
  assert.equal(p.needsReplaceTick, true, "decision 6: clearing is a replacement");
  assert.equal(replaceLabel(p), "Replace the 2 scores already entered (2 cleared).");

  const refused = await applyScoreImport(prof.id, sec.id, col.id, text, { clearBlanks: true });
  assert.equal(refused.ok, false);
  assert.equal(await pointsOf(roster.maria.enrolmentId), 10, "it cleared without the tick");

  const done = await applyScoreImport(prof.id, sec.id, col.id, text, { clearBlanks: true, confirmReplace: true });
  assert.equal(done.ok, true);
  assert.equal(await pointsOf(roster.maria.enrolmentId), null);
  assert.equal(await pointsOf(roster.kofi.enrolmentId), null);
  // and the cells really do read as ungraded again
  const gb = await gradebook(sec.id);
  const maria = gb.students.find((s) => s.name === "Maria Alvarez")!;
  assert.equal(maria.cells[col.id].points, null);
});

// ------------------------------------------------------------------------------------ who, and what

await t("another class's faculty and a student are refused", async () => {
  const text = `Email,Score\nmaria.alvarez@example.invalid,4\n`;
  for (const [who, id] of [["another class's faculty", other.id], ["a student", roster.maria.userId]] as const) {
    const r = await applyScoreImport(id, sec.id, col.id, text);
    assert.equal(r.ok, false, who);
    assert.match((r as { error: string }).error, /faculty, or an administrator/, who);
  }
  assert.equal(await pointsOf(roster.maria.enrolmentId), null, "one of them wrote a score");
  // an administrator may
  const ok = await applyScoreImport(admin.id, sec.id, col.id, text);
  assert.equal(ok.ok, true, "ok" in ok ? "" : (ok as { error: string }).error);
  assert.equal(await pointsOf(roster.maria.enrolmentId), 4);
});

await t("a derived column is refused in the library, not just hidden on the page", async () => {
  const [exam] = await db().insert(exams).values({
    sectionId: sec.id, title: "Quiz", status: "open", feedback: "after_close", attemptLimit: 1,
    blueprintJson: JSON.stringify({ mode: "fixed", ids: [] }),
  }).returning();
  await db().insert(examAttempts).values({
    examId: exam.id, enrolmentId: roster.maria.enrolmentId, servedJson: "[]", maxPoints: 20, score: 12, submittedAt: new Date(),
  });
  await db().insert(sims).values({ id: "mvcfn3", title: "MVCFN III", launchUrl: "https://x.invalid", published: true });
  await db().insert(classSims).values({ sectionId: sec.id, simId: "mvcfn3", addedBy: prof.id });
  const [simCol] = await db().insert(lineItems).values({
    sectionId: sec.id, kind: "sim", refId: "mvcfn3", title: "MVCFN III", maxPoints: 0, weight: 1, scoreRule: "report",
  }).returning();

  const examCol = (await listLineItems(sec.id)).find((i) => i.kind === "exam")!;
  const text = `Email,Score\nmaria.alvarez@example.invalid,4\n`;

  for (const [what, id, expect] of [
    ["an exam", examCol.id, "Calculated from the exam's attempts."],
    ["a participation simulation", simCol.id, "A participation record carries no score."],
  ] as const) {
    const p = await previewScoreImport(sec.id, id, text);
    assert.equal(p.refusal, expect, what);
    assert.equal(p.changes.length, 0, what);
    const r = await applyScoreImport(prof.id, sec.id, id, text);
    assert.deepEqual(r, { ok: false, error: expect }, what);
  }

  // and the completion rule, with the spec's exact wording (decision 1)
  await setSimRule(sec.id, simCol.id, "completion");
  const p = await previewScoreImport(sec.id, simCol.id, text);
  assert.equal(p.refusal, "Calculated from completion. Change the rule to 'faculty marks' to enter scores.");
  const r = await applyScoreImport(prof.id, sec.id, simCol.id, text);
  assert.equal(r.ok, false);

  // on "faculty marks" it is allowed
  await setSimRule(sec.id, simCol.id, "manual");
  const marked = await previewScoreImport(sec.id, simCol.id, text);
  assert.equal(marked.refusal, null);
  assert.equal(marked.changes.length, 1);
});

await t("a column from another class cannot be imported into", async () => {
  const other2 = await createSection(other.id, "sad", "Someone else's class", "2027 Spring", { teach: true });
  await addManualItem(other2.id, "Their column", 10, 1);
  const theirs = (await listLineItems(other2.id)).find((i) => i.title === "Their column")!;
  await assert.rejects(
    () => previewScoreImport(sec.id, theirs.id, `Email,Score\nmaria.alvarez@example.invalid,4\n`),
    /No such column in this class/);
});

await t("applying is all or nothing — the writes are in one transaction, and it rolls back", async () => {
  // Two halves, and the reason is worth stating. A genuine part-way failure cannot be reached from
  // a file: the preview and the gradebook's guard agree on every value the preview emits, which is
  // the property you want rather than a gap. So this checks the structure, then the mechanism, and
  // says which is which instead of pretending to have induced a real failure.
  const { readFileSync } = await import("node:fs");
  const apply = readFileSync("src/lib/score-preview.ts", "utf8");
  const from = apply.indexOf("export async function applyScoreImport");
  assert.ok(from > 0, "applyScoreImport is not where this expects it");
  const body = apply.slice(from);
  const tx = body.indexOf("db().transaction(");
  assert.ok(tx > 0, "the apply does not open a transaction");
  assert.ok(body.indexOf("for (const c of p.changes)") > tx, "the loop over the plan is outside it");
  assert.ok(body.indexOf("logAction") > body.indexOf("} catch"),
    "the action is logged before the writes are known to have committed");

  // The mechanism, on this exact table: an aborted transaction leaves neither write behind.
  const seanBefore = await pointsOf(roster.sean.enrolmentId);
  const kofiBefore = await pointsOf(roster.kofi.enrolmentId);
  await db().transaction(async (t2) => {
    for (const [enrolmentId, points] of [[roster.sean.enrolmentId, 2], [roster.kofi.enrolmentId, 3]] as const) {
      await t2.insert(lineItemScores).values({ lineItemId: col.id, enrolmentId, points, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [lineItemScores.lineItemId, lineItemScores.enrolmentId], set: { points, updatedAt: new Date() } });
    }
    throw new Error("as if a later row had been refused");
  }).catch(() => {});
  assert.equal(await pointsOf(roster.sean.enrolmentId), seanBefore, "the aborted transaction left a score");
  assert.equal(await pointsOf(roster.kofi.enrolmentId), kofiBefore, "and another");

  // A refused apply logs nothing, which is the part that would otherwise go unnoticed.
  const logsBefore = (await db().select().from(classActions)).length;
  const refused = await applyScoreImport(prof.id, sec.id, col.id,
    `Email,Score\nmaria.alvarez@example.invalid,1\n`);        // Maria has a score: needs the tick
  assert.equal(refused.ok, false);
  assert.equal((await db().select().from(classActions)).length, logsBefore,
    "a refusal was logged as an import");
});

// --------------------------------------------------------------------------------------- the log

await t("the actions log holds counts only, and reads back without naming anybody", async () => {
  const rows = await db().select().from(classActions).where(eq(classActions.action, "import_scores"));
  assert.ok(rows.length >= 1, "nothing was logged");
  for (const r of rows) {
    const json = JSON.stringify(r);
    for (const who of Object.values(roster)) {
      assert.ok(!json.includes(who.name), `the log holds ${who.name}`);
      assert.ok(!json.includes(who.email), `the log holds an address`);
    }
    // detailJson is numbers, by the type logAction takes — asserted here as a property of the row
    const detail = r.detailJson ? JSON.parse(r.detailJson) : {};
    for (const [k, v] of Object.entries(detail)) {
      assert.equal(typeof v, "number", `${k} is ${typeof v}`);
    }
  }
  const described = (await actionsFor(sec.id)).filter((a) => a.action === "import_scores").map(describeAction);
  assert.ok(described.length >= 1);
  assert.match(described[0], /Imported scores into a column/);
  for (const who of Object.values(roster)) {
    for (const line of described) assert.ok(!line.includes(who.name), line);
  }
  console.log(`      log reads: "${described[0]}"`);
});

await t("a whole flow, captured, contains no name, address or score", async () => {
  // Rule 10's second half: the server's own output. Every console channel is recorded for the
  // length of a preview and an apply, and then searched for anything identifying.
  const chunks: string[] = [];
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const grab = (...a: unknown[]) => { chunks.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  console.log = grab; console.warn = grab; console.error = grab; console.info = grab; console.debug = grab;
  try {
    await previewScoreImport(sec.id, col.id, FILE);
    await applyScoreImport(prof.id, sec.id, col.id, FILE, { confirmReplace: true });
  } finally {
    Object.assign(console, real);
  }
  const transcript = chunks.join("\n");

  // Without this, "nothing leaked" would pass just as happily if the capture never worked — which
  // is precisely what an empty transcript looks like. Prove the recorder records, then read it.
  {
    const probe: string[] = [];
    const saved = console.log;
    console.log = (...a: unknown[]) => { probe.push(a.join(" ")); };
    try { console.log("Maria Alvarez", "maria.alvarez@example.invalid", "9.5"); } finally { console.log = saved; }
    assert.equal(probe.length, 1, "the capture records nothing, so this check proves nothing");
    assert.ok(probe[0].includes("Maria Alvarez") && probe[0].includes("9.5"),
      "the capture records a call but not its content");
  }

  for (const who of Object.values(roster)) {
    assert.ok(!transcript.includes(who.name), `the server logged ${who.name}`);
    assert.ok(!transcript.includes(who.email), "the server logged an address");
    if (who.d2l) assert.ok(!transcript.includes(who.d2l), "the server logged a D2L username");
  }
  for (const score of ["9.5", "7.13", "7.129"]) {
    assert.ok(!transcript.includes(score), `the server logged the score ${score}`);
  }
  console.log(`      capture verified; the flow produced ${chunks.length} line(s) of server output`);
});

console.log(`\n${passed} checks passed`);
