"use server";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { users, identities } from "@/db/schema";
import { hashPassword, verifyPassword, createSession, destroySession, currentUser } from "@/lib/auth";
import { enrolInBook, enrolmentForBook } from "@/lib/enrolment";
import { createSection, ownedSection, regenerateJoinCode, removeEnrolment, enrollByCode, claimInvites } from "@/lib/roster";

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function signup(formData: FormData) {
  const name = clean(formData.get("name"));
  const email = clean(formData.get("email")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = clean(formData.get("next")) || "/";
  if (!name || !email || password.length < 8)
    redirect(`/signup?error=${encodeURIComponent("Name, email, and an 8+ character password are required.")}`);
  const existing = await db().select({ id: identities.id }).from(identities)
    .where(and(eq(identities.provider, "password"), eq(identities.subject, email))).limit(1);
  if (existing[0]) redirect(`/signup?error=${encodeURIComponent("An account with that email already exists.")}`);
  const [user] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: user.id, provider: "password", subject: email, passwordHash: await hashPassword(password) });
  await createSession(user.id);
  await claimInvites(user.id, email); // roster invites -> enrolments
  try {
    const { sendVerification } = await import("@/lib/recovery");
    const { headers } = await import("next/headers"); const h = await headers();
    await sendVerification(user.id, email, `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
  } catch {}
  redirect(next);
}

export async function login(formData: FormData) {
  const email = clean(formData.get("email")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = clean(formData.get("next")) || "/";
  const { rateLimit } = await import("@/lib/recovery");
  if (!(await rateLimit(`login:${email}`, 8, 900)))
    redirect(`/login?error=${encodeURIComponent("Too many attempts — wait a few minutes.")}&next=${encodeURIComponent(next)}`);
  const row = (await db().select({ userId: identities.userId, hash: identities.passwordHash }).from(identities)
    .where(and(eq(identities.provider, "password"), eq(identities.subject, email))).limit(1))[0];
  if (!row?.hash || !(await verifyPassword(password, row.hash)))
    redirect(`/login?error=${encodeURIComponent("Wrong email or password.")}&next=${encodeURIComponent(next)}`);
  await createSession(row.userId);
  await claimInvites(row.userId, email);
  redirect(next);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function enroll(formData: FormData) {
  const user = await currentUser();
  const bookId = clean(formData.get("bookId"));
  if (!user) redirect(`/login?next=${encodeURIComponent("/" + bookId)}`);
  await enrolInBook(user!.id, bookId);
  redirect(`/${bookId}`);
}

export async function enrollByCodeAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const c = clean(formData.get("code"));
  const sec = await enrollByCode(user!.id, c);
  redirect(sec ? `/${sec.bookId}` : `/?error=${encodeURIComponent("No section found for that code.")}`);
}

export async function createSectionAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/teach");
  const bookId = clean(formData.get("bookId"));
  const name = clean(formData.get("name"));
  if (!bookId || !name) redirect(`/teach?error=${encodeURIComponent("Pick a book and name the section.")}`);
  const term = clean(formData.get("term")) || undefined;
  const sec = await createSection(user!.id, bookId, name, term);
  redirect(`/teach/${sec.id}`);
}

export async function regenerateCodeAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  await regenerateJoinCode(sectionId);
  redirect(`/teach/${sectionId}`);
}

export async function removeStudentAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const enrolmentId = clean(formData.get("enrolmentId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  await removeEnrolment(sectionId, enrolmentId);
  redirect(`/teach/${sectionId}`);
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
  await createExam(sectionId, {
    title: clean(formData.get("title")) || "Untitled exam",
    blueprint, feedback: clean(formData.get("feedback")) || "after_close",
    timeLimitMin: null, attemptLimit: Math.max(1, Number(formData.get("attemptLimit")) || 1),
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

export async function setScoreAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setScore } = await import("@/lib/gradebook");
  const lineItemId = clean(formData.get("lineItemId")); const enrolmentId = clean(formData.get("enrolmentId"));
  const raw = clean(formData.get("points"));
  if (lineItemId && enrolmentId && raw !== "") await setScore(lineItemId, enrolmentId, Number(raw));
  redirect(`/teach/${sectionId}/gradebook`);
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
  try { const r = await pushSectionGrades(sectionId); redirect(`/teach/${sectionId}/gradebook?pushed=${r.pushed}&skipped=${r.skipped}`); }
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

export async function resetStudentPasswordAction(formData: FormData) {
  const user = await currentUser();
  const sectionId = clean(formData.get("sectionId"));
  const enrolmentId = clean(formData.get("enrolmentId"));
  const name = clean(formData.get("name"));
  if (!user || !(await ownedSection(user.id, sectionId))) redirect("/teach");
  const { setStudentPassword, tempPassword } = await import("@/lib/recovery");
  const temp = tempPassword();
  try { await setStudentPassword(sectionId, enrolmentId, temp); redirect(`/teach/${sectionId}?pwreset=${encodeURIComponent(name)}&temp=${encodeURIComponent(temp)}`); }
  catch (e: any) { if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e; redirect(`/teach/${sectionId}?pwreset_error=${encodeURIComponent(e.message)}`); }
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
