import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

const COOKIE = "fx_session";
const DAYS = 30;

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DAYS * 864e5);
  await db().insert(sessions).values({ id, userId, expiresAt });
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await db().delete(sessions).where(eq(sessions.id, id));
  jar.delete(COOKIE);
}

function missingSystemRole(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "42703" && typeof candidate.message === "string" &&
        candidate.message.includes("system_role")) return true;
    current = candidate.cause;
  }
  return false;
}

export async function currentUser() {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const activeSession = and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()));
  try {
    const rows = await db()
      .select({ id: users.id, displayName: users.displayName, systemRole: users.systemRole })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(activeSession)
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    if (!missingSystemRole(error)) throw error;
    // Existing sessions can read while migration 0012 is pending; no admin access is granted.
    const rows = await db()
      .select({ id: users.id, displayName: users.displayName })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(activeSession)
      .limit(1);
    return rows[0] ? { ...rows[0], systemRole: "user" } : null;
  }
}
