"use server";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { users, identities } from "@/db/schema";
import { hashPassword, verifyPassword, createSession, destroySession, currentUser } from "@/lib/auth";
import { enrolmentForBook, userClasses } from "@/lib/enrolment";
import { ownedSection, regenerateJoinCode, enrollByCode, claimInvites } from "@/lib/roster";
import { landingPortal } from "@/lib/portal";

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const safeNext = (v: FormDataEntryValue | null) => {
  const path = clean(v);
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/";
};

async function signInDestination(userId: string, role: string, requested: string) {
  if (requested !== "/") return requested;
  if (role === "admin") return "/admin";
  const classes = await userClasses(userId);
  return `/${landingPortal(role, classes.some((c) => c.role === "instructor"))}`;
}

export async function signup(formData: FormData) {
  const name = clean(formData.get("name"));
  const email = clean(formData.get("email")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!name || !email || password.length < 8)
    redirect(`/signup?error=${encodeURIComponent("Name, email, and an 8+ character password are required.")}`);
  // Spec 17: an address that already has an account is no longer a dead end. The import creates
  // accounts with no usable password, so this is the most likely thing an imported student does
  // first; being told the account exists, with nowhere to go, would strand them.
  const existing = await db().select({ id: identities.id, userId: identities.userId, hash: identities.passwordHash })
    .from(identities)
    .where(and(eq(identities.provider, "password"), eq(identities.subject, email))).limit(1);
  if (existing[0]) {
    if (existing[0].hash == null) {
      const { sendSetPasswordInvite } = await import("@/lib/recovery");
      const { firstStudentSection } = await import("@/lib/enrolment");
      try {
        await sendSetPasswordInvite(existing[0].userId, await firstStudentSection(existing[0].userId), email, await baseUrl());
      } catch {}
      // Neutral either way: the same words whether or not the send succeeded, and whether or not
      // the person who typed this address is the person who owns it.
      redirect(`/signup?sent=${encodeURIComponent("Check your email for a link to finish setting up your account.")}`);
    }
    redirect(`/signup?exists=1&error=${encodeURIComponent("An account with that email already exists.")}`);
  }
  const [user] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: user.id, provider: "password", subject: email, passwordHash: await hashPassword(password) });
  await createSession(user.id);
  await claimInvites(user.id, email); // roster invites -> enrolments
  try {
    const { sendVerification } = await import("@/lib/recovery");
    const { headers } = await import("next/headers"); const h = await headers();
    await sendVerification(user.id, email, `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  } catch {}
  redirect(await signInDestination(user.id, user.systemRole, next));
}

export async function login(formData: FormData) {
  const email = clean(formData.get("email")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const { rateLimit } = await import("@/lib/recovery");
  if (!(await rateLimit(`login:${email}`, 8, 900)))
    redirect(`/login?error=${encodeURIComponent("Too many attempts — wait a few minutes.")}&next=${encodeURIComponent(next)}`);
  const row = (await db().select({ userId: identities.userId, hash: identities.passwordHash, systemRole: users.systemRole }).from(identities)
    .innerJoin(users, eq(users.id, identities.userId))
    .where(and(eq(identities.provider, "password"), eq(identities.subject, email))).limit(1))[0];
  if (!row?.hash || !(await verifyPassword(password, row.hash)))
    redirect(`/login?error=${encodeURIComponent("Wrong email or password.")}&next=${encodeURIComponent(next)}`);
  await createSession(row.userId);
  await claimInvites(row.userId, email);
  redirect(await signInDestination(row.userId, row.systemRole, next));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// Self-enrolment into a book is retired: students join a class with its code, or an admin adds them.
export async function enroll(_formData: FormData) {
  redirect(`/?error=${encodeURIComponent("Join your class with the code your instructor gave you.")}`);
}

export async function enrollByCodeAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const c = clean(formData.get("code"));
  const sec = await enrollByCode(user!.id, c);
  redirect(sec ? "/student?joined=1" : `/student?error=${encodeURIComponent("No class found for that code.")}`);
}

export async function regenerateCodeAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  await regenerateJoinCode(sectionId);
  redirect(`/teach/${sectionId}`);
}

/**
 * Spec 19: removing a student goes through POST /api/class/remove, which counts what would be
 * deleted and requires a typed phrase when any attempt, submission or score exists. This action
 * remains only so an old form post cannot quietly delete a student's work; it does nothing.
 */
export async function removeStudentAction(formData: FormData) {
  const sectionId = clean(formData.get("sectionId"));
  redirect(`/teach/${sectionId}?error=${encodeURIComponent("Use the Remove button on the class list — it shows what would be deleted first.")}#roster`);
}

export async function publishToSectionAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const entryId = clean(formData.get("entryId"));
  const versionId = clean(formData.get("versionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { publishToSection } = await import("@/lib/versions");
  await publishToSection(sectionId, entryId, versionId);
  redirect(`/teach/${sectionId}/content`);
}

export async function createExamAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { createExam } = await import("@/lib/assessment");
  const blueprint = { mode: "draw" as const, rules: [{
    chapter: Number(formData.get("chapter")) || 1,
    difficulty: clean(formData.get("difficulty")) || "any",
    count: Math.max(1, Number(formData.get("count")) || 5),
  }] };
  const kindRaw = clean(formData.get("kind"));
  await createExam(sectionId, {
    title: clean(formData.get("title")) || "Untitled exam",
    blueprint, feedback: clean(formData.get("feedback")) || "after_close",
    timeLimitMin: null, attemptLimit: Math.max(1, Number(formData.get("attemptLimit")) || 1),
    // Spec 11: a quiz defaults to the highest attempt counting, an exam to the first
    kind: kindRaw === "quiz" ? "quiz" : "exam",
  });
  redirect(`/teach/${sectionId}/exams`);
}

export async function examStatusAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const examId = clean(formData.get("examId"));
  const status = clean(formData.get("status")) as "draft" | "open" | "closed";
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { examById, setExamStatus } = await import("@/lib/assessment");
  const exam = await examById(examId);
  if (!exam || exam.sectionId !== sectionId) redirect(`/teach/${sectionId}/exams`);
  await setExamStatus(examId, status);
  redirect(`/teach/${sectionId}/exams`);
}

export async function startExamAction(formData: FormData) {
  const user = await currentUser();
  const bookId = clean(formData.get("bookId"));
  const examId = clean(formData.get("examId"));
  if (!user) redirect(`/login?next=${encodeURIComponent(`/${bookId}/exams`)}`);
  const enr = await enrolmentForBook(user!.id, bookId);
  if (!enr) redirect(`/?need=${bookId}`);
  const { examById, startAttempt } = await import("@/lib/assessment");
  const exam = await examById(examId);
  if (!exam || exam.sectionId !== enr.sectionId) redirect(`/${bookId}/exams`);
  const attempt = await startAttempt(examId, enr.id);
  redirect(`/${bookId}/exams/take/${attempt.id}`);
}

export async function submitExamAction(formData: FormData) {
  const user = await currentUser();
  const bookId = clean(formData.get("bookId"));
  const attemptId = clean(formData.get("attemptId"));
  if (!user) redirect("/login");
  const enr = await enrolmentForBook(user!.id, bookId);
  const { attemptEnrolmentId, submitAttempt } = await import("@/lib/assessment");
  if (!enr || (await attemptEnrolmentId(attemptId)) !== enr.id) redirect(`/${bookId}/exams`);
  const answers: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("q_")) answers[k.slice(2)] = String(v);
  await submitAttempt(attemptId, answers);
  redirect(`/${bookId}/exams/result/${attemptId}`);
}

export async function addOutcomeAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { addOutcome } = await import("@/lib/mastery");
  const code = clean(formData.get("code")), description = clean(formData.get("description"));
  if (code && description) await addOutcome(sectionId, code, description);
  redirect(`/teach/${sectionId}/syllabus`);
}

export async function mapOutcomeAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { mapOutcome } = await import("@/lib/mastery");
  const outcomeId = clean(formData.get("outcomeId")), objectiveId = clean(formData.get("objectiveId"));
  if (outcomeId && objectiveId) await mapOutcome(outcomeId, objectiveId);
  redirect(`/teach/${sectionId}/syllabus`);
}

export async function setWeightsAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setWeight } = await import("@/lib/gradebook");
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("weight_")) { const w = Number(v); if (!Number.isNaN(w) && w >= 0) await setWeight(sectionId, k.slice(7), w); }
  }
  redirect(`/teach/${sectionId}/gradebook`);
}

export async function addLineItemAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { addManualItem } = await import("@/lib/gradebook");
  const title = clean(formData.get("title")); const maxPoints = Math.max(1, Number(formData.get("maxPoints")) || 100); const weight = Math.max(0, Number(formData.get("weight")) || 1);
  if (title) await addManualItem(sectionId, title, maxPoints, weight);
  redirect(`/teach/${sectionId}/gradebook`);
}

// --- Spec 11: grading setup (categories, letter scale, retake rules) ---

const gradingBack = (sectionId: string, msg?: { ok?: string; error?: string }) => {
  const q = msg?.error ? `?grading_error=${encodeURIComponent(msg.error)}` : msg?.ok ? `?grading_ok=${encodeURIComponent(msg.ok)}` : "";
  return `/teach/${sectionId}/gradebook${q}#grading-setup`;
};

export async function setCategoriesAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setCategories } = await import("@/lib/gradebook");
  // rows arrive as cat_name_<i> / cat_weight_<i> / cat_drop_<i> / cat_id_<i>
  const idx = [...new Set([...formData.keys()].filter((k) => k.startsWith("cat_name_")).map((k) => k.slice(9)))];
  const rows = idx.map((i) => ({
    id: clean(formData.get(`cat_id_${i}`)) || undefined,
    name: clean(formData.get(`cat_name_${i}`)),
    weight: Number(formData.get(`cat_weight_${i}`)) || 0,
    dropLowest: Math.max(0, Number(formData.get(`cat_drop_${i}`)) || 0),
  }));
  try { await setCategories(sectionId, rows); } catch (e: any) { redirect(gradingBack(sectionId, { error: e?.message ?? "Could not save the categories." })); }
  redirect(gradingBack(sectionId, { ok: "Grading categories saved." }));
}

export async function applyStarterCategoriesAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { applyStarterCategories } = await import("@/lib/gradebook");
  await applyStarterCategories(sectionId);
  redirect(gradingBack(sectionId, { ok: "Starter categories added — edit the weights to match your syllabus." }));
}

export async function setColumnCategoryAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setColumnCategory } = await import("@/lib/gradebook");
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("column_cat_")) continue;
    const categoryId = clean(v) || null;
    try { await setColumnCategory(sectionId, k.slice(11), categoryId); }
    catch (e: any) { redirect(gradingBack(sectionId, { error: e?.message ?? "Could not move that column." })); }
  }
  redirect(gradingBack(sectionId, { ok: "Columns assigned." }));
}

export async function setLetterBandsAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setLetterBands } = await import("@/lib/gradebook");
  const { PLUS_MINUS_LETTER_BANDS } = await import("@/lib/grading");
  if (clean(formData.get("preset")) === "plusminus") {
    await setLetterBands(sectionId, PLUS_MINUS_LETTER_BANDS);
    redirect(gradingBack(sectionId, { ok: "Added +/- bands." }));
  }
  const idx = [...new Set([...formData.keys()].filter((k) => k.startsWith("band_letter_")).map((k) => k.slice(12)))];
  const bands = idx.map((i) => ({ letter: clean(formData.get(`band_letter_${i}`)), min: Number(formData.get(`band_min_${i}`)) || 0 }));
  try { await setLetterBands(sectionId, bands); } catch (e: any) { redirect(gradingBack(sectionId, { error: e?.message ?? "Could not save the letter scale." })); }
  redirect(gradingBack(sectionId, { ok: "Letter scale saved." }));
}

export async function setExamRulesAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const examId = clean(formData.get("examId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setExamRetakeRules } = await import("@/lib/assessment");
  const kindRaw = clean(formData.get("kind"));
  try {
    await setExamRetakeRules(sectionId, examId, {
      attemptLimit: formData.get("attemptLimit") != null ? Number(formData.get("attemptLimit")) : undefined,
      countedAttempt: (clean(formData.get("countedAttempt")) || undefined) as any,
      kind: kindRaw === "quiz" || kindRaw === "exam" ? kindRaw : undefined,
    });
  } catch (e: any) {
    redirect(`/teach/${sectionId}/exams/${examId}?error=${encodeURIComponent(e?.message ?? "Could not save.")}`);
  }
  redirect(`/teach/${sectionId}/exams/${examId}?ok=${encodeURIComponent("Retake rules saved.")}`);
}

export async function setScoreAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const { canGradeSection } = await import("@/lib/roster");
  if (!user || !(await canGradeSection(user.id, sectionId))) redirect("/teach");
  const { setScore, listLineItems, handEntryRefusal, ScoreRefused } = await import("@/lib/gradebook");
  const lineItemId = clean(formData.get("lineItemId")); const enrolmentId = clean(formData.get("enrolmentId"));
  const raw = clean(formData.get("points"));
  const back = `/teach/${sectionId}/gradebook`;
  const refuse = (why: string) => redirect(`${back}?score_error=${encodeURIComponent(why)}#grades`);

  if (!lineItemId || !enrolmentId || raw === "") redirect(back);

  // Spec 23: the column has to be one of this class's, and one that accepts a typed score. The
  // page does not offer an input for the others, but a posted form is not the page.
  const item = (await listLineItems(sectionId)).find((i) => i.id === lineItemId);
  if (!item) redirect(back);
  const no = handEntryRefusal(item);
  if (no) refuse(no);

  // "abc" used to reach the database as NaN and turn the student's whole course total into NaN.
  const value = Number(raw);
  if (!Number.isFinite(value)) refuse(`"${raw.slice(0, 20)}" is not a number.`);
  try {
    await setScore(lineItemId, enrolmentId, value);
  } catch (e) {
    if (e instanceof ScoreRefused) refuse(e.message);
    throw e;
  }
  redirect(back);
}

async function baseUrl() {
  const { headers } = await import("next/headers"); const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function forgotAction(formData: FormData) {
  const email = clean(formData.get("email")).toLowerCase();
  const { rateLimit, requestPasswordReset } = await import("@/lib/recovery");
  if (email && await rateLimit(`forgot:${email}`, 5, 900)) await requestPasswordReset(email, await baseUrl());
  redirect("/forgot?sent=1"); // always the same response (no account enumeration)
}

export async function resetAction(formData: FormData) {
  const token = clean(formData.get("token")); const password = String(formData.get("password") ?? "");
  const { resetPassword } = await import("@/lib/recovery");
  try {
    const ok = await resetPassword(token, password);
    redirect(ok ? "/login?reset=1" : `/reset?token=${encodeURIComponent(token)}&error=${encodeURIComponent("This link is invalid or expired.")}`);
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    redirect(`/reset?token=${encodeURIComponent(token)}&error=${encodeURIComponent(e.message)}`);
  }
}

export async function changeEmailAction(formData: FormData) {
  const user = await currentUser(); if (!user) redirect("/login");
  const newEmail = clean(formData.get("email"));
  const { changeEmail } = await import("@/lib/recovery");
  try { await changeEmail(user!.id, newEmail, await baseUrl()); redirect("/account?sent=1"); }
  catch (e: any) { if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e; redirect(`/account?error=${encodeURIComponent(e.message)}`); }
}

export async function resendVerifyAction() {
  const user = await currentUser(); if (!user) redirect("/login");
  const { emailStatus, sendVerification } = await import("@/lib/recovery");
  const s = await emailStatus(user!.id);
  if (s && !s.verified) await sendVerification(user!.id, s.email, await baseUrl());
  redirect("/account?sent=1");
}

export async function pushGradesAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { pushSectionGrades } = await import("@/lib/lti");
  try { const r = await pushSectionGrades(sectionId); redirect(`/teach/${sectionId}/gradebook?pushed=${r.pushed}&skipped=${r.skipped}&withdrawn=${r.withdrawn}`); }
  catch (e: any) { if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e; redirect(`/teach/${sectionId}/gradebook?push_error=${encodeURIComponent(e.message)}`); }
}

export async function syncRosterAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { syncRoster } = await import("@/lib/lti");
  try { const r = await syncRoster(sectionId); redirect(`/teach/${sectionId}?synced=${r.added}&seen=${r.seen}`); }
  catch (e: any) { if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e; redirect(`/teach/${sectionId}?sync_error=${encodeURIComponent(e.message)}`); }
}

// --- Spec 17: set-your-password invitations ---
//
// These replace the instructor's temporary-password reset. That one generated a password and
// passed it through the URL query string, so it was written into browser history and into every
// log along the way; nothing here puts a password in a URL.

const teachBack = (sectionId: string, msg: { ok?: string; error?: string; link?: string }) => {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}`
    : msg.link ? `?invite_link=${encodeURIComponent(msg.link)}`
    : `?ok=${encodeURIComponent(msg.ok ?? "")}`;
  return `/teach/${sectionId}${q}#roster`;
};

type Invitable = { student: { userId: string; email: string; name: string; isDemo: boolean } | null; error?: string };
async function invitable(sectionId: string, enrolmentId: string): Promise<Invitable> {
  const { studentOfEnrolment } = await import("@/lib/recovery");
  const s = await studentOfEnrolment(sectionId, enrolmentId);
  if (!s) return { student: null, error: "That student is not in this class." };
  if (!s.email) return { student: null, error: "That student signs in through the LMS, so there is no address to send to." };
  return { student: { userId: s.userId, email: s.email, name: s.name, isDemo: s.isDemo } };
}

export async function sendInviteAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const enrolmentId = clean(formData.get("enrolmentId"));
  const { canManageClass } = await import("@/lib/publish");
  if (!user || !(await canManageClass(user.id, sectionId))) redirect("/teach");
  const found = await invitable(sectionId, enrolmentId);
  if (!found.student) redirect(teachBack(sectionId, { error: found.error }));
  // Spec 18: a demo account is never emailed. D2L's demo address is not a person's inbox.
  if (found.student.isDemo)
    redirect(teachBack(sectionId, { error: "The demo account is never emailed. Use Copy link to sign in as it yourself." }));
  const { rateLimit, sendSetPasswordInvite, RESEND_MAX_PER_HOUR } = await import("@/lib/recovery");
  if (!(await rateLimit(`invite:${found.student.userId}`, RESEND_MAX_PER_HOUR, 3600)))
    redirect(teachBack(sectionId, { error: `That student has had ${RESEND_MAX_PER_HOUR} invitations this hour. Try again later, or use Copy link.` }));
  const r = await sendSetPasswordInvite(found.student.userId, sectionId, found.student.email, await baseUrl());
  redirect(teachBack(sectionId, r.ok
    ? { ok: "Invitation sent." }
    : { error: `Not sent: ${r.error}. The link is recorded against that student — use Copy link to hand it over.` }));
}

export async function sendAllInvitesAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const { canManageClass } = await import("@/lib/publish");
  if (!user || !(await canManageClass(user.id, sectionId))) redirect("/teach");
  const { notSetUp } = await import("@/lib/d2l-import");
  const { rateLimit, sendSetPasswordInvite, RESEND_MAX_PER_HOUR } = await import("@/lib/recovery");
  const base = await baseUrl();
  let sent = 0, failed = 0, limited = 0;
  // One failure never stops the rest: each student is invited on their own account.
  for (const s of await notSetUp(sectionId)) {
    if (!s.email) continue;
    if (!(await rateLimit(`invite:${s.userId}`, RESEND_MAX_PER_HOUR, 3600))) { limited++; continue; }
    const r = await sendSetPasswordInvite(s.userId, sectionId, s.email, base);
    if (r.ok) sent++; else failed++;
  }
  const bits = [`${sent} invitation${sent === 1 ? "" : "s"} sent`];
  if (failed) bits.push(`${failed} not sent`);
  if (limited) bits.push(`${limited} already had ${RESEND_MAX_PER_HOUR} this hour`);
  redirect(teachBack(sectionId, { ok: bits.join(", ") + "." }));
}

export async function copyInviteLinkAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const enrolmentId = clean(formData.get("enrolmentId"));
  const { canManageClass } = await import("@/lib/publish");
  if (!user || !(await canManageClass(user.id, sectionId))) redirect("/teach");
  const found = await invitable(sectionId, enrolmentId);
  if (!found.student) redirect(teachBack(sectionId, { error: found.error }));
  const { copySetPasswordLink } = await import("@/lib/recovery");
  const link = await copySetPasswordLink(found.student.userId, sectionId, found.student.email, await baseUrl());
  redirect(teachBack(sectionId, { link }));
}

export async function setPasswordAction(formData: FormData) {
  const token = clean(formData.get("token"));
  const password = String(formData.get("password") ?? "");
  const { completeSetPassword } = await import("@/lib/recovery");
  try {
    const done = await completeSetPassword(token, password);
    if (!done) redirect("/set-password?expired=1");
    await createSession(done!.userId);
    await claimInvites(done!.userId, done!.email);
    const me = (await db().select({ role: users.systemRole }).from(users).where(eq(users.id, done!.userId)).limit(1))[0];
    redirect(await signInDestination(done!.userId, me?.role ?? "user", "/"));
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    redirect(`/set-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(e.message)}`);
  }
}

export async function addAnnouncementAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { addAnnouncement } = await import("@/lib/course");
  const title = clean(formData.get("title")), body = clean(formData.get("body"));
  if (title && body) await addAnnouncement(sectionId, title, body);
  redirect(`/teach/${sectionId}/announcements`);
}
export async function deleteAnnouncementAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { deleteAnnouncement } = await import("@/lib/course");
  await deleteAnnouncement(sectionId, clean(formData.get("id")));
  redirect(`/teach/${sectionId}/announcements`);
}
export async function setSyllabusAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setSyllabus } = await import("@/lib/course");
  await setSyllabus(sectionId, String(formData.get("content") ?? ""));
  redirect(`/teach/${sectionId}/syllabus?saved=1`);
}
export async function addScheduleItemAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { addScheduleItem } = await import("@/lib/course");
  const title = clean(formData.get("title"));
  const rawDue = clean(formData.get("dueAt"));
  const dueAt = rawDue ? new Date(rawDue) : null;
  if (title) await addScheduleItem(sectionId, { title, dueAt, kind: clean(formData.get("kind")) || null, note: clean(formData.get("note")) || null });
  redirect(`/teach/${sectionId}/schedule`);
}
export async function deleteScheduleItemAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { deleteScheduleItem } = await import("@/lib/course");
  await deleteScheduleItem(sectionId, clean(formData.get("id")));
  redirect(`/teach/${sectionId}/schedule`);
}

export async function saveAolSettingsAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setSettings } = await import("@/lib/aol");
  const n = (k: string, d: number) => { const v = Number(formData.get(k)); return Number.isFinite(v) && v > 0 ? Math.round(v) : d; };
  await setSettings(sectionId, { program: clean(formData.get("program")) || null, meetsPct: n("meetsPct", 70), exceedsPct: n("exceedsPct", 85), targetPct: n("targetPct", 70), minN: n("minN", 5) });
  redirect(`/teach/${sectionId}/aol`);
}
export async function toggleProgramMapAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { toggleProgramMap } = await import("@/lib/aol");
  await toggleProgramMap(clean(formData.get("outcomeId")), clean(formData.get("programOutcomeId")), formData.get("on") === "1");
  redirect(`/teach/${sectionId}/aol`);
}
export async function setEvidenceAction(formData: FormData) {
  const user = await currentUser(); const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setEvidence } = await import("@/lib/aol");
  await setEvidence(clean(formData.get("lineItemId")), clean(formData.get("outcomeId")), clean(formData.get("evidenceType")) || null);
  redirect(`/teach/${sectionId}/aol`);
}

// --- Spec 20: the course assistant's controls, and Ask your instructor ---

export async function setAssistantSettingsAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user) redirect("/login");
  const { setSettings } = await import("@/lib/assistant/store");
  const num = (k: string) => {
    const v = formData.get(k);
    return v == null || String(v).trim() === "" ? undefined : Number(v);
  };
  const r = await setSettings(user!.id, sectionId, {
    enabled: formData.get("enabled") === "1",
    dailyPerStudent: num("dailyPerStudent"),
    monthlyTokenCap: num("monthlyTokenCap"),
  });
  redirect(r.ok
    ? `/teach/${sectionId}/assistant?ok=${encodeURIComponent("Saved.")}`
    : `/teach/${sectionId}/assistant?error=${encodeURIComponent(r.error)}`);
}

/** Off for one piece of work — an exam held outside the Wrapper, say — without touching the class. */
export async function setAssignmentAssistantAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const assignmentId = clean(formData.get("assignmentId"));
  const { canManageClass } = await import("@/lib/publish");
  if (!user || !(await canManageClass(user.id, sectionId))) redirect("/teach");
  const { db } = await import("@/db");
  const { assignments } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  await db().update(assignments).set({ assistantOff: formData.get("off") === "1" })
    .where(and(eq(assignments.id, assignmentId), eq(assignments.sectionId, sectionId)));
  redirect(`/teach/${sectionId}/assignments/${assignmentId}`);
}

export async function askInstructorAction(formData: FormData) {
  const user = await currentUser();
  const threadId = clean(formData.get("threadId"));
  const back = safeNext(formData.get("back"));
  if (!user) redirect("/login");
  const { threadFor, askInstructor } = await import("@/lib/assistant/store");
  const t = await threadFor(user!.id, threadId);
  if (!t || t.as !== "student") redirect(back);
  await askInstructor(threadId, t.sectionId, t.enrolmentId);
  redirect(`${back}${back.includes("?") ? "&" : "?"}asked=1`);
}

export async function replyToQuestionAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const questionId = clean(formData.get("questionId"));
  const body = String(formData.get("body") ?? "");
  if (!user) redirect("/login");
  const { answerQuestion } = await import("@/lib/assistant/store");
  const r = await answerQuestion(user!.id, questionId, body);
  if (!r.ok) redirect(`/teach/${sectionId}/assistant?error=${encodeURIComponent(r.error)}`);
  // The email is a courtesy. A failure here must not lose a reply that is already in the thread.
  if (r.email) {
    try {
      const { sendMail } = await import("@/lib/mail");
      await sendMail({
        to: r.email,
        subject: "Your instructor replied to your question",
        text: "Your instructor has replied to the question you asked in your course.\n\n" +
          `Open the conversation: ${await baseUrl()}/assistant/${r.threadId}\n`,
      });
    } catch { /* never breaks the reply */ }
  }
  redirect(`/teach/${sectionId}/assistant?ok=${encodeURIComponent("Reply sent.")}`);
}

// --- Spec 19: withdraw and restore, from the class list ---

export async function withdrawStudentAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const enrolmentId = clean(formData.get("enrolmentId"));
  const restore = formData.get("restore") === "1";
  if (!user) redirect("/login");
  const { withdrawStudents, restoreStudents } = await import("@/lib/withdraw");
  const r = restore
    ? await restoreStudents(user!.id, sectionId, [enrolmentId])
    : await withdrawStudents(user!.id, sectionId, [enrolmentId]);
  const q = r.ok
    ? `ok=${encodeURIComponent(restore ? "Restored." : "Withdrawn. Their work is kept.")}`
    : `error=${encodeURIComponent(r.error)}`;
  redirect(`/teach/${sectionId}?${q}#roster`);
}
