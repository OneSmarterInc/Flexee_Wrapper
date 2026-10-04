// Integration test: Spec 20 §2 — retrieval, the prompt, and what comes back.
//
// The class-level controls, the storage and the endpoint arrive in the next commit; this covers
// what is said to the provider and what is done with its answer. The suite ends by printing one
// captured request in full, from a student whose every identifier is a unique string, so the
// absence of those strings can be read rather than asserted.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection } from "@/lib/roster";
import { getEntry } from "@/lib/content";
import { chunkEntry, anchorsFor, EXCLUDED_HEADING } from "@/lib/assistant/chunk";
import { buildCorpus, search, SCORE_FLOOR } from "@/lib/assistant/corpus";
import { retrieve, clearIndexCache } from "@/lib/assistant/retrieve";
import { ask } from "@/lib/assistant/ask";
import {
  buildPrompt, validateCitations, NOTICE, NOT_IN_BOOK, NO_REVIEW_QUESTIONS,
  HISTORY_TURNS, HISTORY_TOKEN_CAP,
} from "@/lib/assistant/answer";
import { gate, GATE_MESSAGES } from "@/lib/assistant/gate";
import { fakeProvider } from "@/lib/ai/fake";
import { tokenise, Bm25 } from "@/lib/assistant/bm25";

const { users, identities, enrolments, questions } = schema;
let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

// Every identifier this student has is a string that exists nowhere else, so finding any of them
// in a captured request is proof rather than inference.
const NAME = "Zzqqname Zzqqsurname";
const EMAIL = "zzqqemail@wright.edu";
const D2L = "zzqqusername";
const ORG = "Z99887766";

const [student] = await db().insert(users).values({ displayName: NAME, d2lUsername: D2L }).returning();
await db().insert(identities).values({ userId: student.id, provider: "password", subject: EMAIL, passwordHash: "zzqqhash" });
const [prof] = await db().insert(users).values({ displayName: "Prof" }).returning();
await db().insert(identities).values({ userId: prof.id, provider: "password", subject: "prof@flexee.org", passwordHash: "x" });
const sec = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const [enr] = await db().insert(enrolments).values({ sectionId: sec.id, userId: student.id, role: "student" }).returning();

// A bank question in the database, so a test can prove its text never reaches a prompt.
const RATIONALE = "Zzqqrationale: an actor is a role, never a named individual.";
await db().insert(questions).values({
  id: "sad-c03-zz1", bookId: "sad", chapter: 3, objective: "Zzqqobjective", difficulty: "apply",
  stem: "Zzqqstem which two do not belong?", optionsJson: JSON.stringify([{ id: "a", text: "Zzqqoption", correct: true, rationale: RATIONALE }]),
  contentHash: "zz", updatedAt: new Date(),
});

console.log("Chunking");

await t("a chapter is cut at its section headings, and each chunk knows its address", async () => {
  const { manifest, markdown } = await getEntry("sad", "ch03");
  const chunks = chunkEntry(markdown, manifest);
  assert.ok(chunks.length >= 6, `expected the chapter's sections, got ${chunks.length}`);
  const anchored = chunks.filter((c) => c.anchor);
  assert.ok(anchored.length >= 6, "the manifest's sections are matched to their headings");
  const s2 = chunks.find((c) => c.anchor === "c3s2")!;
  assert.match(s2.heading, /Actors, Goals/);
  assert.equal(s2.chapter, 3);
  assert.equal(s2.entryId, "ch03");
  assert.equal(s2.bookId, "sad");
  assert.ok(s2.words > 50, "a section is a passage, not a line");
});

await t("the chapters' review questions are not in the index (decision 2)", async () => {
  const { manifest, markdown } = await getEntry("sad", "ch03");
  assert.match(markdown, /##\s+Review Questions/, "the chapter does have them");
  const chunks = chunkEntry(markdown, manifest);
  assert.ok(!chunks.some((c) => EXCLUDED_HEADING.test(c.heading)), "and none of them is a chunk");
  assert.ok(!chunks.some((c) => /Review Questions/i.test(c.heading)));
});

await t("a `####` subsection stays with its parent section", async () => {
  const { manifest, markdown } = await getEntry("sad", "ch03");
  assert.match(markdown, /^####\s+Common Use-Case Mistakes/m);
  const chunks = chunkEntry(markdown, manifest);
  assert.ok(!chunks.some((c) => /Common Use-Case Mistakes/.test(c.heading)), "not a chunk of its own");
  assert.ok(chunks.some((c) => /Common Use-Case Mistakes/.test(c.text)), "but its words are indexed");
});

await t("only a real address is a citable anchor", async () => {
  const { manifest } = await getEntry("sad", "ch03");
  const anchors = anchorsFor(manifest);
  assert.ok(anchors.has("c3s2"));
  assert.ok(!anchors.has("c3s99"));
  for (const f of manifest.figures) assert.ok(anchors.has(`fig-${f.number.replace(/\./g, "-")}`), "figures too");
});

console.log("Retrieval");

await t("BM25 ranks the right section first for a plain question", () => {
  const docs = ["Actors and the system boundary. An actor is a role.", "Activity diagrams and the unhappy path.", "Choosing a model."];
  const bm = new Bm25(docs);
  assert.equal(bm.top("what is an actor", 1)[0].index, 0);
  assert.deepEqual(tokenise("What IS an Actor?"), ["actor"], "stopwords and case go");
  assert.equal(bm.rank("parking permit").length, 0, "nothing matches nothing");
});

await t("the corpus is the class's book, chapters only, and it caches by content", async () => {
  clearIndexCache();
  const r = await retrieve(sec.id, "sad", "what is an actor in a use case diagram");
  assert.ok(r.corpus.chunks.length > 80, `expected the whole book, got ${r.corpus.chunks.length}`);
  assert.ok(r.corpus.chunks.every((c) => /^ch\d+$/.test(c.entryId)), "front matter is not indexed (decision 3)");
  assert.equal(r.passages.length, 5);
  assert.ok(r.passages.some((p) => p.chunk.entryId === "ch03"), "and chapter 3 is in the five");
  const again = await retrieve(sec.id, "sad", "another question entirely");
  assert.equal(again.corpus, r.corpus, "the same corpus object, not rebuilt");
});

await t("the no-call floor fires only for a question with nothing in common with the book", async () => {
  const r = await retrieve(sec.id, "sad", "zzqqalpha zzqqbeta zzqqgamma");
  assert.equal(r.hopeless, true);
  const good = await retrieve(sec.id, "sad", "what is an actor in a use case diagram");
  assert.equal(good.hopeless, false);
  assert.ok(good.topScore > SCORE_FLOOR);
});

console.log("The prompt");

await t("it carries the passages, their addresses, and nothing else", async () => {
  const { passages } = await retrieve(sec.id, "sad", "what is an actor");
  const req = buildPrompt({ question: "what is an actor", passages: passages.map((p) => p.chunk) });
  assert.match(req.system, /only from the numbered/i);
  assert.equal(req.messages.length, 1);
  const body = req.messages[0].content;
  assert.match(body, /^Passages from the book:/);
  assert.match(body, /\[1\] .+ \(\/sad\/ch\d+(#c\d+s\d+)?\)/);
  assert.match(body, /Question: what is an actor$/);
  assert.equal(req.temperature, 0);
});

await t("history is the last six turns, oldest first, inside the token cap", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "assistant" : "student") as "student" | "assistant", body: `turn ${i}` }));
  const req = buildPrompt({ question: "next", passages: [], history });
  const turns = req.messages.slice(0, -1);
  assert.equal(turns.length, HISTORY_TURNS);
  assert.match(turns[0].content, /turn 4$/, "oldest of the six first");
  assert.match(turns[turns.length - 1].content, /turn 9$/);
  assert.equal(turns[0].role, "user");
  // A long turn is dropped rather than overflowing the cap.
  const huge = [{ role: "student" as const, body: "x".repeat(HISTORY_TOKEN_CAP * 4 + 100) }, { role: "assistant" as const, body: "short" }];
  const req2 = buildPrompt({ question: "next", passages: [], history: huge });
  assert.equal(req2.messages.length, 2, "the short turn and the question; the huge one is left out");
});

await t("no text from the question bank is anywhere in a prompt (rule 3)", async () => {
  const q = (await db().select().from(questions).where(eq(questions.id, "sad-c03-zz1")))[0];
  const { passages } = await retrieve(sec.id, "sad", "actors and the system boundary");
  const req = buildPrompt({ question: "actors and the system boundary", passages: passages.map((p) => p.chunk) });
  const whole = req.system + req.messages.map((m) => m.content).join("\n");
  for (const needle of [q.stem, RATIONALE, "Zzqqoption", "Zzqqobjective"]) {
    assert.ok(!whole.includes(needle), `the prompt must not contain: ${needle}`);
  }
});

console.log("The answer");

await t("a link to a real place in this book becomes a citation", async () => {
  const { corpus } = await retrieve(sec.id, "sad", "actors");
  const allowed = { bookId: "sad", anchors: corpus.anchors, entryTitles: corpus.entryTitles };
  const r = validateCitations("An actor is a role. See [Actors, Goals, and the System Boundary](/sad/ch03#c3s2).", allowed);
  assert.equal(r.citations.length, 1);
  assert.equal(r.citations[0].href, "/sad/ch03#c3s2");
  assert.equal(r.stripped, 0);
  assert.equal(r.text, "An actor is a role. See Actors, Goals, and the System Boundary.", "the text itself carries no markup");
});

await t("a link anywhere else is stripped, and the sentence still reads (rule 6)", async () => {
  const { corpus } = await retrieve(sec.id, "sad", "actors");
  const allowed = { bookId: "sad", anchors: corpus.anchors, entryTitles: corpus.entryTitles };
  for (const bad of [
    "/mis3000/ch01#c1s1",          // another book
    "/sad/ch03#c3s99",             // an anchor the chapter does not have
    "/sad/nosuchchapter#c1s1",     // an entry the book does not have
    "https://example.invalid/x",   // off the site
    "/admin",                      // elsewhere in the Wrapper
  ]) {
    const r = validateCitations(`Read more at [here](${bad}).`, allowed);
    assert.equal(r.citations.length, 0, `${bad} must not become a citation`);
    assert.equal(r.stripped, 1);
    assert.equal(r.text, "Read more at here.");
  }
  const bare = validateCitations("See https://example.invalid/page for more.", allowed);
  assert.equal(bare.citations.length, 0);
  assert.ok(!bare.text.includes("http"), "a bare URL is removed outright");
});

await t("model output is never HTML, and a duplicate citation is listed once", async () => {
  const { corpus } = await retrieve(sec.id, "sad", "actors");
  const allowed = { bookId: "sad", anchors: corpus.anchors, entryTitles: corpus.entryTitles };
  const r = validateCitations(
    "<script>alert(1)</script> <b>bold</b> See [A](/sad/ch03#c3s2) and again [B](/sad/ch03#c3s2).", allowed);
  assert.equal(r.citations.length, 1, "one address, one citation");
  // The text is shown as text: nothing here is ever handed to dangerouslySetInnerHTML, and the
  // tags survive as characters precisely because they are never parsed.
  assert.ok(r.text.includes("<script>"), "the tag is kept as text, not stripped into working markup");
});

await t("an answer that cites nothing becomes 'not in the book' (layer 3)", async () => {
  const { corpus, passages } = await retrieve(sec.id, "sad", "what is an actor");
  const fake = fakeProvider({ answer: () => "An actor is whatever I say it is." });
  const a = await ask({
    question: "what is an actor", passages: passages.map((p) => p.chunk), hopeless: false,
    allowed: { bookId: "sad", anchors: corpus.anchors, entryTitles: corpus.entryTitles },
    provider: fake.provider,
  });
  assert.equal(a.text, NOT_IN_BOOK);
  assert.equal(a.offerInstructor, true);
  assert.ok(a.tokensIn > 0, "the call happened, so it is counted");
});

await t("nothing relevant means no provider call at all (rule 7, layer 1)", async () => {
  const fake = fakeProvider();
  const a = await ask({
    question: "zzqqalpha zzqqbeta zzqqgamma", passages: [], hopeless: true,
    allowed: { bookId: "sad", anchors: new Map(), entryTitles: new Map() },
    provider: fake.provider,
  });
  assert.equal(a.text, NOT_IN_BOOK);
  assert.equal(a.offerInstructor, true);
  assert.deepEqual(fake.captured, [], "the provider was never asked");
  assert.equal(a.tokensIn, 0);
});

await t("a review-question ask is deflected without a provider call (decision 2)", async () => {
  const fake = fakeProvider();
  for (const q of ["What is the answer to review question 3?", "Help me with the end-of-chapter exercises"]) {
    const a = await ask({
      question: q, passages: [], hopeless: false,
      allowed: { bookId: "sad", anchors: new Map(), entryTitles: new Map() },
      provider: fake.provider,
    });
    assert.equal(a.text, NO_REVIEW_QUESTIONS);
    assert.equal(a.offerInstructor, true);
  }
  assert.deepEqual(fake.captured, [], "and never asked");
});

await t("a provider failure loses nothing and offers the instructor", async () => {
  const { corpus, passages } = await retrieve(sec.id, "sad", "what is an actor");
  const fake = fakeProvider({ fail: "provider error 503" });
  const a = await ask({
    question: "what is an actor", passages: passages.map((p) => p.chunk), hopeless: false,
    allowed: { bookId: "sad", anchors: corpus.anchors, entryTitles: corpus.entryTitles },
    provider: fake.provider,
  });
  assert.equal(a.reason, "provider-error");
  assert.equal(a.offerInstructor, true);
  assert.match(a.text, /ask your instructor/i);
});

console.log("The gate");

await t("it refuses in the order that misleads a student least", () => {
  const base = {
    aiAvailable: true, classEnabled: true, bookPublished: true, attemptsInProgress: 0,
    assignmentOff: false, requestsToday: 0, dailyPerStudent: 20, tokensThisMonth: 0, monthlyTokenCap: 500_000,
  };
  const why = (over: Partial<typeof base>) => {
    const g = gate({ ...base, ...over });
    return g.allowed ? "allowed" : g.reason;
  };
  assert.deepEqual(gate(base), { allowed: true });
  assert.equal(why({ aiAvailable: false }), "off");
  assert.equal(why({ classEnabled: false }), "off");
  assert.equal(why({ bookPublished: false }), "unpublished");
  // An open attempt outranks a limit: it is the reason that will still be true in a minute.
  const both = gate({ ...base, attemptsInProgress: 1, requestsToday: 99 });
  assert.equal(why({ attemptsInProgress: 1, requestsToday: 99 }), "attempt");
  assert.match(both.allowed === false ? both.message : "", /Submit it, and the assistant comes back/);
  // A class that is off never mentions exams.
  const off = gate({ ...base, classEnabled: false, attemptsInProgress: 1 });
  assert.ok(off.allowed === false && !/exam/i.test(off.message));
  assert.equal(why({ assignmentOff: true }), "assignment");
  assert.equal(why({ requestsToday: 20 }), "daily");
  assert.equal(why({ tokensThisMonth: 500_000 }), "cap");
  assert.deepEqual(gate({ ...base, dailyPerStudent: 0, requestsToday: 999 }), { allowed: true }, "0 means no limit");
  for (const m of Object.values(GATE_MESSAGES)) assert.ok(m.length > 20, "every refusal says something useful");
});

console.log("The notice");

await t("it is the agreed wording, to the letter", () => {
  assert.equal(NOTICE,
    "AI assistant. It answers from your course book, and it can be wrong. Your instructor can see " +
    "these questions. Only your question and the matching passages from the book are sent to the AI " +
    "service, never your name, email or grades. Please don't type personal details.");
});

console.log("What the provider is told (rule 4)");

await t("not one of this student's identifiers appears in the request", async () => {
  const fake = fakeProvider();
  const { corpus, passages } = await retrieve(sec.id, "sad", "what is an actor in a use case diagram");
  await ask({
    question: "what is an actor in a use case diagram",
    passages: passages.map((p) => p.chunk), hopeless: false,
    allowed: { bookId: "sad", anchors: corpus.anchors, entryTitles: corpus.entryTitles },
    history: [{ role: "student", body: "earlier question about actors" }, { role: "assistant", body: "earlier answer" }],
    provider: fake.provider,
  });
  const cap = fake.last();
  const whole = cap.system + "\n" + cap.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  for (const [what, needle] of [
    ["the display name", NAME], ["the surname", "Zzqqsurname"], ["the email", EMAIL],
    ["the D2L username", D2L], ["an OrgDefinedId", ORG], ["the user id", student.id],
    ["the enrolment id", enr.id], ["the class id", sec.id], ["the password hash", "zzqqhash"],
  ] as const) {
    assert.ok(!whole.includes(needle), `${what} must not be sent (${needle})`);
  }

  if (process.env.SHOW_PROMPT === "1") {
    console.log("\n--- the captured request, in full ---");
    console.log(`system:\n${cap.system}`);
    for (const m of cap.messages) console.log(`\n${m.role}:\n${m.content}`);
    console.log("--- end ---\n");
  }
});

console.log(`\n${passed} checks passed`);
