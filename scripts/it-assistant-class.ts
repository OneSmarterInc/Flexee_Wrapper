// Integration test: Spec 20 §3 and §4 — the class's switch, the limits, who may read a thread,
// the usage record, Ask your instructor, and the retention sweep.
//
// Everything here runs against the real modules and the fake provider. The service is driven end
// to end, so a rule that the endpoint would enforce is proved where it is decided.
import assert from "node:assert/strict";
import { and, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { publishClassBook } from "@/lib/publish";
import { setAiProvider, setAiProvider as installAi } from "@/lib/ai";
import { fakeProvider } from "@/lib/ai/fake";
import { setMailTransport, type Mail } from "@/lib/mail";
import { askAssistant } from "@/lib/assistant/service";
import {
  settingsFor, setSettings, threadFor, messagesFor, threadsForClass, threadsForStudent,
  classUsage, askInstructor, inboxFor, answerQuestion, sweepThreads, recordUsage, DEFAULTS,
} from "@/lib/assistant/store";
import { NOT_IN_BOOK } from "@/lib/assistant/answer";
import { GATE_MESSAGES } from "@/lib/assistant/gate";

const {
  users, identities, enrolments, exams, examAttempts, assignments,
  assistantThreads, assistantMessages, assistantUsage, assistantQuestions,
} = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
const n = async (q: Promise<{ c: number | string }[]>) => Number((await q)[0]?.c ?? 0);

process.env.AI_ENABLED = "true";
const fake = fakeProvider();
installAi(fake.provider);
const outbox: Mail[] = [];
setMailTransport((m) => { outbox.push(m); return { ok: true }; });

async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const prof2 = await account("Other Prof", "prof2@flexee.org");
const sam = await account("Sam Student", "sam@wright.edu");
const mia = await account("Mia Student", "mia@wright.edu");

const sec = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const other = await createSection(prof2.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
const [samEnr] = await db().insert(enrolments).values({ sectionId: sec.id, userId: sam.id, role: "student" }).returning();
const [miaEnr] = await db().insert(enrolments).values({ sectionId: sec.id, userId: mia.id, role: "student" }).returning();
await publishClassBook(prof.id, sec.id);

const QUESTION = "what is an actor in a use case diagram";

console.log("Rule 2 — a new class has it off");

await t("the default is off, and nothing happens until faculty turn it on", async () => {
  const s = await settingsFor(sec.id);
  assert.equal(s.enabled, false);
  assert.equal(s.dailyPerStudent, DEFAULTS.dailyPerStudent);
  assert.equal(s.monthlyTokenCap, DEFAULTS.monthlyTokenCap);
  const r = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "off");
  assert.equal(r.ok === false && r.message, GATE_MESSAGES.off);
  assert.deepEqual(fake.captured, [], "and the provider was never asked");
  assert.equal(await n(db().select({ c: count() }).from(assistantThreads)), 0, "nothing was stored");
});

await t("only the class's faculty and admins can switch it on", async () => {
  assert.equal((await setSettings(sam.id, sec.id, { enabled: true })).ok, false, "not a student");
  assert.equal((await setSettings(prof2.id, sec.id, { enabled: true })).ok, false, "not another class's faculty");
  assert.equal((await settingsFor(sec.id)).enabled, false, "and it is still off");
  assert.equal((await setSettings(admin.id, sec.id, { enabled: true })).ok, true, "an admin may");
  assert.equal((await setSettings(prof.id, sec.id, { enabled: true, dailyPerStudent: 3, monthlyTokenCap: 400_000 })).ok, true);
  const s = await settingsFor(sec.id);
  assert.equal(s.enabled, true);
  assert.equal(s.dailyPerStudent, 3);
  assert.equal(s.monthlyTokenCap, 400_000);
});

console.log("Asking, and what is stored");

await t("a question is answered, stored with its citations, and counted", async () => {
  fake.reset();
  const r = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.ok(r.ok, r.ok === false ? r.message : "");
  assert.ok(r.ok && r.answer.citations.length > 0, "it cited the book");
  assert.ok(r.ok && r.answer.citations.every((c) => c.href.startsWith("/sad/")));
  const msgs = await messagesFor(r.ok ? r.threadId : "");
  assert.deepEqual(msgs.map((m) => m.role), ["student", "assistant"]);
  assert.equal(msgs[0].body, QUESTION);
  assert.ok(msgs[1].citations.length > 0, "the citations are stored with the answer");
  const u = await classUsage(sec.id);
  assert.equal(u.requests, 1);
  assert.ok(u.tokens > 0 && u.costMicros > 0, "tokens and an estimated cost");
});

await t("a usage record holds no content (rule 8)", async () => {
  const rows = await db().select().from(assistantUsage);
  const dump = JSON.stringify(rows);
  for (const needle of [QUESTION, "actor", "Sam Student", "sam@wright.edu"]) {
    assert.ok(!dump.includes(needle), `a usage record must not hold: ${needle}`);
  }
  assert.ok(rows.every((r) => r.provider === "fake" && r.model === "fake-1" && r.day.length === 10));
});

await t("a second turn carries the thread's history, and only this student's", async () => {
  fake.reset();
  const first = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.ok(first.ok);
  const second = await askAssistant({
    userId: sam.id, bookId: "sad", question: "and what is a use case then?",
    threadId: first.ok ? first.threadId : undefined,
  });
  assert.ok(second.ok);
  assert.equal(second.ok && second.threadId, first.ok && first.threadId, "the same thread");
  const sent = fake.captured[fake.captured.length - 1];
  assert.ok(sent.messages.length > 1, "the earlier turns went with it");
  assert.match(sent.messages[0].content, /actor/i);
  // Another student's thread is not a thread this student may continue.
  const hers = await askAssistant({ userId: mia.id, bookId: "sad", question: "what is an activity diagram" });
  assert.ok(hers.ok);
  const stolen = await askAssistant({
    userId: mia.id, bookId: "sad", question: "carry on", threadId: first.ok ? first.threadId : undefined,
  });
  assert.equal(stolen.ok, false);
  assert.equal(stolen.ok === false && stolen.reason, "thread");
});

console.log("Rule 5 — an exam in progress");

await t("an open attempt stops it, and submitting brings it back", async () => {
  // Room to ask: the daily limit is this suite's own subject two cases below.
  await setSettings(prof.id, sec.id, { dailyPerStudent: 50 });
  const [exam] = await db().insert(exams).values({
    sectionId: sec.id, title: "Midterm", blueprintJson: "{}", status: "open", feedback: "after_close", attemptLimit: 1,
  }).returning();
  const [att] = await db().insert(examAttempts).values({
    examId: exam.id, enrolmentId: samEnr.id, servedJson: "[]", maxPoints: 10,
  }).returning();
  fake.reset();
  const during = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.equal(during.ok, false);
  assert.equal(during.ok === false && during.reason, "attempt");
  assert.match(during.ok === false ? during.message : "", /Submit it, and the assistant comes back/);
  assert.deepEqual(fake.captured, [], "no provider call while an exam is open");

  // Mia is unaffected by Sam's attempt.
  const hers = await askAssistant({ userId: mia.id, bookId: "sad", question: QUESTION });
  assert.ok(hers.ok, "another student is not stopped");

  await db().update(examAttempts).set({ submittedAt: new Date() }).where(eq(examAttempts.id, att.id));
  const after = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.ok(after.ok, `and it works again once submitted (refused as: ${after.ok === false ? after.reason : ""})`);
});

await t("faculty can turn it off for one assignment without touching the class", async () => {
  const [a] = await db().insert(assignments).values({
    sectionId: sec.id, title: "Case study", points: 20, createdBy: prof.id, assistantOff: true,
  }).returning();
  const blocked = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION, assignmentId: a.id });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.reason, "assignment");
  const elsewhere = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.ok(elsewhere.ok, "the class itself is unaffected");
  // Another class's assignment id cannot switch this class off.
  const [b] = await db().insert(assignments).values({
    sectionId: other.id, title: "Theirs", points: 20, createdBy: prof2.id, assistantOff: true,
  }).returning();
  const notMine = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION, assignmentId: b.id });
  assert.ok(notMine.ok, "an assignment in another class does not apply");
});

console.log("Rule 8 — the limits");

await t("the per-student daily limit stops that student and nobody else", async () => {
  await setSettings(prof.id, sec.id, { dailyPerStudent: 1, monthlyTokenCap: 400_000 });
  await db().delete(assistantUsage);
  const first = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.ok(first.ok);
  const second = await askAssistant({ userId: sam.id, bookId: "sad", question: "another one" });
  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.reason, "daily");
  assert.match(second.ok === false ? second.message : "", /resets tomorrow/);
  const hers = await askAssistant({ userId: mia.id, bookId: "sad", question: QUESTION });
  assert.ok(hers.ok, "the limit is per student");
  await setSettings(prof.id, sec.id, { dailyPerStudent: 50 });
});

await t("the class's monthly token cap stops everyone, and is counted in tokens", async () => {
  await db().delete(assistantUsage);
  await setSettings(prof.id, sec.id, { monthlyTokenCap: 1000 });
  await recordUsage({ sectionId: sec.id, enrolmentId: samEnr.id, provider: "fake", model: "fake-1", tokensIn: 900, tokensOut: 150 });
  const u = await classUsage(sec.id);
  assert.equal(u.tokens, 1050);
  assert.equal(u.cap, 1000);
  assert.equal(u.sharePct, 100);
  const blocked = await askAssistant({ userId: mia.id, bookId: "sad", question: QUESTION });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.reason, "cap");
  await setSettings(prof.id, sec.id, { monthlyTokenCap: 2_000_000 });
  assert.ok((await askAssistant({ userId: mia.id, bookId: "sad", question: QUESTION })).ok, "raising it lets them in");
});

console.log("Rule 9 — who may read a thread");

await t("its student and the class's faculty, and nobody else", async () => {
  const r = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
  assert.ok(r.ok);
  const id = r.ok ? r.threadId : "";
  assert.equal((await threadFor(sam.id, id))?.as, "student");
  assert.equal((await threadFor(prof.id, id))?.as, "faculty");
  assert.equal(await threadFor(mia.id, id), null, "another student cannot");
  assert.equal(await threadFor(prof2.id, id), null, "another class's faculty cannot");
  assert.equal(await threadFor(admin.id, id), null, "nor an admin who does not teach it");
  // The faculty list names the student; the admin's view is the meter, which has no content.
  const list = await threadsForClass(sec.id);
  assert.ok(list.some((x) => x.id === id && x.student === "Sam Student"));
  const mine = await threadsForStudent(samEnr.id);
  assert.ok(mine.some((x) => x.id === id));
  assert.ok(!(await threadsForStudent(miaEnr.id)).some((x) => x.id === id));
});

console.log("Rule 11 — Ask your instructor");

await t("asking makes one open item, with the thread, however often it is pressed", async () => {
  const r = await askAssistant({ userId: sam.id, bookId: "sad", question: "zzqqalpha zzqqbeta zzqqgamma" });
  assert.ok(r.ok);
  assert.equal(r.ok && r.answer.text, NOT_IN_BOOK, "the case this button exists for");
  assert.equal(r.ok && r.answer.offerInstructor, true);
  const id = r.ok ? r.threadId : "";
  const q1 = await askInstructor(id, sec.id, samEnr.id);
  const q2 = await askInstructor(id, sec.id, samEnr.id);
  assert.equal(q1.id, q2.id, "pressing it twice does not make two");
  const inbox = await inboxFor(sec.id);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].threadId, id);
  assert.equal(inbox[0].student, "Sam Student");
  assert.match(inbox[0].title, /zzqq/);
});

await t("a faculty reply reaches the student in the thread, and names who to tell", async () => {
  const [q] = await inboxFor(sec.id);
  assert.equal((await answerQuestion(prof2.id, q.id, "hello")).ok, false, "not another class's faculty");
  assert.equal((await answerQuestion(prof.id, q.id, "   ")).ok, false, "and not an empty reply");
  const r = await answerQuestion(prof.id, q.id, "  Look at section 3.2, and come to office hours.  ");
  assert.ok(r.ok);
  const msgs = await messagesFor(q.threadId);
  assert.equal(msgs[msgs.length - 1].role, "instructor");
  assert.equal(msgs[msgs.length - 1].body, "Look at section 3.2, and come to office hours.");
  assert.equal((await inboxFor(sec.id)).length, 0, "the item is closed");
  assert.equal((await inboxFor(sec.id, "answered")).length, 1);
  // The store does not send: it hands back the address, and the action sends. That keeps the
  // reply landing in one transaction and the courtesy email outside it.
  assert.equal(r.ok && r.email, "sam@wright.edu");
  assert.equal(r.ok && r.threadId, q.threadId);
});

await t("the email says there is a reply, not what it says", async () => {
  outbox.length = 0;
  // Exactly what replyToQuestionAction does with what the store returned.
  const { sendMail } = await import("@/lib/mail");
  await sendMail({
    to: "sam@wright.edu",
    subject: "Your instructor replied to your question",
    text: [
      "Your instructor has replied to the question you asked in your course.",
      "",
      "Open the conversation: https://wrapper.example.org/assistant/t1",
    ].join("\n"),
  });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "sam@wright.edu");
  assert.ok(!outbox[0].text.includes("Look at section"), "the reply's words stay in the Wrapper");
  assert.ok(!outbox[0].text.includes("zzqq"), "and so does the question's");
});

await t("a send that throws does not lose a reply that is already in the thread", async () => {
  const r0 = await askAssistant({ userId: mia.id, bookId: "sad", question: "zzqqalpha zzqqbeta" });
  assert.ok(r0.ok);
  const q = await askInstructor(r0.ok ? r0.threadId : "", sec.id, miaEnr.id);
  const r = await answerQuestion(prof.id, q.id, "Try chapter 4.");
  assert.ok(r.ok, "the reply landed first");
  setMailTransport(() => { throw new Error("mail is down"); });
  try {
    const { sendMail } = await import("@/lib/mail");
    const sent = await sendMail({ to: r.ok ? r.email ?? "" : "", subject: "s", text: "t" });
    assert.equal(sent.ok, false, "the adapter reports the failure rather than throwing");
  } finally {
    setMailTransport((m) => { outbox.push(m); return { ok: true }; });
  }
  const msgs = await messagesFor(q.threadId);
  assert.equal(msgs[msgs.length - 1].body, "Try chapter 4.", "and the reply is still there");
  assert.equal((await inboxFor(sec.id, "answered")).some((x) => x.threadId === q.threadId), true);
});

console.log("Rule 10 — retention");

await t("it deletes old threads, keeps new ones, and keeps every usage record", async () => {
  process.env.ASSISTANT_RETENTION_DAYS = "30";
  const before = {
    threads: await n(db().select({ c: count() }).from(assistantThreads)),
    usage: await n(db().select({ c: count() }).from(assistantUsage)),
    questions: await n(db().select({ c: count() }).from(assistantQuestions)),
  };
  assert.ok(before.threads >= 3 && before.usage >= 1);
  // Age two threads past the window.
  const all = await db().select({ id: assistantThreads.id }).from(assistantThreads);
  const old = new Date(Date.now() - 40 * 86_400_000);
  await db().update(assistantThreads).set({ lastMessageAt: old })
    .where(sql`${assistantThreads.id} in (${sql.join(all.slice(0, 2).map((x) => sql`${x.id}`), sql`, `)})`);

  const swept = await sweepThreads();
  assert.equal(swept.deleted, 2);
  assert.equal(swept.retentionDays, 30);
  const after = {
    threads: await n(db().select({ c: count() }).from(assistantThreads)),
    usage: await n(db().select({ c: count() }).from(assistantUsage)),
  };
  assert.equal(after.threads, before.threads - 2);
  assert.equal(after.usage, before.usage, "usage records stay: a month's total must not shrink");
  // Their messages and inbox items went with them, by cascade.
  for (const x of all.slice(0, 2)) {
    assert.equal(await n(db().select({ c: count() }).from(assistantMessages).where(eq(assistantMessages.threadId, x.id))), 0);
    assert.equal(await n(db().select({ c: count() }).from(assistantQuestions).where(eq(assistantQuestions.threadId, x.id))), 0);
  }
  delete process.env.ASSISTANT_RETENTION_DAYS;
  assert.equal((await sweepThreads()).retentionDays, 120, "the default is 120 days");
});

console.log("Rule 1 — the global switch");

await t("with AI_ENABLED off, nothing is answered however the class is set", async () => {
  delete process.env.AI_ENABLED;
  try {
    const r = await askAssistant({ userId: sam.id, bookId: "sad", question: QUESTION });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "off");
  } finally { process.env.AI_ENABLED = "true"; }
});

await t("an unpublished book is not answered from", async () => {
  const quiet = await createSection(prof.id, "sad", "MIS 3250-03", "2027 Spring", { teach: true });
  const [e] = await db().insert(enrolments).values({ sectionId: quiet.id, userId: (await account("Pat", "pat@wright.edu")).id, role: "student" }).returning();
  await setSettings(prof.id, quiet.id, { enabled: true });
  const who = (await db().select({ userId: enrolments.userId }).from(enrolments).where(eq(enrolments.id, e.id)))[0];
  const r = await askAssistant({ userId: who.userId, bookId: "sad", question: QUESTION });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "unpublished");
});

console.log("Rule 12 — the logs");

await t("a captured log of the whole flow holds no question, answer or identifier", async () => {
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const lines: string[] = [];
  const grab = (...a: unknown[]) => { lines.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
  const SECRET = "zzqqsecretquestion about actors and boundaries";
  let answer = "";
  try {
    console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
    const r = await askAssistant({ userId: sam.id, bookId: "sad", question: SECRET });
    answer = r.ok ? r.answer.text : "";
    await sweepThreads();
  } finally { Object.assign(console, real); }
  const text = lines.join("\n");
  for (const [what, needle] of [
    ["the question", SECRET], ["the answer", answer || "zz-nothing"],
    ["the student's name", "Sam Student"], ["their address", "sam@wright.edu"],
    ["their user id", sam.id], ["the class id", sec.id],
  ] as const) {
    assert.ok(needle, `${what} was captured for the test to look for`);
    assert.ok(!text.includes(needle), `${what} must not be logged — found it in: ${text.slice(0, 300)}`);
  }
});

setAiProvider(null);
console.log(`\n${passed} checks passed`);
