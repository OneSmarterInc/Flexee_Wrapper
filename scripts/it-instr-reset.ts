// Integration test: the instructor's "this student cannot get in" button.
//
// Spec 17 replaced what this used to test. It used to generate a temporary password and hand it
// back through the URL query string — so the password went into browser history and into every log
// between here and the browser. Now the instructor sends (or copies once) a set-your-password link
// and the student chooses their own. This suite is what holds that in place: the two functions the
// old flow used are gone, and no password may pass through a URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, sectionRoster } from "@/lib/roster";
import { setMailTransport, type Mail, type MailResult } from "@/lib/mail";
import * as recovery from "@/lib/recovery";
import {
  completeSetPassword, copySetPasswordLink, sendSetPasswordInvite, inviteStatesFor, studentOfEnrolment,
} from "@/lib/recovery";

const { users, identities, enrolments, sessions } = schema;
let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const outbox: Mail[] = [];
setMailTransport((m): MailResult => { outbox.push(m); return { ok: true }; });
const BASE = "https://wrapper.example.org";
const tokenIn = (m: Mail) => m.text.match(/\/set-password\?token=([0-9a-f]+)/)![1];

const [prof] = await db().insert(users).values({ displayName: "Prof" }).returning();
await db().insert(identities).values({ userId: prof.id, provider: "password", subject: "prof@flexee.org", passwordHash: "x" });
const sec = await createSection(prof.id, "mis3000", "MIS 3000-01", "2027 Spring", { teach: true });

const [sam] = await db().insert(users).values({ displayName: "Sam Student" }).returning();
await db().insert(identities).values({ userId: sam.id, provider: "password", subject: "sam@wright.edu", passwordHash: "an-old-hash" });
await db().insert(enrolments).values({ sectionId: sec.id, userId: sam.id, role: "student" });
await db().insert(sessions).values({ id: "sam-1", userId: sam.id, expiresAt: new Date(Date.now() + 9e8) });

console.log("The temporary password is gone");

await t("neither setStudentPassword nor tempPassword exists any more", () => {
  assert.equal((recovery as Record<string, unknown>).setStudentPassword, undefined);
  assert.equal((recovery as Record<string, unknown>).tempPassword, undefined);
});

await t("no action or faculty page passes a password through a URL", () => {
  for (const f of ["src/app/actions.ts", "src/app/teach/[section]/page.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/[?&]temp=/.test(src), `${f} must not put a password in a query string`);
    assert.ok(!/pwreset/.test(src), `${f} must not carry the old temporary-password parameters`);
  }
});

console.log("What the instructor does instead");

await t("sending a link leaves the student's own password alone until they use it", async () => {
  const r = await sendSetPasswordInvite(sam.id, sec.id, "sam@wright.edu", BASE);
  assert.equal(r.ok, true);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "sam@wright.edu");
  const ident = (await db().select().from(identities).where(eq(identities.userId, sam.id)))[0];
  assert.equal(ident.passwordHash, "an-old-hash", "nothing changes before the student acts");
  assert.equal(Number((await db().select({ c: count() }).from(sessions).where(eq(sessions.userId, sam.id)))[0].c), 1,
    "and they are not thrown out of a session they are in the middle of");
});

await t("following it sets the password they chose, and signs the old sessions out", async () => {
  const done = await completeSetPassword(tokenIn(outbox[0]), "a-chosen-password");
  assert.ok(done);
  assert.equal(done!.userId, sam.id);
  const ident = (await db().select().from(identities).where(eq(identities.userId, sam.id)))[0];
  assert.ok(ident.passwordHash && ident.passwordHash !== "an-old-hash");
  assert.notEqual(ident.passwordHash, "a-chosen-password", "a hash, never the password itself");
  assert.ok(ident.emailVerifiedAt, "and the address is proven");
  assert.equal(Number((await db().select({ c: count() }).from(sessions).where(eq(sessions.userId, sam.id)))[0].c), 0);
  assert.equal(await completeSetPassword(tokenIn(outbox[0]), "again-and-again"), null, "once only");
});

await t("Copy link is the in-person path, and retires the link that was emailed", async () => {
  outbox.length = 0;
  await sendSetPasswordInvite(sam.id, sec.id, "sam@wright.edu", BASE);
  const emailed = tokenIn(outbox[0]);
  const copied = (await copySetPasswordLink(sam.id, sec.id, "sam@wright.edu", BASE)).match(/token=([0-9a-f]+)/)![1];
  assert.equal(await completeSetPassword(emailed, "yet-another-one"), null);
  assert.ok(await completeSetPassword(copied, "yet-another-one"));
  // The column answers "can this student get in?", so a student who already has a password reads
  // "Set up" whether or not a link is live for them.
  assert.equal((await inviteStatesFor(sec.id)).get(sam.id)!.state, "set up");
});

await t("a student who signs in through the LMS has no address, and the action says so", async () => {
  const [lms] = await db().insert(users).values({ displayName: "LMS Only" }).returning();
  await db().insert(identities).values({ userId: lms.id, provider: "lti", subject: "iss|xyz" });
  const [enr] = await db().insert(enrolments).values({ sectionId: sec.id, userId: lms.id, role: "student" }).returning();
  const found = await studentOfEnrolment(sec.id, enr.id);
  assert.ok(found, "the enrolment is found");
  assert.equal(found!.email, null, "but there is nowhere to send to");
});

await t("an enrolment belonging to another class is refused", async () => {
  const other = await createSection(prof.id, "mis3000", "MIS 3000-02", "2027 Spring", { teach: true });
  const enr = (await sectionRoster(sec.id)).find((r) => r.email === "sam@wright.edu")!;
  assert.equal(await studentOfEnrolment(other.id, enr.enrolmentId), null);
  assert.ok(await studentOfEnrolment(sec.id, enr.enrolmentId));
  assert.equal((await db().select().from(enrolments)
    .where(and(eq(enrolments.userId, sam.id), eq(enrolments.sectionId, sec.id)))).length, 1);
});

console.log(`\n${passed} checks passed`);
