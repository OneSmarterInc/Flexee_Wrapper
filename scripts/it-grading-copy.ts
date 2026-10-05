// Integration test: Spec 19 §3 and §4 — copying a grading setup, and the CSV of invitation links.
//
// Rules 7 and 8. The two have nothing to do with each other except that both are permanent enough
// to need a preview or a warning, and both are logged by count alone.
import assert from "node:assert/strict";
import { and, asc, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { setCategories, setLetterBands, addManualItem, setColumnCategory, setScore, gradebook, categoriesFor, letterBandsFor } from "@/lib/gradebook";
import { PLUS_MINUS_LETTER_BANDS } from "@/lib/grading";
import { previewCopy, copySetup, copyableClasses } from "@/lib/grading-copy";
import { invitationLinks, linksCsv, linksFilename, actionsFor, describeAction } from "@/lib/class-actions";
import { withdrawStudents } from "@/lib/withdraw";
import { completeSetPassword } from "@/lib/recovery";
import { setMailTransport } from "@/lib/mail";

const { users, identities, enrolments, lineItems, gradingCategories, letterScales, classActions, authTokens } = schema;
let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const n = async (q: Promise<{ c: number | string }[]>) => Number((await q)[0]?.c ?? 0);
setMailTransport(() => ({ ok: true }));
const BASE = "https://wrapper.example.org";

async function account(name: string, email: string, password: string | null = "x") {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}
const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const prof2 = await account("Other Prof", "prof2@flexee.org");

const src = await createSection(prof.id, "sad", "Spring Template", "2027 Spring", { teach: true });
const dst = await createSection(prof.id, "sad", "Autumn Class", "2027 Autumn", { teach: true });
const theirs = await createSection(prof2.id, "sad", "Not Mine", "2027 Spring", { teach: true });

// The source: three categories, a +/- scale, and columns that match two of them by name.
await setCategories(src.id, [
  { name: "Exams", weight: 50, dropLowest: 0 },
  { name: "Worksheets", weight: 30, dropLowest: 1 },
  { name: "Participation", weight: 20, dropLowest: 0 },
]);
await setLetterBands(src.id, PLUS_MINUS_LETTER_BANDS);

console.log("Rule 7 — copy a grading setup");

await t("the choices are classes the person teaches; an admin may take any", async () => {
  const mine = await copyableClasses(prof.id, dst.id);
  assert.deepEqual(mine.map((c) => c.name).sort(), ["Spring Template"]);
  assert.ok(!mine.some((c) => c.id === dst.id), "never the class being copied into");
  const any = await copyableClasses(admin.id, dst.id);
  assert.ok(any.length >= 2 && any.some((c) => c.name === "Not Mine"));
  const none = await copyableClasses(prof2.id, theirs.id);
  assert.deepEqual(none.map((c) => c.name), []);
});

await t("the preview says what arrives, what is replaced, and what matches", async () => {
  await addManualItem(dst.id, "Worksheets", 100, 1);
  await addManualItem(dst.id, "Field trip", 50, 1);
  const p = await previewCopy(prof.id, src.id, dst.id);
  assert.ok(p.ok, p.ok === false ? p.error : "");
  const v = p.ok ? p.preview : null!;
  assert.deepEqual(v.categories.map((c) => `${c.name}:${c.weight}`), ["Exams:50", "Worksheets:30", "Participation:20"]);
  assert.equal(v.categories.find((c) => c.name === "Worksheets")!.dropLowest, 1, "drop-lowest travels with it");
  assert.equal(v.letterBands, PLUS_MINUS_LETTER_BANDS.length);
  assert.deepEqual(v.matched, [{ title: "Worksheets", category: "Worksheets" }]);
  assert.ok(v.unmatched.includes("Field trip"), "a column matching no category is listed");
  assert.equal(v.studentsAffected, 0, "nobody is graded yet");
  // The preview writes nothing.
  assert.equal(await n(db().select({ c: count() }).from(gradingCategories).where(eq(gradingCategories.sectionId, dst.id))), 0);
});

await t("it replaces only the target, and matches its columns by name", async () => {
  const r = await copySetup(prof.id, src.id, dst.id);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  const cats = await categoriesFor(dst.id);
  assert.deepEqual(cats.map((c) => c.name), ["Exams", "Worksheets", "Participation"], "and in order");
  assert.deepEqual((await letterBandsFor(dst.id)).length, PLUS_MINUS_LETTER_BANDS.length);
  const cols = await db().select().from(lineItems).where(eq(lineItems.sectionId, dst.id));
  const worksheets = cols.find((c) => c.title === "Worksheets")!;
  const trip = cols.find((c) => c.title === "Field trip")!;
  assert.equal(worksheets.categoryId, cats.find((c) => c.name === "Worksheets")!.id, "matched by name");
  assert.equal(trip.categoryId, null, "unmatched, and left uncategorised rather than lost");
  assert.ok(cols.some((c) => c.title === "Field trip"), "the column itself is still there");
  // The source is untouched, and so is the class nobody asked about.
  assert.equal((await categoriesFor(src.id)).length, 3);
  assert.equal((await categoriesFor(theirs.id)).length, 0);
});

await t("a second copy replaces rather than piling up", async () => {
  await copySetup(prof.id, src.id, dst.id);
  assert.equal((await categoriesFor(dst.id)).length, 3, "three, not six");
});

await t("with scores, it says whose totals move and needs the class's name typed (decision 5)", async () => {
  const stu = await account("Graded Student", "graded@wright.edu");
  const [enr] = await db().insert(enrolments).values({ sectionId: dst.id, userId: stu.id, role: "student" }).returning();
  const col = (await db().select().from(lineItems).where(and(eq(lineItems.sectionId, dst.id), eq(lineItems.title, "Worksheets"))))[0];
  await setScore(col.id, enr.id, 80);
  const withdrawnStu = await account("Withdrawn Student", "wd@wright.edu");
  const [wEnr] = await db().insert(enrolments).values({ sectionId: dst.id, userId: withdrawnStu.id, role: "student" }).returning();
  await setScore(col.id, wEnr.id, 60);
  await withdrawStudents(prof.id, dst.id, [wEnr.id]);

  const p = await previewCopy(prof.id, src.id, dst.id);
  assert.ok(p.ok);
  assert.equal(p.ok && p.preview.studentsAffected, 1, "the withdrawn student is not counted");

  const refused = await copySetup(prof.id, src.id, dst.id);
  assert.equal(refused.ok, false);
  assert.match(refused.ok === false ? refused.error : "", /1 student's course total will change/);
  assert.match(refused.ok === false ? refused.error : "", /Type the class's name — "Autumn Class"/);
  for (const typed of ["", "autumn class", "Autumn"]) {
    assert.equal((await copySetup(prof.id, src.id, dst.id, { confirm: typed })).ok, false, typed);
  }
  const done = await copySetup(prof.id, src.id, dst.id, { confirm: " Autumn Class " });
  assert.ok(done.ok, done.ok === false ? done.error : "");
  const gb = await gradebook(dst.id);
  assert.ok(gb.categorised, "and the class is still categorised afterwards");
});

await t("only between classes the person may manage", async () => {
  // Not mine to copy from.
  const from = await previewCopy(prof.id, theirs.id, dst.id);
  assert.equal(from.ok, false);
  assert.match(from.ok === false ? from.error : "", /only copy from a class you teach/);
  // Not mine to copy into.
  const into = await previewCopy(prof.id, src.id, theirs.id);
  assert.equal(into.ok, false);
  assert.match(into.ok === false ? into.error : "", /faculty or an administrator/);
  // A student, for either.
  const stu = await account("Just A Student", "just@wright.edu");
  assert.equal((await previewCopy(stu.id, src.id, dst.id)).ok, false);
  // The same class twice.
  assert.equal((await previewCopy(prof.id, dst.id, dst.id)).ok, false);
  // An empty setup is not worth copying.
  assert.equal((await previewCopy(admin.id, theirs.id, dst.id)).ok, false);
});

console.log("Rule 8 — the CSV of invitation links");

const links = await createSection(prof.id, "sad", "Links Class", "2027 Spring", { teach: true });
async function waiting(name: string, email: string, o: { demo?: boolean; password?: string | null } = {}) {
  const u = await account(name, email, o.password ?? null);
  const [enr] = await db().insert(enrolments)
    .values({ sectionId: links.id, userId: u.id, role: "student", isDemo: !!o.demo }).returning();
  return { user: u, enr };
}
const one = await waiting("One Waiting", "one@wright.edu");
const two = await waiting("Two Waiting", "two@wright.edu");
const done = await waiting("Already Done", "done@wright.edu", { password: "chosen" });
const demoRow = await waiting("Demo Student", "demo@wright.edu", { demo: true });
const left = await waiting("Left Already", "left@wright.edu");
await withdrawStudents(prof.id, links.id, [left.enr.id]);

await t("without a selection it is everyone not set up, and no demo or withdrawn student", async () => {
  const r = await invitationLinks(prof.id, links.id, BASE);
  assert.ok(r.ok, r.ok === false ? r.error : "");
  assert.deepEqual(r.ok ? r.rows.map((x) => x.email).sort() : [], ["one@wright.edu", "two@wright.edu"]);
  assert.equal(r.ok && r.filename, `invitation-links-links-class-${new Date().toISOString().slice(0, 10)}.csv`);
});

await t("a selection is taken as asked, demo accounts included", async () => {
  const r = await invitationLinks(prof.id, links.id, BASE, { enrolmentIds: [demoRow.enr.id, one.enr.id] });
  assert.ok(r.ok);
  assert.deepEqual(r.ok ? r.rows.map((x) => x.email).sort() : [], ["demo@wright.edu", "one@wright.edu"]);
  const set = await invitationLinks(prof.id, links.id, BASE, { enrolmentIds: [done.enr.id] });
  assert.deepEqual(set.ok ? set.rows : [], [], "but a student who has set a password has no link to give");
});

await t("the file has the agreed columns, and the expiry is a UTC date", () => {
  const rows = [{ name: "One Waiting", email: "one@wright.edu", link: `${BASE}/set-password?token=abc`, expires: "2026-10-19" }];
  const csv = linksCsv(rows);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], '"name","email","link","expires"');
  assert.equal(lines[1], '"One Waiting","one@wright.edu","https://wrapper.example.org/set-password?token=abc","2026-10-19"');
  assert.ok(!csv.startsWith("#"), "no comment line (decision 9)");
  assert.match(linksFilename("MIS 3250-01, Spring", new Date("2026-10-05T12:00:00Z")), /^invitation-links-mis-3250-01-spring-2026-10-05\.csv$/);
  // A name with a quote in it cannot break the file.
  assert.equal(linksCsv([{ name: 'A "Quoted" Name', email: "q@x.edu", link: "l", expires: "d" }]).split("\r\n")[1],
    '"A ""Quoted"" Name","q@x.edu","l","d"');
});

await t("each link works once, and a download retires the earlier unused one", async () => {
  const first = await invitationLinks(prof.id, links.id, BASE, { enrolmentIds: [two.enr.id] });
  assert.ok(first.ok);
  const old = (first.ok ? first.rows[0].link : "").match(/token=([0-9a-f]+)/)![1];
  const second = await invitationLinks(prof.id, links.id, BASE, { enrolmentIds: [two.enr.id] });
  assert.ok(second.ok);
  const fresh = (second.ok ? second.rows[0].link : "").match(/token=([0-9a-f]+)/)![1];
  assert.notEqual(old, fresh);
  assert.equal(await completeSetPassword(old, "a-good-password"), null, "the earlier link is dead");
  assert.ok(await completeSetPassword(fresh, "a-good-password"), "and the newest works");
  assert.equal(await completeSetPassword(fresh, "another-one-11"), null, "once");
  assert.equal(await n(db().select({ c: count() }).from(authTokens)
    .where(and(eq(authTokens.userId, two.user.id), eq(authTokens.kind, "set_password")))), 1,
    "one invitation row for that student, not a pile");
});

await t("only the class's faculty and admins, and no id from another class", async () => {
  for (const who of [prof2.id, one.user.id]) {
    const r = await invitationLinks(who, links.id, BASE);
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : "", /faculty or an administrator/);
  }
  assert.ok((await invitationLinks(admin.id, links.id, BASE)).ok, "an admin may");
  const [elsewhere] = await db().insert(enrolments).values({ sectionId: dst.id, userId: admin.id, role: "student" }).returning();
  const mixed = await invitationLinks(prof.id, links.id, BASE, { enrolmentIds: [one.enr.id, elsewhere.id] });
  assert.equal(mixed.ok, false);
  assert.match(mixed.ok === false ? mixed.error : "", /not in this class/);
});

await t("no token is stored in the log, and the log holds counts only", async () => {
  const log = await actionsFor(links.id, 50);
  const lines = log.map(describeAction);
  assert.ok(lines.some((l) => /^Downloaded \d+ invitation links?$/.test(l)), lines.join(" | "));
  const dump = JSON.stringify(await db().select().from(classActions));
  for (const needle of ["token", "One Waiting", "one@wright.edu", "set-password"]) {
    assert.ok(!dump.includes(needle), `the log must not hold: ${needle}`);
  }
  // The token the student receives is not stored anywhere in the clear, as Spec 17 established.
  const rows = await db().select().from(authTokens);
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash)), "only sha-256 hashes are stored");
});

await t("a captured log of a download contains no token", async () => {
  const real = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  let token = "";
  try {
    console.log = grab; console.warn = grab; console.error = grab;
    const r = await invitationLinks(prof.id, links.id, BASE, { enrolmentIds: [one.enr.id] });
    token = r.ok ? (r.rows[0].link.match(/token=([0-9a-f]+)/)?.[1] ?? "") : "";
  } finally { Object.assign(console, real); }
  assert.ok(token, "a token was issued for the test to look for");
  const text = lines.join("\n");
  assert.ok(!text.includes(token), `the token must not be logged — found it in: ${text.slice(0, 200)}`);
  assert.ok(!text.includes("one@wright.edu"));
});

await t("the copy is logged too, with its counts", async () => {
  const log = await actionsFor(dst.id, 50);
  const copy = log.find((a) => a.action === "copy_grading")!;
  assert.ok(copy, "the copy is in the log");
  assert.equal(copy.detail.categories, 3);
  assert.ok(copy.detail.unmatched >= 1);
  assert.match(describeAction(copy), /^Copied a grading setup: 3 categories, \d+ columns? unmatched$/);
});

console.log(`\n${passed} checks passed`);
