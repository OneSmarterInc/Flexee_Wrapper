// Integration test: Spec 17 — the D2L class list import, set-your-password invitations, the mail
// adapter, and the hashed tokens all three link kinds now use.
//
// One rule of the spec per group, in the spec's order, against the real modules: the parser reads
// the two fixtures byte for byte as D2L writes them, the preview touches nothing, a commit creates
// accounts nobody can sign in to until they choose a password, and the last group captures every
// line the whole flow logs and reads it for anything private.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection, sectionRoster } from "@/lib/roster";
import { setMailTransport, type Mail, type MailResult } from "@/lib/mail";
import { parseClassList, personName, emailFor, splitCsv } from "@/lib/d2l";
import { canImport, previewImport, commitImport, notSetUp } from "@/lib/d2l-import";
import {
  completeSetPassword, copySetPasswordLink, sendSetPasswordInvite, inviteStatesFor,
  requestPasswordReset, hasUsablePassword, hashToken, studentOfEnrolment, rateLimit,
  RESEND_MAX_PER_HOUR, SET_PASSWORD_TTL_SEC,
} from "@/lib/recovery";
import { exportCsv, d2lKey } from "@/lib/gradebook";

const { users, identities, enrolments, authTokens, sessions } = schema;
let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

process.env.D2L_EMAIL_DOMAIN = "wright.edu";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

// The fake transport. Every message is kept so a test can read what a student would have read.
type Sent = Mail & { at: Date };
let outbox: Sent[] = [];
let failFor: string | null = null;
const fake = (msg: Mail): MailResult => {
  outbox.push({ ...msg, at: new Date() });
  if (failFor && msg.to === failFor) return { ok: false, error: "mailbox full" };
  return { ok: true, id: "fake-" + outbox.length };
};
setMailTransport(fake);
const BASE = "https://wrapper.example.org";
const linkIn = (m: Sent) => m.text.match(/https:\/\/\S*\/set-password\?token=([0-9a-f]+)/)!;

const FIX = path.join("scripts", "fixtures");
const plain = readFileSync(path.join(FIX, "d2l_class_list.csv"), "utf8");
const withBom = readFileSync(path.join(FIX, "d2l_class_list_bom.csv"), "utf8");

async function account(name: string, email: string, password: string | null = "x") {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}
const countRows = async (table: any) => Number((await db().select({ c: count() }).from(table))[0].c);
const census = async () => ({
  users: await countRows(users), identities: await countRows(identities),
  enrolments: await countRows(enrolments), tokens: await countRows(authTokens),
});

const admin = await account("Admin", "admin@flexee.org");
await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const prof2 = await account("Prof Two", "prof2@flexee.org");
const stu = await account("Stu", "stu@wright.edu");
const sec = await createSection(prof.id, "mis3000", "MIS 3000-01", "2027 Spring", { teach: true });
const other = await createSection(prof2.id, "mis3000", "MIS 3000-02", "2027 Spring", { teach: true });

// ---------------------------------------------------------------- rule 1: the parser
console.log("Rule 1 — the real format, and only students");

await t("the fixtures are what D2L writes: CRLF, quoted names, one with a byte-order mark", () => {
  const raw = readFileSync(path.join(FIX, "d2l_class_list.csv"));
  const rawBom = readFileSync(path.join(FIX, "d2l_class_list_bom.csv"));
  assert.ok(raw.includes(Buffer.from("\r\n")), "CRLF line endings");
  assert.ok(!raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "this one has no BOM");
  assert.ok(rawBom.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "this one has a BOM");
  assert.equal(readFileSync(path.join(FIX, "d2l_class_list.csv"), "utf8").split("\r\n")[0],
    "Name,UserName,OrgDefinedId,Role,LastAccessed", "D2L's own column order, exactly");
});

await t("a quoted field holding a comma stays one cell", () => {
  const rows = splitCsv('a,b\r\n"Last, First",x\r\n');
  assert.deepEqual(rows[1], ["Last, First", "x"]);
  assert.deepEqual(splitCsv('a\r\n"say ""hi"""\r\n')[1], ['say "hi"']);
});

await t("only student roles are imported; other roles are listed with their role", () => {
  const l = parseClassList(plain);
  // Spec 18: "Demo Student" joins them, flagged. Everything else is still listed and ignored.
  assert.deepEqual(l.students.map((r) => r.userName).sort(),
    ["a118mjt", "c330bvn", "d999dmo", "k142drf", "m204kqr", "p188rtk", "t119zwl", "w101abc"]);
  assert.deepEqual(l.students.filter((r) => r.demo).map((r) => r.userName), ["d999dmo"]);
  assert.deepEqual(l.others.map((r) => `${r.name}:${r.role}`),
    ["Dana Carver:Faculty", "Owen Brennan:Teaching Assistant"]);
});

await t("names, usernames and spacing are read as a person wrote them", () => {
  const byName = new Map(parseClassList(plain).students.map((r) => [r.userName, r]));
  assert.equal(byName.get("m204kqr")!.name, "Maria Alvarez", '"Last, First" becomes "First Last"');
  assert.equal(byName.get("p188rtk")!.name, "Pat Quinlan", "a name with no comma is used as it is");
  assert.equal(byName.get("a118mjt")!.name, "Åsa Lindqvist", "non-ASCII survives");
  assert.equal(byName.get("t119zwl")!.name, "Tomasz Bąk");
  assert.equal(byName.get("c330bvn")!.name, "Chidi Okonkwo", "trailing spaces are trimmed");
  assert.equal(byName.get("w101abc")!.userName, "w101abc", "a mixed-case UserName is lower-cased");
  assert.equal(byName.get("w101abc")!.email, "w101abc@wright.edu");
  assert.equal(byName.get("a118mjt")!.role, "STUDENT", "the role matched ignoring case");
});

await t("a blank username and a duplicate username are problems, not rows", () => {
  const l = parseClassList(plain);
  assert.deepEqual(l.problems.map((p) => p.reason).sort(), ["blank username", "duplicate username"]);
  assert.equal(l.students.filter((r) => r.userName === "m204kqr").length, 1, "the first one wins");
});

await t("any column order, extra columns ignored, the byte-order mark stripped", () => {
  const l = parseClassList(withBom);
  assert.deepEqual(l.missing, []);
  assert.equal(l.headers[0], "UserName", "the file's own order");
  assert.ok(l.headers.includes("Availability"), "an extra column is present and ignored");
  assert.deepEqual(l.students.map((r) => r.name),
    ["Céline Fontaine", "Luca Ferraro", "Noor Haddad"]);
  assert.deepEqual(l.others.map((r) => r.role), ["Faculty"]);
});

await t("a UserName that is already an address is used as it is, and the row says so", () => {
  const r = parseClassList(withBom).students.find((x) => x.userName.includes("@"))!;
  assert.equal(r.email, "luca.ferraro@visiting.example.edu", "no domain appended");
  assert.equal(r.userName, "luca.ferraro@visiting.example.edu", "stored as given, lower-cased");
  assert.match(r.note ?? "", /already an address/);
});

await t("the email domain is a setting, not a constant", () => {
  assert.equal(emailFor("m204kqr", "example.edu"), "m204kqr@example.edu");
  assert.equal(personName("Solo"), "Solo");
  const l = parseClassList(plain, { domain: "example.edu" });
  assert.ok(l.students.every((r) => r.email.endsWith("@example.edu")));
});

await t("a file with no UserName column is refused, naming what is missing", () => {
  const l = parseClassList("Name,Role\r\n\"A, B\",Student\r\n");
  assert.deepEqual(l.missing, ["username"]);
  assert.deepEqual(l.students, []);
});

// ---------------------------------------------------------------- rule 2: the preview
console.log("Rule 2 — the preview writes nothing");

await t("previewing the whole file leaves every table exactly as it was", async () => {
  const before = await census();
  const p = await previewImport(sec.id, parseClassList(plain));
  assert.deepEqual(await census(), before);
  assert.equal(p.counts.willCreate, 8, "seven students and D2L's demo student");
  assert.equal(p.counts.alreadyInClass, 0);
  assert.equal(p.counts.skipped, 2);
  assert.equal(p.counts.problems, 2);
  assert.ok(p.rows.every((r) => r.plan === "create"));
});

// ---------------------------------------------------------------- rule 4 (set up before rule 3)
console.log("Rule 4 — an account that already exists");

// Kenji already has an account, with a password he chose himself.
const kenji = await account("Kenji Nakamura", "k142drf@wright.edu", "already-hashed");
// Grace has an account the old CSV import made: no usable password.
const grace = await account("Grace Whitfield", "w101abc@wright.edu", null);

await t("the preview tells faculty which rows are new and which are people we know", async () => {
  const p = await previewImport(sec.id, parseClassList(plain));
  assert.equal(p.counts.willCreate, 6);
  assert.equal(p.counts.haveAccounts, 2);
  assert.equal(p.rows.find((r) => r.userName === "k142drf")!.plan, "enrol existing");
});

// ---------------------------------------------------------------- rule 3: the commit
console.log("Rule 3 — confirming creates the accounts");

outbox = [];
const first = await commitImport(sec.id, parseClassList(plain), { sendNow: true, baseUrl: BASE });

await t("five accounts created, two existing enrolled, nobody duplicated", async () => {
  assert.equal(first.created, 6, "five students plus the demo account");
  assert.equal(first.enrolled, 2);
  assert.equal(first.alreadyInClass, 0);
  const roster = await sectionRoster(sec.id);
  assert.equal(roster.filter((r) => r.role === "student").length, 8);
});

await t("each account has the derived email, no usable password, and its D2L username", async () => {
  const rows = await db().select({ email: identities.subject, hash: identities.passwordHash, u: users.d2lUsername, name: users.displayName })
    .from(identities).innerJoin(users, eq(users.id, identities.userId));
  const maria = rows.find((r) => r.email === "m204kqr@wright.edu")!;
  assert.equal(maria.hash, null, "no usable password — login refuses a null hash");
  assert.equal(maria.u, "m204kqr");
  assert.equal(maria.name, "Maria Alvarez");
  const asa = rows.find((r) => r.email === "a118mjt@wright.edu")!;
  assert.equal(asa.name, "Åsa Lindqvist");
});

await t("OrgDefinedId is stored nowhere", async () => {
  const ids = parseClassList(plain).students.map((r) => r.orgDefinedId).filter(Boolean);
  assert.ok(ids.length >= 5, "the fixture has ids to look for");
  const dump = JSON.stringify([
    await db().select().from(users), await db().select().from(identities),
    await db().select().from(enrolments), await db().select().from(authTokens),
  ]);
  for (const id of ids) assert.ok(!dump.includes(id), `${id} must not be stored`);
  // Not even case-folded, which is how it would slip in if it were used as a username.
  for (const id of ids) assert.ok(!dump.includes(id.toLowerCase()), `${id} must not be stored`);
});

await t("rule 4: the existing account keeps its password, is enrolled, and gets its username", async () => {
  const k = (await db().select().from(users).where(eq(users.id, kenji.id)))[0];
  assert.equal(k.d2lUsername, "k142drf");
  const i = (await db().select().from(identities).where(eq(identities.userId, kenji.id)))[0];
  assert.equal(i.passwordHash, "already-hashed", "an import never touches a password");
  assert.equal(Number((await db().select({ c: count() }).from(enrolments)
    .where(and(eq(enrolments.userId, kenji.id), eq(enrolments.sectionId, sec.id))))[0].c), 1);
  assert.equal(outbox.filter((m) => m.to === "k142drf@wright.edu").length, 0, "no invitation: he has a password");
  assert.equal(outbox.filter((m) => m.to === "w101abc@wright.edu").length, 1, "Grace never set one, so she gets one");
});

// ---------------------------------------------------------------- rule 5: the invitation
console.log("Rule 5 — the one-time link");

await t("one invitation per student without a password, to the derived address", async () => {
  const to = outbox.map((m) => m.to).sort();
  assert.deepEqual(to, [
    "a118mjt@wright.edu", "c330bvn@wright.edu", "m204kqr@wright.edu",
    "p188rtk@wright.edu", "t119zwl@wright.edu", "w101abc@wright.edu",
  ], "the five created plus Grace — not Kenji");
  assert.equal(new Set(to).size, to.length, "once each");
});

await t("the email names the class and carries the link, and says what to do if it has expired", () => {
  const m = outbox.find((x) => x.to === "m204kqr@wright.edu")!;
  assert.match(m.subject, /MIS 3000-01/);
  assert.match(m.text, /MIS 3000-01 \(2027 Spring\)/);
  assert.match(m.text, /\/set-password\?token=[0-9a-f]{64}/);
  assert.match(m.text, /Forgot password/);
});

await t("the token is stored hashed: the database holds nothing anyone can follow", async () => {
  const m = outbox.find((x) => x.to === "m204kqr@wright.edu")!;
  const token = linkIn(m)[1];
  const rows = await db().select().from(authTokens);
  assert.ok(!rows.some((r) => r.tokenHash === token), "the secret itself is not stored");
  assert.ok(rows.some((r) => r.tokenHash === createHash("sha256").update(token).digest("hex")),
    "its sha-256 is");
  assert.equal(hashToken(token), createHash("sha256").update(token).digest("hex"));
});

await t("14 days, and an expired link is refused", async () => {
  assert.equal(SET_PASSWORD_TTL_SEC, 14 * 86400);
  const m = outbox.find((x) => x.to === "t119zwl@wright.edu")!;
  const token = linkIn(m)[1];
  const row = (await db().select().from(authTokens).where(eq(authTokens.tokenHash, hashToken(token))))[0];
  assert.ok(Math.abs(row.expiresAt.getTime() - (row.createdAt.getTime() + 14 * 86400_000)) < 60_000);
  await db().update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.tokenHash, hashToken(token)));
  assert.equal(await completeSetPassword(token, "chosen-well-1"), null, "refused once it has expired");
});

await t("following the link sets the password, verifies the email, and works only once", async () => {
  const m = outbox.find((x) => x.to === "m204kqr@wright.edu")!;
  const token = linkIn(m)[1];
  const maria = (await db().select().from(identities).where(eq(identities.subject, "m204kqr@wright.edu")))[0];
  await db().insert(sessions).values({ id: "stale-1", userId: maria.userId, expiresAt: new Date(Date.now() + 9e8) });
  const done = await completeSetPassword(token, "chosen-well-1");
  assert.ok(done, "the link worked");
  assert.equal(done!.userId, maria.userId);
  assert.equal(done!.email, "m204kqr@wright.edu");
  const after = (await db().select().from(identities).where(eq(identities.subject, "m204kqr@wright.edu")))[0];
  assert.ok(after.passwordHash && after.passwordHash !== "chosen-well-1", "stored as a hash, not the password");
  assert.ok(after.emailVerifiedAt, "setting a password this way proves the address received the link");
  assert.equal(Number((await db().select({ c: count() }).from(sessions).where(eq(sessions.userId, maria.userId)))[0].c), 0,
    "any stale session is cleared; the caller then signs them in");
  assert.equal(await completeSetPassword(token, "another-one-2"), null, "and never again");
});

await t("a password shorter than eight characters is refused before the token is spent", async () => {
  const m = outbox.find((x) => x.to === "c330bvn@wright.edu")!;
  const token = linkIn(m)[1];
  await assert.rejects(() => completeSetPassword(token, "short"), /at least 8/);
  assert.ok(await completeSetPassword(token, "chosen-well-2"), "the link still works afterwards");
});

// ---------------------------------------------------------------- rule 6: sending, and not sending
console.log("Rule 6 — not configured, one failure, resend, copy link");

await t("with no provider at all the accounts are still made, and show 'not sent'", async () => {
  setMailTransport(null); // no transport, and no RESEND_API_KEY in the environment
  const r = await commitImport(other.id, parseClassList(withBom), { sendNow: true, baseUrl: BASE });
  assert.equal(r.created, 3);
  assert.equal(r.invited, 0);
  assert.deepEqual(r.notSent.map((n) => n.reason), ["not configured", "not configured", "not configured"]);
  const states = await inviteStatesFor(other.id);
  const noor = (await db().select().from(identities).where(eq(identities.subject, "h139wbc@wright.edu")))[0];
  assert.deepEqual(states.get(noor.userId), { state: "not sent", reason: "not configured" });
  setMailTransport(fake);
});

await t("one failed send never stops the others, and is recorded against that student", async () => {
  outbox = []; failFor = "h139wbc@wright.edu";
  let sent = 0, failed = 0;
  for (const s of await notSetUp(other.id)) {
    const r = await sendSetPasswordInvite(s.userId, other.id, s.email!, BASE);
    if (r.ok) sent++; else failed++;
  }
  failFor = null;
  assert.equal(sent, 2); assert.equal(failed, 1);
  const noor = (await db().select().from(identities).where(eq(identities.subject, "h139wbc@wright.edu")))[0];
  assert.deepEqual(await inviteStatesFor(other.id).then((m) => m.get(noor.userId)), { state: "not sent", reason: "mailbox full" });
  const celine = (await db().select().from(identities).where(eq(identities.subject, "f127mqs@wright.edu")))[0];
  assert.equal((await inviteStatesFor(other.id)).get(celine.userId)!.state, "invited");
  assert.ok(await completeSetPassword(linkIn(outbox.find((m) => m.to === "f127mqs@wright.edu")!)[1], "chosen-well-3"),
    "the invitation that did go out still works");
});

await t("resending retires the earlier link, so only one is ever live", async () => {
  outbox = [];
  const noor = (await db().select().from(identities).where(eq(identities.subject, "h139wbc@wright.edu")))[0];
  await sendSetPasswordInvite(noor.userId, other.id, "h139wbc@wright.edu", BASE);
  const old = linkIn(outbox[0])[1];
  await sendSetPasswordInvite(noor.userId, other.id, "h139wbc@wright.edu", BASE);
  const fresh = linkIn(outbox[1])[1];
  assert.notEqual(old, fresh);
  assert.equal(Number((await db().select({ c: count() }).from(authTokens)
    .where(and(eq(authTokens.userId, noor.userId), eq(authTokens.kind, "set_password"))))[0].c), 1,
    "one invitation row, not a pile");
  assert.equal(await completeSetPassword(old, "chosen-well-4"), null, "the earlier link is dead");
  assert.ok(await completeSetPassword(fresh, "chosen-well-4"), "the newest one works");
});

await t("Copy link gives a working link and retires the earlier unused one", async () => {
  outbox = [];
  const luca = (await db().select().from(identities).where(eq(identities.subject, "luca.ferraro@visiting.example.edu")))[0];
  await sendSetPasswordInvite(luca.userId, other.id, "luca.ferraro@visiting.example.edu", BASE);
  const emailed = linkIn(outbox[0])[1];
  const copied = await copySetPasswordLink(luca.userId, other.id, "luca.ferraro@visiting.example.edu", BASE);
  const token = copied.match(/token=([0-9a-f]+)/)![1];
  assert.equal((await inviteStatesFor(other.id)).get(luca.userId)!.state, "link copied");
  assert.equal(await completeSetPassword(emailed, "chosen-well-5"), null, "the emailed link was retired");
  assert.ok(await completeSetPassword(token, "chosen-well-5"), "the copied link works");
});

await t("three resends per hour per student, and no more", async () => {
  assert.equal(RESEND_MAX_PER_HOUR, 3);
  const grace2 = (await db().select().from(identities).where(eq(identities.subject, "w101abc@wright.edu")))[0];
  const allowed = [];
  for (let i = 0; i < 5; i++) allowed.push(await rateLimit(`invite:${grace2.userId}`, RESEND_MAX_PER_HOUR, 3600));
  assert.deepEqual(allowed, [true, true, true, false, false]);
  const kenji2 = (await db().select().from(identities).where(eq(identities.subject, "k142drf@wright.edu")))[0];
  assert.equal(await rateLimit(`invite:${kenji2.userId}`, RESEND_MAX_PER_HOUR, 3600), true,
    "the limit is per student, not per class");
});

await t("the class list says where each student stands", async () => {
  const states = await inviteStatesFor(sec.id);
  const by = async (email: string) => (await db().select().from(identities).where(eq(identities.subject, email)))[0].userId;
  assert.equal(states.get(await by("m204kqr@wright.edu"))!.state, "set up", "she chose a password");
  assert.equal(states.get(await by("k142drf@wright.edu"))!.state, "set up", "he already had one");
  assert.equal(states.get(await by("t119zwl@wright.edu"))!.state, "link expired");
  assert.equal(states.get(await by("a118mjt@wright.edu"))!.state, "invited");
  const enr = await sectionRoster(sec.id);
  const one = enr.find((r) => r.email === "a118mjt@wright.edu")!;
  assert.ok((await studentOfEnrolment(sec.id, one.enrolmentId))!.email === "a118mjt@wright.edu");
  assert.equal(await studentOfEnrolment(other.id, one.enrolmentId), null, "and only within its own class");
});

// ---------------------------------------------------------------- rule 7: re-import
console.log("Rule 7 — re-importing");

await t("the same file again changes nothing and duplicates nobody", async () => {
  const before = await census();
  const again = await commitImport(sec.id, parseClassList(plain), { sendNow: false, baseUrl: BASE });
  assert.equal(again.created, 0);
  assert.equal(again.alreadyInClass, 8);
  const after = await census();
  assert.deepEqual({ users: after.users, identities: after.identities, enrolments: after.enrolments },
    { users: before.users, identities: before.identities, enrolments: before.enrolments });
  const maria = (await db().select().from(identities).where(eq(identities.subject, "m204kqr@wright.edu")))[0];
  assert.ok(maria.passwordHash, "the password she chose is untouched");
});

await t("a later export adds the late student and leaves everyone else alone", async () => {
  const late = plain.replace('", ",,B10999001,Student,', '"Osei, Kwame",n191fqd,N10882211,Student,\r\n", ",,B10999001,Student,');
  const r = await commitImport(sec.id, parseClassList(late), { sendNow: false, baseUrl: BASE });
  assert.equal(r.created, 1);
  assert.equal(r.alreadyInClass, 8);
  assert.equal((await sectionRoster(sec.id)).filter((x) => x.role === "student").length, 9);
});

await t("a student missing from the file is listed, never removed", async () => {
  const shorter = plain.split("\r\n").filter((l) => !l.startsWith('"Alvarez, Maria"')).join("\r\n");
  const p = await previewImport(sec.id, parseClassList(shorter));
  assert.ok(p.missing.some((m) => m.email === "m204kqr@wright.edu"), "listed as not in the file");
  await commitImport(sec.id, parseClassList(shorter), { sendNow: false, baseUrl: BASE });
  assert.equal((await sectionRoster(sec.id)).filter((x) => x.role === "student").length, 9, "still nine");
});

await t("a username already on an account under another domain enrols that account, not a twin", async () => {
  // Spec 17 created a second account here, silently, because it looked people up by email only.
  // Spec 18 looks the username up first, so this is the same person arriving under a new domain.
  // The full treatment of this case is in scripts/it-demo-account.ts.
  const row = 'Name,UserName,OrgDefinedId,Role,LastAccessed\r\n"Nakamura, Kenji",k142drf,K10228475,Student,\r\n';
  const list = parseClassList(row, { domain: "newcampus.example.edu" });
  const p = await previewImport(other.id, list);
  assert.equal(p.rows[0].matchedBy, "username");
  assert.equal(p.rows[0].emailOnFile, "k142drf@wright.edu", "the address on file is shown, not replaced");
  const before = (await db().select().from(users)).length;
  const r = await commitImport(other.id, list, { sendNow: true, baseUrl: BASE });
  assert.equal(r.created, 0, "no second account");
  assert.equal(r.emailDiffers, 1);
  assert.equal(r.invited, 0, "and an account whose address differs is not invited");
  assert.equal((await db().select().from(users)).length, before);
  assert.equal((await db().select().from(identities).where(eq(identities.subject, "k142drf@newcampus.example.edu"))).length, 0,
    "nothing was created under the derived address");
});

// ---------------------------------------------------------------- rule 8: who may import
console.log("Rule 8 — who may import");

await t("the class's faculty and admins; not students, not another class's faculty", async () => {
  assert.equal(await canImport(prof.id, sec.id), true);
  assert.equal(await canImport(admin.id, sec.id), true, "an admin who does not teach it still may");
  assert.equal(await canImport(stu.id, sec.id), false);
  assert.equal(await canImport(prof2.id, sec.id), false);
  assert.equal(await canImport(prof2.id, other.id), true);
});

// ---------------------------------------------------------------- rule 9: the export key
console.log("Rule 9 — the D2L export's Username");

await t("the stored username, else the email's local part, else blank", async () => {
  assert.equal(d2lKey({ d2lUsername: "m204kqr", email: "m204kqr@wright.edu" }), "m204kqr");
  assert.equal(d2lKey({ d2lUsername: null, email: "someone@wright.edu" }), "someone");
  assert.equal(d2lKey({ d2lUsername: null, email: null }), "");
  // A student who signs in through the LMS only: no password identity, so no address either.
  const [lti] = await db().insert(users).values({ displayName: "LMS Only" }).returning();
  await db().insert(identities).values({ userId: lti.id, provider: "lti", subject: "iss|abc" });
  await db().insert(enrolments).values({ sectionId: sec.id, userId: lti.id, role: "student" });
  const csv = await exportCsv(sec.id, "d2l");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0].split(",")[0], '"Username"');
  assert.ok(lines.some((l) => l.startsWith('"m204kqr",')), "the stored username keys her row");
  assert.ok(lines.some((l) => l.startsWith('"",')), "and a student with neither is blank, not a name");
  assert.ok(lines.slice(1).every((l) => l.endsWith('"#"')), "the end-of-line indicator is still there");
  await db().delete(users).where(eq(users.id, lti.id));
});

// ---------------------------------------------------------------- rule 10: forgot password
console.log("Rule 10 — forgot password through the adapter");

await t("it sends through the adapter, and answers the same whether or not the account exists", async () => {
  outbox = [];
  const a = await requestPasswordReset("m204kqr@wright.edu", BASE);
  const b = await requestPasswordReset("nobody-at-all@wright.edu", BASE);
  assert.equal(a, undefined); assert.equal(b, undefined, "the caller is told nothing either way");
  assert.equal(outbox.length, 1, "one message, for the address that has an account");
  assert.match(outbox[0].text, /\/reset\?token=/);
  assert.equal(outbox[0].to, "m204kqr@wright.edu");
  // And the reset token is hashed too, like the other two kinds.
  const token = outbox[0].text.match(/token=([0-9a-f]+)/)![1];
  const rows = await db().select().from(authTokens).where(eq(authTokens.kind, "password_reset"));
  assert.ok(rows.some((r) => r.tokenHash === hashToken(token)) && !rows.some((r) => r.tokenHash === token));
});

await t("a passwordless imported account can still use Forgot password — the stated remedy", async () => {
  outbox = [];
  const before = await hasUsablePassword("a118mjt@wright.edu");
  assert.deepEqual({ has: before!.hasPassword }, { has: false });
  await requestPasswordReset("a118mjt@wright.edu", BASE);
  assert.equal(outbox.length, 1, "the expired-invitation route out works");
});

// ---------------------------------------------------------------- rule 11: the logs
console.log("Rule 11 — nothing private in the logs");

const LOG_EMAIL = "q145zzt@wright.edu";
const LOG_CSV = [
  "Name,UserName,OrgDefinedId,Role,LastAccessed",
  '"Underhill, Rosalind",q145zzt,Q10555001,Student,',
  "",
].join("\r\n");

await t("a captured log of the whole flow holds no token, password, name or address", async () => {
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const lines: string[] = [];
  const grab = (...a: any[]) => { lines.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
  console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
  let link = "", resetToken = "";
  try {
    const third = await createSection(prof.id, "mis3000", "MIS 3000-03", "2027 Spring", { teach: true });
    outbox = [];
    // Its own class and its own student, so the whole flow runs from nothing: import, send,
    // copy a link, resend, set the password, then ask for a reset.
    await commitImport(third.id, parseClassList(LOG_CSV), { sendNow: true, baseUrl: BASE });
    link = linkIn(outbox.find((x) => x.to === LOG_EMAIL)!)[1];
    const who = (await db().select().from(identities).where(eq(identities.subject, LOG_EMAIL)))[0];
    await copySetPasswordLink(who.userId, third.id, LOG_EMAIL, BASE);
    await sendSetPasswordInvite(who.userId, third.id, LOG_EMAIL, BASE);
    await completeSetPassword(linkIn(outbox[outbox.length - 1])[1], "chosen-well-9");
    await requestPasswordReset(LOG_EMAIL, BASE);
    resetToken = outbox[outbox.length - 1].text.match(/token=([0-9a-f]+)/)![1];
    // And the provider path's own failure, which is the one line this file does log.
    setMailTransport(null);
    process.env.RESEND_API_KEY = "re_test"; process.env.MAIL_FROM = "noreply@example.org";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(`the recipient ${LOG_EMAIL} was refused`, { status: 422 })) as any;
    const { sendMail } = await import("@/lib/mail");
    const r = await sendMail({ to: LOG_EMAIL, subject: "s", text: `link ${BASE}/set-password?token=deadbeef` });
    globalThis.fetch = origFetch;
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
    setMailTransport(fake);
    assert.equal(r.ok, false);
  } finally {
    Object.assign(console, real);
  }
  const text = lines.join("\n");
  const forbidden: [string, string][] = [
    ["the set-password token", link],
    ["the reset token", resetToken],
    ["a password", "chosen-well-9"],
    ["an address", LOG_EMAIL],
    ["a name", "Rosalind Underhill"],
    ["a surname", "Underhill"],
    ["the provider's error body", "the recipient"],
  ];
  for (const [what, needle] of forbidden) {
    assert.ok(needle, `${what} was captured for the test to look for`);
    assert.ok(!text.includes(needle), `${what} must not be logged — found it in: ${text.slice(0, 400)}`);
  }
  assert.ok(text.includes("HTTP 422"), "the status code is all that is logged");
});

console.log(`\n${passed} checks passed`);
