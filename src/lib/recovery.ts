import "server-only";
import { and, eq, inArray, gt, isNull, desc } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { authTokens, rateCounters, identities, users, sessions, enrolments, sections, bookmarks, examAttempts, lineItemScores } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { sendMail, mailConfigured, NOT_CONFIGURED } from "@/lib/mail";

// ---- fixed-window rate limiter ----
export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const now = new Date();
  const row = (await db().select().from(rateCounters).where(eq(rateCounters.key, key)).limit(1))[0];
  if (!row || now.getTime() - row.windowStart.getTime() > windowSec * 1000) {
    await db().insert(rateCounters).values({ key, windowStart: now, count: 1 })
      .onConflictDoUpdate({ target: rateCounters.key, set: { windowStart: now, count: 1 } });
    return true;
  }
  if (row.count >= max) return false;
  await db().update(rateCounters).set({ count: row.count + 1 }).where(eq(rateCounters.key, key));
  return true;
}

// ---- tokens ----
// Spec 17: only the hash is stored, for all three kinds. The secret exists in the link and
// nowhere else, so a database read or a backup yields nothing anyone can follow.
function newToken() { return randomBytes(32).toString("hex"); }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

async function issue(userId: string, kind: string, email: string | null, ttlSec: number,
                     extra: { sectionId?: string | null; sentAt?: Date | null; sendError?: string | null } = {}) {
  const token = newToken();
  await db().insert(authTokens).values({
    tokenHash: hashToken(token), userId, kind, email,
    expiresAt: new Date(Date.now() + ttlSec * 1000),
    sectionId: extra.sectionId ?? null, sentAt: extra.sentAt ?? null, sendError: extra.sendError ?? null,
  });
  return token;
}
async function consumeToken(token: string, kind: string) {
  const hash = hashToken(token);
  const row = (await db().select().from(authTokens).where(and(eq(authTokens.tokenHash, hash), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).limit(1))[0];
  if (!row) return null;
  await db().update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.tokenHash, hash));
  return row;
}

// ---- password reset ----
export async function requestPasswordReset(email: string, baseUrl: string) {
  const e = email.toLowerCase().trim();
  const ident = (await db().select().from(identities).where(and(eq(identities.provider, "password"), eq(identities.subject, e))).limit(1))[0];
  if (ident) {
    const token = await issue(ident.userId, "password_reset", e, 3600);
    await sendMail({ to: e, subject: "Reset your Flexee password", text: `Reset your password: ${baseUrl}/reset?token=${token}\nThis link expires in 1 hour. If you didn't request it, ignore this email.` });
  }
  // caller always reports the same message (no account enumeration)
}
export async function resetPassword(token: string, newPassword: string) {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  const row = await consumeToken(token, "password_reset");
  if (!row) return false;
  await db().update(identities).set({ passwordHash: await hashPassword(newPassword) })
    .where(and(eq(identities.userId, row.userId), eq(identities.provider, "password")));
  await db().delete(sessions).where(eq(sessions.userId, row.userId)); // sign out everywhere
  return true;
}

// ---- email verification ----
export async function sendVerification(userId: string, email: string, baseUrl: string) {
  const token = await issue(userId, "email_verify", email.toLowerCase().trim(), 86400);
  await sendMail({ to: email, subject: "Confirm your Flexee email", text: `Confirm your email: ${baseUrl}/api/auth/verify?token=${token}` });
}
export async function verifyEmail(token: string) {
  const row = await consumeToken(token, "email_verify");
  if (!row || !row.email) return false;
  await db().update(identities).set({ emailVerifiedAt: new Date() })
    .where(and(eq(identities.userId, row.userId), eq(identities.provider, "password"), eq(identities.subject, row.email)));
  return true;
}

// ---- self-serve email change (handles the mistyped-email case) ----
export async function changeEmail(userId: string, newEmail: string, baseUrl: string) {
  const e = newEmail.toLowerCase().trim();
  const taken = (await db().select().from(identities).where(and(eq(identities.provider, "password"), eq(identities.subject, e))).limit(1))[0];
  if (taken && taken.userId !== userId) throw new Error("That email is already in use");
  await db().update(identities).set({ subject: e, emailVerifiedAt: null })
    .where(and(eq(identities.userId, userId), eq(identities.provider, "password")));
  await sendVerification(userId, e, baseUrl);
}

// ---- account merge (support operation) ----
// Move everything from `fromUserId` into `intoUserId`, then delete the empty account.
export async function mergeAccounts(fromUserId: string, intoUserId: string) {
  if (fromUserId === intoUserId) throw new Error("Cannot merge an account into itself");
  // enrolments: move, but if the target is already enrolled in that section, drop the source enrolment (cascades its attempts/bookmarks/scores)
  const fromEnr = await db().select().from(enrolments).where(eq(enrolments.userId, fromUserId));
  const intoSecs = new Set((await db().select({ s: enrolments.sectionId }).from(enrolments).where(eq(enrolments.userId, intoUserId))).map((r) => r.s));
  for (const e of fromEnr) {
    if (intoSecs.has(e.sectionId)) await db().delete(enrolments).where(eq(enrolments.id, e.id));
    else await db().update(enrolments).set({ userId: intoUserId }).where(eq(enrolments.id, e.id));
  }
  // identities: move those whose (provider,subject) the target doesn't already hold
  const intoIdents = new Set((await db().select().from(identities).where(eq(identities.userId, intoUserId))).map((i) => `${i.provider}|${i.subject}`));
  for (const i of await db().select().from(identities).where(eq(identities.userId, fromUserId))) {
    if (intoIdents.has(`${i.provider}|${i.subject}`)) await db().delete(identities).where(eq(identities.id, i.id));
    else await db().update(identities).set({ userId: intoUserId }).where(eq(identities.id, i.id));
  }
  await db().delete(sessions).where(eq(sessions.userId, fromUserId));
  await db().delete(users).where(eq(users.id, fromUserId)); // cascades any remainder
  return true;
}

export async function emailStatus(userId: string) {
  const i = (await db().select().from(identities).where(and(eq(identities.userId, userId), eq(identities.provider, "password"))).limit(1))[0];
  return i ? { email: i.subject, verified: i.emailVerifiedAt != null } : null;
}

// ---- set-your-password invitations (Spec 17 §3) ----
//
// This is what the instructor's old "Reset password" button became. It used to generate a
// temporary password and pass it through the URL query string, so the password landed in browser
// history and in every proxy log between here and there. Nothing passes a password through a URL
// any more: the student follows a one-time link and chooses their own.

export const SET_PASSWORD_TTL_SEC = 14 * 86400; // 14 days
export const RESEND_MAX_PER_HOUR = 3;

export const setPasswordUrl = (baseUrl: string, token: string) =>
  `${baseUrl.replace(/\/+$/, "")}/set-password?token=${encodeURIComponent(token)}`;

/**
 * Issue a fresh invitation, retiring any earlier unused one for this student. Both Resend and
 * Copy link come through here, so only one link is ever live: a student who was emailed twice
 * cannot be caught out by which of the two they happened to open.
 */
async function issueSetPassword(userId: string, sectionId: string | null, email: string,
                                sent: { sentAt?: Date | null; sendError?: string | null }) {
  await db().delete(authTokens).where(and(
    eq(authTokens.userId, userId), eq(authTokens.kind, "set_password"), isNull(authTokens.usedAt),
  ));
  return issue(userId, "set_password", email.toLowerCase().trim(), SET_PASSWORD_TTL_SEC, { sectionId, ...sent });
}

function inviteText(link: string, className: string | null, term: string | null) {
  const where = className ? `${className}${term ? ` (${term})` : ""}` : "your course";
  return [
    `You have been added to ${where} on Flexee.`,
    "",
    "Choose your password to finish setting up your account:",
    link,
    "",
    "The link works once and expires in 14 days. If it has expired, use \"Forgot password\" on the",
    "sign-in page and we will send you a new one.",
  ].join("\n");
}

async function classOf(sectionId: string | null) {
  if (!sectionId) return { name: null as string | null, term: null as string | null };
  const s = (await db().select({ name: sections.name, term: sections.term }).from(sections).where(eq(sections.id, sectionId)).limit(1))[0];
  return { name: s?.name ?? null, term: s?.term ?? null };
}

/**
 * Email an invitation. Never throws and never loses the account: a send that fails is recorded on
 * the invitation and reported, and the next student in the list is still invited.
 */
export async function sendSetPasswordInvite(userId: string, sectionId: string | null, email: string, baseUrl: string) {
  const cls = await classOf(sectionId);
  if (!mailConfigured()) {
    await issueSetPassword(userId, sectionId, email, { sendError: NOT_CONFIGURED });
    return { ok: false, error: NOT_CONFIGURED };
  }
  const token = await issueSetPassword(userId, sectionId, email, {});
  const r = await sendMail({
    to: email,
    subject: cls.name ? `Set your password for ${cls.name}` : "Set your Flexee password",
    text: inviteText(setPasswordUrl(baseUrl, token), cls.name, cls.term),
  });
  await db().update(authTokens)
    .set({ sentAt: r.ok ? new Date() : null, sendError: r.ok ? null : (r.error ?? "send failed") })
    .where(eq(authTokens.tokenHash, hashToken(token)));
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "send failed" };
}

/**
 * A fresh link for faculty to hand over, for when an email does not arrive. Shown once — the
 * secret is not stored, so it cannot be shown again — and it retires the earlier unused one.
 */
export async function copySetPasswordLink(userId: string, sectionId: string | null, email: string, baseUrl: string) {
  const token = await issueSetPassword(userId, sectionId, email, {});
  return setPasswordUrl(baseUrl, token);
}

/** The student chooses their password. Marks the email verified, and signs out any stale session. */
export async function completeSetPassword(token: string, newPassword: string) {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  const row = await consumeToken(token, "set_password");
  if (!row) return null;
  const ident = (await db().select().from(identities)
    .where(and(eq(identities.userId, row.userId), eq(identities.provider, "password"))).limit(1))[0];
  if (!ident) return null;
  // Setting a password this way proves the address received the link, so the email is verified.
  await db().update(identities)
    .set({ passwordHash: await hashPassword(newPassword), emailVerifiedAt: new Date() })
    .where(eq(identities.id, ident.id));
  await db().delete(sessions).where(eq(sessions.userId, row.userId));
  return { userId: row.userId, sectionId: row.sectionId, email: ident.subject };
}

/** Has this person ever set a password? A passwordless account is one the import made. */
export async function hasUsablePassword(email: string) {
  const i = (await db().select({ hash: identities.passwordHash, userId: identities.userId }).from(identities)
    .where(and(eq(identities.provider, "password"), eq(identities.subject, email.toLowerCase().trim()))).limit(1))[0];
  if (!i) return null;
  return { userId: i.userId, hasPassword: i.hash != null };
}

export type InviteState =
  | { state: "set up" }
  | { state: "invited"; at: Date }
  | { state: "link copied"; at: Date }
  | { state: "link expired"; at: Date }
  | { state: "not sent"; reason: string }
  | { state: "none" };

/**
 * Each student's invitation state for the faculty class list. Derived, never stored twice: having
 * a password is what "set up" means, and the rest comes from the newest invitation row.
 */
export async function inviteStatesFor(sectionId: string): Promise<Map<string, InviteState>> {
  const roster = await db().select({ userId: enrolments.userId, hash: identities.passwordHash })
    .from(enrolments)
    .leftJoin(identities, and(eq(identities.userId, enrolments.userId), eq(identities.provider, "password")))
    .where(and(eq(enrolments.sectionId, sectionId), eq(enrolments.role, "student")));
  const ids = roster.map((r) => r.userId);
  const tokens = ids.length
    ? await db().select().from(authTokens)
        .where(and(inArray(authTokens.userId, ids), eq(authTokens.kind, "set_password")))
        .orderBy(desc(authTokens.createdAt))
    : [];
  const newest = new Map<string, typeof tokens[number]>();
  for (const t of tokens) if (!newest.has(t.userId)) newest.set(t.userId, t);

  const out = new Map<string, InviteState>();
  const now = Date.now();
  for (const r of roster) {
    if (r.hash != null) { out.set(r.userId, { state: "set up" }); continue; }
    const t = newest.get(r.userId);
    if (!t) { out.set(r.userId, { state: "none" }); continue; }
    if (t.sendError) { out.set(r.userId, { state: "not sent", reason: t.sendError }); continue; }
    if (t.expiresAt.getTime() <= now) { out.set(r.userId, { state: "link expired", at: t.createdAt }); continue; }
    if (t.sentAt) out.set(r.userId, { state: "invited", at: t.sentAt });
    else out.set(r.userId, { state: "link copied", at: t.createdAt });
  }
  return out;
}

/** The student this enrolment belongs to, within this class. */
export async function studentOfEnrolment(sectionId: string, enrolmentId: string) {
  const r = (await db().select({ userId: enrolments.userId, email: identities.subject, name: users.displayName })
    .from(enrolments)
    .innerJoin(users, eq(users.id, enrolments.userId))
    .leftJoin(identities, and(eq(identities.userId, enrolments.userId), eq(identities.provider, "password")))
    .where(and(eq(enrolments.id, enrolmentId), eq(enrolments.sectionId, sectionId))).limit(1))[0];
  return r ?? null;
}
