/**
 * Spec 21 rule 6, decision 1: the real-browser accessibility run. Opt-in, local, never in CI.
 *
 *   npm run a11y:browser -- --yes
 *
 * jsdom paints nothing and lays nothing out, so test:a11y-pages cannot judge colour contrast as
 * composited, whether a focus ring is actually visible, how big a target is, whether a dialog's
 * focus trap holds, or whether prefers-reduced-motion is honoured. A real browser can. What it
 * needs that the other suites do not is a real Postgres, because the app talks to it through
 * postgres-js and `next start` cannot be served by PGlite.
 *
 * That database is the reason for the two guards. They are not advice:
 *
 *   1. It runs against A11Y_DATABASE_URL, which must be set and must not be DATABASE_URL. It
 *      prints the host it is about to write to, and does nothing without --yes.
 *   2. It refuses to run if that database holds any account it did not create itself. This is what
 *      stops a branch of the live database being used by mistake: a branch copies every real
 *      account, so the count is never zero and the run stops before it writes anything.
 *
 * docs/changes/21_Accessibility_Minimum.md says how to create the empty database, and says plainly
 * that this script has not yet been executed — there is no Postgres on the machine it was written
 * on. Its guards are tested by npm run test:a11y-guards, which is the part that must be right
 * before anyone points it at anything.
 */
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

// --------------------------------------------------------------- the guards, as pure functions

/** Everything this script creates is named so it can be told apart from anything it did not. */
export const MARK = "a11y-browser";
export const MARK_EMAIL_DOMAIN = "@a11y-browser.invalid";

/** The host of a connection string, with any credentials removed, for printing. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unreadable connection string)";
  }
}

export type Refusal = { ok: false; why: string } | { ok: true };

/**
 * Guard 1, decided before anything connects: a separate database, named explicitly, with --yes.
 *
 * Refusing when A11Y_DATABASE_URL equals DATABASE_URL is the cheap half. The expensive half — that
 * it is not a *branch* of the live database — cannot be read off a connection string, and is what
 * guard 2 catches by looking at what is in it.
 */
export function checkTarget(env: Record<string, string | undefined>, argv: string[]): Refusal {
  const target = env.A11Y_DATABASE_URL;
  if (!target) {
    return { ok: false, why:
      "A11Y_DATABASE_URL is not set. This run writes to the database it is given, so it will not " +
      "guess one. Point it at an empty database of its own — docs/changes/21_Accessibility_Minimum.md " +
      "says how to create one — and never at the live database or a branch of it." };
  }
  if (env.DATABASE_URL && target.trim() === env.DATABASE_URL.trim()) {
    return { ok: false, why:
      "A11Y_DATABASE_URL is the same as DATABASE_URL. The run needs a database of its own; it " +
      "creates accounts and classes and leaves them behind." };
  }
  if (!/^postgres(ql)?:\/\//.test(target.trim())) {
    return { ok: false, why: "A11Y_DATABASE_URL is not a postgres:// connection string." };
  }
  if (!argv.includes("--yes")) {
    return { ok: false, why:
      `This will create accounts and classes in ${hostOf(target)}. Re-run with --yes to go ahead.` };
  }
  return { ok: true };
}

/**
 * Guard 2, after connecting and before writing: nothing in here belongs to anybody.
 *
 * Counted, never listed: the point of the guard is to stop, and printing a name or an address from
 * a database that turned out to be the live one would be the very thing it exists to prevent.
 */
export function checkEmpty(accounts: { displayName: string | null; email: string | null }[]): Refusal {
  const foreign = accounts.filter((a) =>
    !(a.displayName ?? "").startsWith(MARK) && !(a.email ?? "").endsWith(MARK_EMAIL_DOMAIN));
  if (foreign.length) {
    return { ok: false, why:
      `That database holds ${foreign.length} account(s) this script did not create, so it is not ` +
      "the empty database this run needs. If you pointed it at a branch of the live database, that " +
      "is why: a branch copies every real account. Nothing was written, and no names are printed." };
  }
  return { ok: true };
}

// ------------------------------------------------------------------------------ what it measures

/**
 * The checks a real browser can make and jsdom cannot, run inside the page.
 *
 * Target size against the painted box; visible focus by focusing each control and seeing whether
 * anything about it actually changed; and, with the preference set, that nothing is still moving.
 * Contrast is left to axe, which composites it properly.
 */
export const IN_PAGE_CHECKS = String.raw`(() => {
  const out = { unfocusable: [], small: [], invisibleFocus: [], motion: [] };
  const px = (v) => parseFloat(v) || 0;
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');

  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary, label')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;                 // hidden, or the skip link at rest
    const s = getComputedStyle(el);
    if (s.display === 'contents' || s.visibility === 'hidden') continue;
    if (el.type === 'hidden') continue;
    // An inline link inside a sentence is exempt from 2.5.5; a control is not. A label that only
    // wraps a control is measured through the control itself.
    if (el.tagName === 'A' && s.display.startsWith('inline') && el.closest('p, li, figcaption')) continue;
    if (el.tagName === 'LABEL' && !el.querySelector('input[type=checkbox], input[type=radio]')) continue;
    if (r.width < 44 || r.height < 44) {
      out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }

  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary')) {
    if (el.type === 'hidden' || el.disabled) continue;
    const b = getComputedStyle(el);
    const was = [b.outlineStyle, b.outlineWidth, b.outlineColor, b.boxShadow,
                 b.backgroundColor, b.borderColor].join('|');
    try { el.focus({ preventScroll: true }); } catch (e) { continue; }
    if (document.activeElement !== el) { out.unfocusable.push(name(el)); continue; }
    const a = getComputedStyle(el);
    const now = [a.outlineStyle, a.outlineWidth, a.outlineColor, a.boxShadow,
                 a.backgroundColor, a.borderColor].join('|');
    const ring = a.outlineStyle !== 'none' && px(a.outlineWidth) >= 2;
    if (!ring && now === was) {
      out.invisibleFocus.push(name(el) + ' "' +
        (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '"');
    }
  }
  try { if (document.activeElement) document.activeElement.blur(); } catch (e) {}

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (px(s.animationDuration) > 0.01 || px(s.transitionDuration) > 0.01) {
        out.motion.push(name(el));
        if (out.motion.length > 5) break;
      }
    }
  }
  return out;
})()`;

/** Where it goes. Each entry says whether it needs a session, and which one. */
export const ROUTES: { path: string; as: "none" | "student" | "faculty" }[] = [
  { path: "/login", as: "none" },
  { path: "/signup", as: "none" },
  { path: "/forgot", as: "none" },
  { path: "/student", as: "student" },
  { path: "/sad", as: "student" },
  { path: "/sad/ch01", as: "student" },
  { path: "/sad/grades", as: "student" },
  { path: "/faculty", as: "faculty" },
  { path: "/teach/SECTION", as: "faculty" },
  { path: "/teach/SECTION/gradebook", as: "faculty" },   // Spec 23's import panel lives here
];

// -------------------------------------------------------------------------------------- the run

/** Run a child process to completion against the target database, or throw. */
async function once(cmd: string, args: string[], databaseUrl: string) {
  await new Promise<void>((res, rej) => {
    const c = spawn(cmd, args, { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" });
    c.once("error", rej);
    c.once("exit", (code) => code === 0 ? res() : rej(new Error(`${args.join(" ")} exited with ${code}`)));
  });
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}

async function waitFor(url: string, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the app did not answer on ${url} within ${seconds}s`);
}

async function main() {
  const gate = checkTarget(process.env as Record<string, string | undefined>, process.argv.slice(2));
  if (!gate.ok) { console.error(`\nRefusing to run.\n\n  ${gate.why}\n`); process.exit(2); }

  const target = process.env.A11Y_DATABASE_URL!.trim();
  console.log(`\nDatabase: ${hostOf(target)}`);

  // Loaded by name at runtime and typed loosely, because playwright is not a dependency of this
  // project and so has no types installed here. A handful of its methods are used.
  type Page = {
    goto(url: string, o?: unknown): Promise<unknown>;
    addScriptTag(o: { content: string }): Promise<unknown>;
    evaluate(js: string): Promise<unknown>;
    locator(sel: string): { first(): { count(): Promise<number> } };
    keyboard: { press(key: string): Promise<void> };
    close(): Promise<void>;
  };
  type Context = {
    newPage(): Promise<Page>;
    addCookies(c: { name: string; value: string; url: string }[]): Promise<void>;
  };
  type Chromium = { launch(): Promise<{ newContext(o: unknown): Promise<Context>; close(): Promise<void> }> };
  let chromium: Chromium;
  try {
    ({ chromium } = (await import("playwright" as string)) as { chromium: Chromium });
  } catch {
    console.error(
      "\nPlaywright is not installed. It is deliberately not a dependency of this project: it is a\n" +
      "large download, only this one opt-in script needs it, and Vercel installs devDependencies\n" +
      "to build. Install it just for the run:\n\n" +
      "  npm install --no-save playwright\n" +
      "  npx playwright install chromium\n");
    process.exit(2);
  }

  // Everything below talks to the target, including the app this starts.
  process.env.DATABASE_URL = target;
  const { eq } = await import("drizzle-orm");
  const { db, schema } = await import("@/db");
  const { users, identities, sessions, enrolments, sections } = schema;

  // The same migrator Vercel's build runs, so an empty database becomes a current one.
  await once(process.execPath, ["--experimental-strip-types", "scripts/migrate.ts"], target);

  const accounts = await db()
    .select({ displayName: users.displayName, email: identities.subject })
    .from(users)
    .leftJoin(identities, eq(identities.userId, users.id));
  const empty = checkEmpty(accounts);
  if (!empty.ok) { console.error(`\nRefusing to run.\n\n  ${empty.why}\n`); process.exit(2); }
  console.log(`Guard 2: ${accounts.length} account(s), none of them anybody's but this script's.`);

  // --- a world of its own, marked so guard 2 can recognise it next time
  const { setAdminByEmail } = await import("@/lib/admin");
  const { createSection } = await import("@/lib/roster");
  const make = async (role: string) => {
    const [u] = await db().insert(users).values({ displayName: `${MARK} ${role}` }).returning();
    await db().insert(identities)
      .values({ userId: u.id, provider: "password", subject: `${MARK}-${role}${MARK_EMAIL_DOMAIN}`, passwordHash: "x" });
    const [s] = await db().insert(sessions)
      .values({ id: randomBytes(32).toString("hex"), userId: u.id, expiresAt: new Date(Date.now() + 864e5) })
      .returning();
    return { id: u.id, session: s.id };
  };
  const admin = await make("admin");
  await setAdminByEmail(`${MARK}-admin${MARK_EMAIL_DOMAIN}`);
  const faculty = await make("faculty");
  const student = await make("student");
  const sec = await createSection(faculty.id, "sad", `${MARK} class`, "2027 Spring", { teach: true });
  await db().insert(enrolments).values({ sectionId: sec.id, userId: student.id, role: "student" });
  await db().update(sections).set({ bookPublishedAt: new Date() }).where(eq(sections.id, sec.id));
  void admin;

  // --- the app, against that database
  const port = await freePort();
  const base = `http://localhost:${port}`;
  console.log(`Starting the app on ${base} …`);
  const app = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env, DATABASE_URL: target },
    stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
  });
  const stop = () => { try { app.kill(); } catch { /* already gone */ } };
  process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(130); });

  let failures = 0;
  try {
    await waitFor(`${base}/login`);

    const axeSource = (await import("node:fs")).readFileSync(
      (await import("node:path")).join("node_modules", "axe-core", "axe.min.js"), "utf8");

    for (const scheme of ["light", "dark"] as const) {
      for (const motion of ["no-preference", "reduce"] as const) {
        const browser = await chromium.launch();
        const ctx = await browser.newContext({
          colorScheme: scheme, reducedMotion: motion, viewport: { width: 1280, height: 900 },
        });
        console.log(`\n--- ${scheme} mode, prefers-reduced-motion: ${motion}`);
        for (const r of ROUTES) {
          const path = r.path.replace("SECTION", sec.id);
          const page = await ctx.newPage();
          if (r.as !== "none") {
            const id = r.as === "faculty" ? faculty.session : student.session;
            await ctx.addCookies([{ name: "fx_session", value: id, url: base }]);
          }
          await page.goto(`${base}${path}`, { waitUntil: "networkidle" });

          await page.addScriptTag({ content: axeSource });
          const results = await page.evaluate(
            "axe.run(document, { resultTypes: ['violations'] })") as {
              violations: { id: string; impact: string; nodes: unknown[]; help: string }[] };
          const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          const checks = await page.evaluate(IN_PAGE_CHECKS) as {
            unfocusable: string[]; small: string[]; invisibleFocus: string[]; motion: string[] };

          const problems = [
            ...bad.map((v) => `axe ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`),
            ...checks.invisibleFocus.map((s) => `no visible focus: ${s}`),
            ...checks.small.map((s) => `target under 44px: ${s}`),
            ...checks.unfocusable.map((s) => `cannot take focus: ${s}`),
            ...checks.motion.map((s) => `still animating with reduced motion: ${s}`),
          ];
          failures += problems.length;
          console.log(`  ${problems.length ? "✗" : "✓"} ${path}` +
            (problems.length ? `\n      ${problems.join("\n      ")}` : ""));
          await page.close();
        }

        // The focus trap, by keyboard, on the dialog Spec 19 added to the class list.
        const page = await ctx.newPage();
        await ctx.addCookies([{ name: "fx_session", value: faculty.session, url: base }]);
        await page.goto(`${base}/teach/${sec.id}`, { waitUntil: "networkidle" });
        const dialog = page.locator("dialog").first();
        if (await dialog.count()) {
          await page.evaluate("document.querySelector('dialog').showModal()");
          const seen = new Set<string>();
          for (let i = 0; i < 25; i++) {
            await page.keyboard.press("Tab");
            seen.add(await page.evaluate(
              "document.activeElement.closest('dialog') ? 'in' : 'out'") as string);
          }
          const held = !seen.has("out");
          failures += held ? 0 : 1;
          console.log(`  ${held ? "✓" : "✗"} focus stays inside the dialog over 25 tabs`);
          await page.keyboard.press("Escape");
          const closed = await page.evaluate("!document.querySelector('dialog').open") as boolean;
          failures += closed ? 0 : 1;
          console.log(`  ${closed ? "✓" : "✗"} Escape closes the dialog`);
        } else {
          console.log("  ? no dialog on the class list to test — check the page by hand");
        }
        await page.close();
        await browser.close();
      }
    }
  } finally {
    stop();
  }

  console.log(failures
    ? `\n${failures} problem(s). The jsdom suites cannot see these, which is why this run exists.\n`
    : "\nNo problems a real browser can see that jsdom cannot.\n");
  process.exit(failures ? 1 : 0);
}

// Imported by the guard suite; run only when it is the program.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/a11y-browser.ts")) await main();
