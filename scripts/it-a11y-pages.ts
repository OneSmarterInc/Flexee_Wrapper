// Integration test: Spec 21 over the Wrapper's own pages, as opposed to the books.
//
// Every route that renders anything is rendered for real — the layout chain, the page component,
// the database seeded, only next/headers, next/link and next/navigation stubbed — and then read
// twice: by axe, and by a set of checks axe has no rule for (the skip link's target, exactly one
// h1, the title's shape, autocomplete on the password forms).
//
// The bar, from the spec: no serious or critical violation on any page. Moderate and minor findings
// are printed with a count so a regression is visible, and the ones the books themselves carry are
// the reader frame's business, not this suite's.
//
// What this cannot judge, because jsdom computes no layout and paints nothing: contrast, whether a
// focus ring is actually visible, target size, and anything that needs a real screen reader. Those
// are in docs/accessibility/manual-checks.md and in the opt-in browser run.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail } from "@/lib/admin";
import { createSection } from "@/lib/roster";
import { setScore } from "@/lib/gradebook";

const {
  users, identities, sessions, enrolments, exams, examAttempts, examResponses, questions,
  assignments, submissions, lineItems, announcements, scheduleItems, sims, classSims,
  assistantThreads, assistantMessages, libraryUploads, authTokens,
} = schema;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

// ------------------------------------------------------------------------------------- the world

async function account(name: string, email: string, password: string | null = "x") {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: password });
  return u;
}
async function sessionFor(userId: string, id: string) {
  const [s] = await db().insert(sessions)
    .values({ id, userId, expiresAt: new Date(Date.now() + 36e5) }).returning();
  return s.id;
}

const admin = await account("Ada Admin", "admin@flexee.invalid");
await setAdminByEmail("admin@flexee.invalid");
const prof = await account("Pat Professor", "prof@flexee.invalid");
const stu = await account("Sam Student", "student@flexee.invalid");

const sec = await createSection(prof.id, "sad", "Spring Section A", "2027 Spring", { teach: true });
const [enr] = await db().insert(enrolments)
  .values({ sectionId: sec.id, userId: stu.id, role: "student" }).returning();
// The book has to be published for a student's enrolment to grant access at all, so without this
// every page under /[book]/ redirects instead of rendering.
await db().update(schema.sections).set({ bookPublishedAt: new Date() }).where(eq(schema.sections.id, sec.id));

await db().insert(sims).values({ id: "mvcfn", title: "MVCFN", launchUrl: "https://x.invalid", published: true });
await db().insert(classSims).values({ sectionId: sec.id, simId: "mvcfn", addedBy: prof.id });
// Spec 27: a real session sim in this class, so /session can render its waiting state with a class
// attached. The student's enrolment is left unreleased, which is what makes that state the one
// rendered — it is also the only page here that mounts a client component.
await db().insert(sims).values({ id: "rapid-05-approve", number: 5, title: "Would You Approve This?", launchUrl: "https://sim05.invalid", published: true });
await db().insert(classSims).values({ sectionId: sec.id, simId: "rapid-05-approve", addedBy: prof.id });

// A question, so an exam can be served and a result page can render a real item.
await db().insert(questions).values({
  id: "q-a11y-1", bookId: "sad", chapter: 1, objective: "State what a requirements document is for",
  difficulty: "recall", stem: "Which document states what a system must do?",
  optionsJson: JSON.stringify([
    { id: "a", text: "A requirements specification", correct: true, rationale: "It is the statement of requirements." },
    { id: "b", text: "A test plan", correct: false, rationale: "That says how it will be checked." },
    { id: "c", text: "A Gantt chart", correct: false, rationale: "That is the schedule." },
    { id: "d", text: "A use case", correct: false, rationale: "That is one interaction, not the whole." },
  ]),
  contentHash: "a11y-1",
});

const [exam] = await db().insert(exams).values({
  sectionId: sec.id, title: "Chapter 1 quiz", status: "open", feedback: "after_close", attemptLimit: 2,
  blueprintJson: JSON.stringify({ mode: "fixed", ids: ["q-a11y-1"] }),
}).returning();

// Two attempts: one finished, so the result page has something to show, and one still open, so the
// page a student actually sits an exam on renders.
const [done] = await db().insert(examAttempts).values({
  examId: exam.id, enrolmentId: enr.id, servedJson: JSON.stringify([{ questionId: "q-a11y-1", optionOrder: ["a", "b", "c", "d"] }]),
  maxPoints: 1, score: 1, submittedAt: new Date(),
}).returning();
await db().insert(examResponses).values({ attemptId: done.id, questionId: "q-a11y-1", correct: true, selectedOptionId: "a", points: 1 });
const [open] = await db().insert(examAttempts).values({
  examId: exam.id, enrolmentId: enr.id,
  servedJson: JSON.stringify([{ questionId: "q-a11y-1", optionOrder: ["a", "b", "c", "d"] }]), maxPoints: 1,
}).returning();

const [asg] = await db().insert(assignments).values({
  sectionId: sec.id, title: "Worksheet 1", points: 10, createdBy: prof.id,
  instructions: "Answer the four questions.", published: true,
}).returning();
const [sub] = await db().insert(submissions).values({
  assignmentId: asg.id, enrolmentId: enr.id, status: "submitted", text: "my answer",
}).returning();

const li = (await db().select().from(lineItems).where(eq(lineItems.sectionId, sec.id)))[0];
await setScore(li.id, enr.id, 8);

await db().insert(announcements).values({ sectionId: sec.id, title: "Welcome", body: "Welcome to the class." });
await db().insert(scheduleItems).values({ sectionId: sec.id, title: "Read Chapter 1", kind: "reading", dueAt: new Date() });

const [thread] = await db().insert(assistantThreads)
  .values({ sectionId: sec.id, enrolmentId: enr.id, title: "What is an actor?" }).returning();
await db().insert(assistantMessages).values([
  { threadId: thread.id, role: "student", body: "What is an actor?" },
  { threadId: thread.id, role: "assistant", body: "An actor is anyone outside the system who uses it.", citationsJson: "[]" },
]);

// A recorded version of ch01, so the faculty page that reviews a chapter's changes has one to show.
{
  const { getEntry } = await import("@/lib/content");
  const e = await getEntry("sad", "ch01");
  await db().insert(schema.chapterVersions).values({
    bookId: "sad", entryId: "ch01", version: 1, contentHash: "a11y-ch01", title: e.manifest.title,
    markdown: e.markdown, manifestJson: JSON.stringify(e.manifest),
  });
}

const [upload] = await db().insert(libraryUploads).values({
  bookId: "sad", status: "ready", uploadedBy: admin.id, blobPath: "uploads/x.zip", fileName: "x.zip", sizeBytes: 4096,
}).returning();

await db().insert(authTokens).values({
  tokenHash: "hash-a11y-set", userId: stu.id, kind: "set_password", email: "student@flexee.invalid",
  sectionId: sec.id, expiresAt: new Date(Date.now() + 9e8),
});

const AS = {
  admin: await sessionFor(admin.id, "sess-a11y-admin"),
  faculty: await sessionFor(prof.id, "sess-a11y-faculty"),
  student: await sessionFor(stu.id, "sess-a11y-student"),
  none: null,
};

// --------------------------------------------------------------------------------- the page table

type Who = keyof typeof AS;
type Page = {
  route: string;
  mod: string;
  as: Who;
  params?: Record<string, string>;
  search?: Record<string, string>;
  /** The title's expected shape: the class's name, the book's, or neither. */
  titled?: "class" | "book" | "plain";
  h1?: string;
};

const PAGES: Page[] = [
  // Signed out, or signed in but outside a class.
  { route: "/login", mod: "@/app/login/page", as: "none", titled: "plain" },
  { route: "/login?error=bad", mod: "@/app/login/page", as: "none", search: { error: "Those details did not match." }, titled: "plain" },
  { route: "/signup", mod: "@/app/signup/page", as: "none", titled: "plain" },
  { route: "/forgot", mod: "@/app/forgot/page", as: "none", titled: "plain" },
  { route: "/reset", mod: "@/app/reset/page", as: "none", search: { token: "t" }, titled: "plain" },
  { route: "/set-password", mod: "@/app/set-password/page", as: "none", search: { token: "t" }, titled: "plain" },
  { route: "/account", mod: "@/app/account/page", as: "student", titled: "plain" },
  { route: "/lti/select", mod: "@/app/lti/select/page", as: "faculty", titled: "plain" },

  // The three portals.
  { route: "/student", mod: "@/app/student/page", as: "student", titled: "plain" },
  { route: "/faculty", mod: "@/app/faculty/page", as: "faculty", titled: "plain" },
  { route: "/admin", mod: "@/app/admin/page", as: "admin", titled: "plain" },
  { route: "/admin/sims", mod: "@/app/admin/sims/page", as: "admin", titled: "plain" },
  { route: "/admin/status", mod: "@/app/admin/status/page", as: "admin", titled: "plain" },
  { route: "/library", mod: "@/app/library/page", as: "admin", titled: "plain" },

  // The student's pages inside a class.
  { route: "/[book]", mod: "@/app/[book]/page", as: "student", params: { book: "sad" }, titled: "class" },
  { route: "/[book]/[entry]", mod: "@/app/[book]/[entry]/page", as: "student", params: { book: "sad", entry: "ch01" }, titled: "book" },
  { route: "/[book]/assignments", mod: "@/app/[book]/assignments/page", as: "student", params: { book: "sad" }, titled: "class" },
  { route: "/[book]/exams", mod: "@/app/[book]/exams/page", as: "student", params: { book: "sad" }, titled: "class" },
  { route: "/[book]/grades", mod: "@/app/[book]/grades/page", as: "student", params: { book: "sad" }, titled: "class" },
  { route: "/[book]/sims", mod: "@/app/[book]/sims/page", as: "student", params: { book: "sad" }, titled: "class" },

  // The faculty pages.
  { route: "/teach/[section]", mod: "@/app/teach/[section]/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/announcements", mod: "@/app/teach/[section]/announcements/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/aol", mod: "@/app/teach/[section]/aol/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/assignments", mod: "@/app/teach/[section]/assignments/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/assistant", mod: "@/app/teach/[section]/assistant/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/content", mod: "@/app/teach/[section]/content/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/exams", mod: "@/app/teach/[section]/exams/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/gradebook", mod: "@/app/teach/[section]/gradebook/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/import", mod: "@/app/teach/[section]/import/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/import/d2l", mod: "@/app/teach/[section]/import/d2l/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/mastery", mod: "@/app/teach/[section]/mastery/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/questions", mod: "@/app/teach/[section]/questions/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/schedule", mod: "@/app/teach/[section]/schedule/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/sims", mod: "@/app/teach/[section]/sims/page", as: "faculty", titled: "class" },
  { route: "/teach/[section]/syllabus", mod: "@/app/teach/[section]/syllabus/page", as: "faculty", titled: "class" },
  // Spec 27: /session.html, rendered in three of its eight states. Signed out and the two that a
  // student is most likely to meet — the bad link, and waiting on a release — because each renders
  // a different set of controls and the waiting one mounts a client component.
  { route: "/session (invalid)", mod: "@/app/session/page", as: "none",
    search: { sim: "rapid-05-approve", session: "nope" }, titled: "plain" },
  { route: "/session (signed out)", mod: "@/app/session/page", as: "none",
    search: { sim: "rapid-05-approve", session: "M7K2P" }, titled: "plain" },
  { route: "/session (not in the class)", mod: "@/app/session/page", as: "student",
    search: { sim: "rapid-05-approve", session: "M7K2P" }, titled: "plain" },
  // Spec 27: /open.html in two states. Signed out, and the staff one, which is what a faculty
  // member following a sim's direct link actually sees.
  { route: "/open (signed out)", mod: "@/app/open/page", as: "none",
    search: { sim: "rapid-05-approve" }, titled: "plain" },
  { route: "/open (staff)", mod: "@/app/open/page", as: "faculty",
    search: { sim: "rapid-05-approve" }, titled: "plain" },
];

// The pages that need an id from the seeded world, so they are added after it exists.
PAGES.push(
  // Spec 27: the waiting state, which needs the class id in the query. The student is enrolled and
  // unreleased, so this renders the live region and the WaitingForRelease client component.
  { route: "/session (waiting on a release)", mod: "@/app/session/page", as: "student",
    search: { sim: "rapid-05-approve", session: "M7K2P", course: sec.id }, titled: "plain" },
  // The student is in one class that has this sim and is unreleased, so /open renders its waiting
  // state — the branch with a client component and a named class.
  { route: "/open (waiting on a release)", mod: "@/app/open/page", as: "student",
    search: { sim: "rapid-05-approve" }, titled: "plain" },
  { route: "/[book]/assignments/[id]", mod: "@/app/[book]/assignments/[id]/page", as: "student",
    params: { book: "sad", id: asg.id }, titled: "class" },
  { route: "/[book]/exams/result/[attempt]", mod: "@/app/[book]/exams/result/[attempt]/page", as: "student",
    params: { book: "sad", attempt: done.id }, titled: "class" },
  { route: "/[book]/exams/take/[attempt]", mod: "@/app/[book]/exams/take/[attempt]/page", as: "student",
    params: { book: "sad", attempt: open.id }, titled: "class" },
  { route: "/assistant/[thread]", mod: "@/app/assistant/[thread]/page", as: "student",
    params: { thread: thread.id }, titled: "plain" },
  { route: "/admin/[section]", mod: "@/app/admin/[section]/page", as: "admin",
    params: { section: sec.id }, titled: "class" },
  { route: "/library/[id]", mod: "@/app/library/[id]/page", as: "admin",
    params: { id: upload.id }, titled: "plain" },
  { route: "/teach/[section]/assignments/[id]", mod: "@/app/teach/[section]/assignments/[id]/page", as: "faculty",
    params: { section: sec.id, id: asg.id }, titled: "class" },
  { route: "/teach/[section]/assignments/[id]/[submission]", mod: "@/app/teach/[section]/assignments/[id]/[submission]/page",
    as: "faculty", params: { section: sec.id, id: asg.id, submission: sub.id }, titled: "class" },
  { route: "/teach/[section]/content/[entry]", mod: "@/app/teach/[section]/content/[entry]/page", as: "faculty",
    params: { section: sec.id, entry: "ch01" }, titled: "class" },
  { route: "/teach/[section]/exams/[exam]", mod: "@/app/teach/[section]/exams/[exam]/page", as: "faculty",
    params: { section: sec.id, exam: exam.id }, titled: "class" },
);

/** The two routes that only redirect, listed so the count is honest about what is not rendered. */
const REDIRECTS = ["/", "/teach"];

// ----------------------------------------------------------------------------------- rendering it

const headers: any = await import("./test-support/next-headers.mjs");

async function render(p: Page) {
  const { renderToReadableStream } = await import("react-dom/server");
  headers.state.session = AS[p.as];
  const params = { ...(p.params ?? {}) } as Record<string, string>;
  if (p.route.includes("/teach/[section]") && !params.section) params.section = sec.id;

  const Page = (await import(p.mod)).default as any;
  const args = { params: Promise.resolve(params), searchParams: Promise.resolve(p.search ?? {}) };
  let tree = await Page(args);

  // The layouts a route sits inside, outermost last, the way Next nests them.
  const chain: string[] = [];
  if (p.route.startsWith("/[book]")) chain.push("@/app/[book]/layout");
  if (p.route.startsWith("/teach/[section]")) chain.push("@/app/teach/[section]/layout");
  for (const mod of chain) {
    const Layout = (await import(mod)).default as any;
    tree = await Layout({ children: tree, params: Promise.resolve(params) });
  }
  const Root = (await import("@/app/layout")).default as any;
  tree = Root({ children: tree });

  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  const reader = stream.getReader(); const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done: d, value } = await reader.read(); if (d) break; out += dec.decode(value); }

  // The title lives in metadata, which Next resolves outside the component tree, so it is asked for
  // the same way Next asks: generateMetadata if the page has one, else its static metadata, else
  // the nearest layout's.
  const mod = await import(p.mod);
  let title: string | null = null;
  if (typeof mod.generateMetadata === "function") {
    title = (await mod.generateMetadata(args))?.title ?? null;
  } else if (mod.metadata?.title) {
    title = mod.metadata.title;
  }
  return { html: out, title };
}

async function axeRun(html: string) {
  const { JSDOM } = await import("jsdom");
  const axe = (await import("axe-core")).default ?? (await import("axe-core"));
  const body = html.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "");
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`,
    { pretendToBeVisual: true });
  const g: any = globalThis as any;
  const saved = { window: g.window, document: g.document, Node: g.Node, Element: g.Element };
  g.window = dom.window; g.document = dom.window.document;
  g.Node = dom.window.Node; g.Element = dom.window.Element;
  try {
    const r = await (axe as any).run(dom.window.document.body, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } },   // jsdom paints nothing to measure
    });
    return (r.violations as any[]).map((v) => ({
      id: v.id, impact: v.impact as string, count: v.nodes.length,
      help: v.help as string, example: String(v.nodes[0]?.html ?? "").slice(0, 120),
    }));
  } finally {
    g.window = saved.window; g.document = saved.document; g.Node = saved.Node; g.Element = saved.Element;
    dom.window.close();
  }
}

// ------------------------------------------------------------------------------------- the checks

type Rendered = { p: Page; html: string; title: string | null; axe: Awaited<ReturnType<typeof axeRun>> };
const all: Rendered[] = [];

console.log(`\nrendering ${PAGES.length} pages (${REDIRECTS.length} more are redirects and render nothing)`);
for (const p of PAGES) {
  let r: { html: string; title: string | null };
  try {
    r = await render(p);
  } catch (e) {
    throw new Error(`${p.route} did not render: ${(e as Error).message}`);
  }
  assert.ok(r.html.length > 300, `${p.route}: suspiciously short, ${r.html.length} chars`);
  assert.ok(!r.html.includes("[object Object]"), `${p.route}: an object was rendered into the page`);
  all.push({ p, html: r.html, title: r.title, axe: await axeRun(r.html) });
}

await t("no page has a serious or critical accessibility violation", () => {
  const bad: string[] = [];
  const lesser = new Map<string, number>();
  for (const { p, axe } of all) {
    for (const v of axe) {
      if (v.impact === "serious" || v.impact === "critical") {
        bad.push(`${p.route}  ${v.id} (${v.impact}) x${v.count}: ${v.help}\n          e.g. ${v.example}`);
      } else {
        lesser.set(`${v.id} (${v.impact})`, (lesser.get(`${v.id} (${v.impact})`) ?? 0) + v.count);
      }
    }
  }
  const quiet = all.filter((r) => r.axe.length === 0).length;
  console.log(`      ${quiet}/${all.length} pages with no finding at all`);
  console.log(`      moderate and minor, over every page: ${[...lesser].map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`);
  assert.deepEqual(bad, [], `\n      ${bad.join("\n      ")}`);
});

await t("the skip link is on every page and lands on that page's main landmark", () => {
  for (const { p, html } of all) {
    assert.ok(html.includes('class="skip-link" href="#main"'), `${p.route}: no skip link`);
    const mains = html.split('<main').length - 1;
    assert.equal(mains, 1, `${p.route}: ${mains} main elements`);
    assert.ok(/<main[^>]*id="main"/.test(html), `${p.route}: the main landmark has no id to skip to`);
    // and the skip link comes first, so a keyboard reaches it before anything else
    assert.ok(html.indexOf("skip-link") < html.indexOf("<main"), `${p.route}: the skip link is not first`);
  }
});

await t("every page has exactly one h1, and the document declares its language", () => {
  for (const { p, html } of all) {
    const h1 = html.split("<h1").length - 1;
    assert.equal(h1, 1, `${p.route}: ${h1} h1 elements`);
    assert.ok(/<html[^>]*lang="en"/.test(html), `${p.route}: no lang on <html>`);
  }
});

await t("no page skips a heading level", () => {
  const broken: string[] = [];
  for (const { p, html } of all) {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        broken.push(`${p.route}: h${levels[i - 1]} -> h${levels[i]}  (${levels.join("")})`);
        break;
      }
    }
  }
  assert.deepEqual(broken, [], `\n      ${broken.join("\n      ")}`);
});

await t("the title says where you are, in the shape the spec asked for", () => {
  // The root layout's template adds " — Flexee", so what a page returns is everything before it.
  const wrong: string[] = [];
  for (const { p, title } of all) {
    if (!title) { wrong.push(`${p.route}: no title`); continue; }
    if (p.titled === "class" && !title.endsWith(" — Spring Section A")) {
      wrong.push(`${p.route}: "${title}" does not end with the class's name`);
    }
    if (p.titled === "book" && !title.includes("Analysis and Design of Information Systems")) {
      wrong.push(`${p.route}: "${title}" does not name the book`);
    }
    // never a course code, on any of them
    if (/MIS ?\d{4}/.test(title)) wrong.push(`${p.route}: "${title}" names a course code`);
  }
  assert.deepEqual(wrong, [], `\n      ${wrong.join("\n      ")}`);
  const shown = all.filter((r) => r.p.titled !== "plain").slice(0, 3)
    .map((r) => `"${r.title} — Flexee"`).join(", ");
  console.log(`      for example: ${shown}`);
});

/**
 * Read the page as a browser would, rather than as a string.
 *
 * React 19 emits `autoComplete` with its JSX spelling instead of folding it to `autocomplete`.
 * HTML attribute names are case-insensitive, so a browser and a password manager both read it
 * correctly — but a substring search on the markup does not. Parsing is the honest check, and it
 * is what the browser run would see.
 */
async function parse(html: string) {
  const { JSDOM } = await import("jsdom");
  return new JSDOM(html).window.document;
}

await t("the password forms tell a password manager what each box is", async () => {
  const want: [string, string[]][] = [
    ["/login", ["username", "current-password"]],
    ["/signup", ["name", "username", "new-password"]],
    ["/set-password", ["new-password"]],
    ["/reset", ["new-password"]],
    ["/forgot", ["username"]],
    // /account changes an email address and nothing else; there is no password box on it.
    ["/account", ["email"]],
  ];
  for (const [route, values] of want) {
    const doc = await parse(all.find((x) => x.p.route === route)!.html);
    const got = [...doc.querySelectorAll("input[autocomplete]")]
      .map((el) => el.getAttribute("autocomplete"));
    for (const v of values) assert.ok(got.includes(v), `${route}: no autocomplete="${v}", got ${got.join(", ") || "none"}`);
    // and every password box says which kind it is, so a manager never offers the wrong one
    for (const el of doc.querySelectorAll('input[type="password"]')) {
      const a = el.getAttribute("autocomplete");
      assert.ok(a === "current-password" || a === "new-password", `${route}: a password box says "${a}"`);
    }
  }
});

await t("an error on a form is tied to the field it is about, and announced", async () => {
  const doc = await parse(all.find((x) => x.p.route === "/login?error=bad")!.html);
  const alert = doc.querySelector('[role="alert"]');
  assert.ok(alert, "the error is not announced");
  assert.equal(alert!.textContent, "Those details did not match.");
  const id = alert!.getAttribute("id");
  assert.ok(id, "the error has no id to point at");
  const pointing = [...doc.querySelectorAll(`[aria-describedby="${id}"]`)];
  assert.equal(pointing.length, 2, `${pointing.length} fields point at the error, expected both`);
  // and with no error there is nothing dangling to describe
  const clean = await parse(all.find((x) => x.p.route === "/login")!.html);
  assert.equal(clean.querySelectorAll("[aria-describedby]").length, 0,
    "a field points at an error message that is not on the page");
});

await t("every label on every page is tied to a control", async () => {
  // A <label> with neither a control inside it nor a `for` is a label for nothing: it looks like
  // one on screen and is silence to a screen reader. axe has no rule for it.
  const orphans: string[] = [];
  for (const { p, html } of all) {
    const doc = await parse(html);
    for (const el of doc.querySelectorAll("label")) {
      const has = el.hasAttribute("for")
        || el.querySelector("input, select, textarea") != null;
      if (!has) orphans.push(`${p.route}: <label>${(el.textContent ?? "").trim().slice(0, 40)}</label>`);
    }
  }
  assert.deepEqual(orphans, [], `\n      ${orphans.join("\n      ")}`);
});

await t("every control on every page has a name, and none of them gets it from a title alone", () => {
  // axe's label, select-name and label-title-only rules are what catch this, so this check is a
  // restatement of those three over the set — kept separate so a failure says "a control" rather
  // than naming an axe rule, and so the count is visible when it is zero.
  const faults: string[] = [];
  for (const { p, axe } of all) {
    for (const v of axe) {
      if (["label", "select-name", "label-title-only", "form-field-multiple-labels", "aria-input-field-name"].includes(v.id)) {
        faults.push(`${p.route}  ${v.id} x${v.count}: ${v.example}`);
      }
    }
  }
  assert.deepEqual(faults, [], `\n      ${faults.join("\n      ")}`);
});

await t("a table header cell always names its column, visibly or not", async () => {
  // Eight actions columns across seven pages had a bare <th></th>. Decision 5: they get
  // visually-hidden text rather than being changed to a td, because they really are the header of
  // a column. A cell that names its column through a labelled control inside it — the roster's
  // select-all checkbox — is named too, which is why this reads the computed name rather than the
  // text. The spacer cells in the gradebook's weights row were headers of nothing and are td now.
  const empty: string[] = [];
  for (const { p, html } of all) {
    const doc = await parse(html);
    for (const th of doc.querySelectorAll("th")) {
      const named = (th.textContent ?? "").trim().length > 0
        || !!th.getAttribute("aria-label")
        || [...th.querySelectorAll("input, select, textarea, button")]
             .some((c) => c.getAttribute("aria-label") || c.closest("label"));
      if (!named) empty.push(`${p.route}: ${th.outerHTML.slice(0, 80)}`);
    }
  }
  assert.deepEqual(empty, [], `\n      ${empty.join("\n      ")}`);
  const hidden = all.filter((r) => r.html.includes('class="visually-hidden"')).length;
  console.log(`      ${hidden} pages name a column with visually-hidden text`);
});

console.log(`\n${passed} checks passed over ${all.length} rendered pages`);
