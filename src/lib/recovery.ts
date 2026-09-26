import "server-only";
import { and, eq, inArray, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { authTokens, rateCounters, identities, users, sessions, enrolments, bookmarks, examAttempts, lineItemScores } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { sendMail } from "@/lib/mail";

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

function newToken() { return randomBytes(32).toString("hex"); }
async function issue(userId: string, kind: string, email: string | null, ttlSec: number) {
  const token = newToken();
  await db().insert(authTokens).values({ token, userId, kind, email, expiresAt: new Date(Date.now() + ttlSec * 1000) });
  return token;
}
async function consumeToken(token: string, kind: string) {
  const row = (await db().select().from(authTokens).where(and(eq(authTokens.token, token), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).limit(1))[0];
  if (!row) return null;
  await db().update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.token, token));
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

// Instructor resets a student's password in person — no email required (standalone classrooms).
export async function setStudentPassword(sectionId: string, enrolmentId: string, newPassword: string) {
  const enr = (await db().select().from(enrolments).where(and(eq(enrolments.id, enrolmentId), eq(enrolments.sectionId, sectionId))).limit(1))[0];
  if (!enr) throw new Error("That student is not in this section");
  const ident = (await db().select().from(identities).where(and(eq(identities.userId, enr.userId), eq(identities.provider, "password"))).limit(1))[0];
  if (!ident) throw new Error("This student signs in through the LMS or hasn't set a password yet");
  await db().update(identities).set({ passwordHash: await hashPassword(newPassword) }).where(eq(identities.id, ident.id));
  await db().delete(sessions).where(eq(sessions.userId, enr.userId)); // force re-login
}
export function tempPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const b = randomBytes(10);
  for (let i = 0; i < 10; i++) s += a[b[i] % a.length];
  return s;
}
