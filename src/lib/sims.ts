import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { sims, simPreviews, classSims, simLaunches, simCompletions, simTranscripts, enrolments, users, identities, sections } from "@/db/schema";
import { ownedSection } from "@/lib/roster";
import { isAdmin } from "@/lib/admin";
import { verifyPass, launchPass } from "@/lib/launchpass";

// RapidSims behind the front door (Flexee Systems Map, contract C2). The Wrapper does what the frozen
// RapidSims platform does, in the same way, so the sims need no change: it keeps the catalogue, launches
// sims with a signed pass, and accepts registrations, completions and transcripts signed by the sims.

export type R<T = {}> = ({ ok: true } & T) | { ok: false; error: string; status?: number };
const fail = (error: string, status = 400) => ({ ok: false as const, error, status });
const clip = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---- registration (sim -> Wrapper), identical in effect to platform/api/register.js ----------------
export async function registerSim(token: unknown): Promise<R<{ created: boolean; number: number | null; catalogueRefreshed?: boolean }>> {
  const p = verifyPass(token);
  if (!p) return fail("bad_signature", 401);
  if (p.kind !== "register" || !p.sim) return fail("not_a_registration");
  if (!p.launchUrl || !/^https?:\/\//.test(p.launchUrl)) return fail("no_address");
  const minutes = Number.isFinite(+p.minutes) ? Math.max(1, Math.min(600, Math.round(+p.minutes))) : null;
  const sourceRevision = clip(p.catalogueRevision, 120);
  const existing = (await db().select().from(sims).where(eq(sims.id, String(p.sim))).limit(1))[0];

  if (!existing) {
    const taken = (await db().select({ n: sims.number }).from(sims).where(isNotNull(sims.number))).map((r) => r.n!);
    const wanted = Number(p.number);
    let n = Number.isSafeInteger(wanted) && wanted > 0 && !taken.includes(wanted) ? wanted : 1;
    while (taken.includes(n)) n++;
    const detail = p.detail ? { ...p.detail, ...(sourceRevision ? { _source_revision: sourceRevision } : {}) } : null;
    await db().insert(sims).values({ id: String(p.sim), number: n, title: clip(p.title, 200) || String(p.sim),
      tagline: clip(p.tagline, 300), description: clip(p.description, 4000), minutes, launchUrl: clip(p.launchUrl, 500),
      published: false, detail: detail ? JSON.stringify(detail).slice(0, 12000) : null });
    return { ok: true, created: true, number: n };
  }

  const stored = parse(existing.detail) ?? {};
  const replacingScenario = !!(sourceRevision && sourceRevision !== stored._source_revision);
  const edited: string[] = replacingScenario ? [] : (stored._edited ?? []);
  const set: Partial<typeof sims.$inferInsert> = { launchUrl: clip(p.launchUrl, 500), updatedAt: new Date() };
  if (minutes) set.minutes = minutes;
  if (p.detail) {
    const merged: any = { ...p.detail };
    for (const k of edited) if (stored[k] !== undefined) merged[k] = stored[k];
    merged._edited = edited;
    if (sourceRevision) merged._source_revision = sourceRevision;
    set.detail = JSON.stringify(merged).slice(0, 12000);
  }
  if (p.title && !edited.includes("title")) set.title = clip(p.title, 200)!;
  if (p.tagline && !edited.includes("tagline")) set.tagline = clip(p.tagline, 300);
  if (p.description && !edited.includes("description")) set.description = clip(p.description, 4000);
  await db().update(sims).set(set).where(eq(sims.id, existing.id));
  return { ok: true, created: false, number: existing.number, catalogueRefreshed: replacingScenario };
}

// ---- the catalogue -------------------------------------------------------------------------------
/** Admins see every sim; anyone else sees published sims plus those they were granted a preview of. */
export async function visibleSims(userId: string) {
  const all = await db().select().from(sims);
  if (await isAdmin(userId)) return all.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const granted = new Set((await db().select({ s: simPreviews.simId }).from(simPreviews).where(eq(simPreviews.userId, userId))).map((r) => r.s));
  return all.filter((s) => s.published || granted.has(s.id)).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
}

/** Admin: publish or unpublish, edit the wording (kept across re-registrations), add a sim by hand. */
export async function adminUpdateSim(userId: string, simId: string, f: { title?: string; tagline?: string; description?: string; published?: boolean; launchUrl?: string }): Promise<R> {
  if (!(await isAdmin(userId))) return fail("Only administrators manage the catalogue.", 403);
  const s = (await db().select().from(sims).where(eq(sims.id, simId)).limit(1))[0];
  if (!s) return fail("No such simulation.", 404);
  const detail = parse(s.detail) ?? {}; const edited = new Set<string>(detail._edited ?? []);
  const set: Partial<typeof sims.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["title", "tagline", "description"] as const) {
    if (f[k] !== undefined && f[k] !== s[k]) { (set as any)[k] = clip(f[k], k === "title" ? 200 : k === "tagline" ? 300 : 4000); edited.add(k); }
  }
  if (f.launchUrl !== undefined) {
    if (f.launchUrl && !/^https?:\/\//.test(f.launchUrl)) return fail("The address must start with https://");
    set.launchUrl = clip(f.launchUrl, 500);
  }
  if (f.published !== undefined) set.published = f.published;
  set.detail = JSON.stringify({ ...detail, _edited: [...edited] });
  await db().update(sims).set(set).where(eq(sims.id, simId));
  return { ok: true };
}

export async function adminAddSim(userId: string, f: { id: string; title: string; launchUrl: string }): Promise<R> {
  if (!(await isAdmin(userId))) return fail("Only administrators manage the catalogue.", 403);
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(f.id)) return fail("The sim id must be lowercase letters, digits and hyphens, as the sim itself uses.");
  if (!/^https?:\/\//.test(f.launchUrl)) return fail("The address must start with https://");
  const taken = (await db().select({ n: sims.number }).from(sims).where(isNotNull(sims.number))).map((r) => r.n!);
  let n = 1; while (taken.includes(n)) n++;
  await db().insert(sims).values({ id: f.id, number: n, title: clip(f.title, 200) || f.id, launchUrl: clip(f.launchUrl, 500), published: false })
    .onConflictDoNothing();
  return { ok: true };
}

export async function grantPreview(adminId: string, simId: string, userId: string): Promise<R> {
  if (!(await isAdmin(adminId))) return fail("Only administrators grant previews.", 403);
  await db().insert(simPreviews).values({ simId, userId, grantedBy: adminId }).onConflictDoNothing();
  return { ok: true };
}

// ---- sims in a class -------------------------------------------------------------------------------
export async function addSimToClass(userId: string, sectionId: string, simId: string): Promise<R> {
  if (!(await ownedSection(userId, sectionId))) return fail("Only this class's faculty can add simulations.", 403);
  const sim = (await visibleSims(userId)).find((x) => x.id === simId);
  if (!sim) return fail("That simulation is not available to you.", 403);
  await db().insert(classSims).values({ sectionId, simId, addedBy: userId }).onConflictDoNothing();
  // Spec 12: the sim gets its own gradebook column, as a participation record. Students who have
  // already played it in this class show as completed straight away, because the column reads the
  // completions rather than storing scores.
  const { ensureSimLineItem } = await import("@/lib/gradebook");
  await ensureSimLineItem(sectionId, simId, sim.title);
  return { ok: true };
}
export async function removeSimFromClass(userId: string, sectionId: string, simId: string): Promise<R> {
  if (!(await ownedSection(userId, sectionId))) return fail("Only this class's faculty can remove simulations.", 403);
  await db().delete(classSims).where(and(eq(classSims.sectionId, sectionId), eq(classSims.simId, simId)));
  return { ok: true };
}
/** The class's sims. Students get only published ones. */
export async function simsForClass(sectionId: string, forStudents: boolean) {
  const rows = await db().select({ sim: sims }).from(classSims).innerJoin(sims, eq(sims.id, classSims.simId)).where(eq(classSims.sectionId, sectionId));
  return rows.map((r) => r.sim).filter((s) => !forStudents || s.published).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
}

/** Who has played each of a class's sims (faculty view). */
export async function classCompletions(userId: string, sectionId: string) {
  if (!(await ownedSection(userId, sectionId))) return null;
  // Spec 18: a list, so a demo's play is shown rather than hidden — labelled, because faculty use
  // this page to check the sim works and should see their own run.
  const rows = await db().select({ c: simCompletions, name: users.displayName, isDemo: enrolments.isDemo }).from(simCompletions)
    .innerJoin(users, eq(users.id, simCompletions.userId))
    .leftJoin(enrolments, and(eq(enrolments.userId, simCompletions.userId), eq(enrolments.sectionId, sectionId)))
    .where(eq(simCompletions.sectionId, sectionId)).orderBy(desc(simCompletions.createdAt));
  return rows.map((r) => ({ ...r.c, name: r.name, isDemo: r.isDemo === true, metrics: parse(r.c.metrics) }));
}

// ---- launch (Wrapper -> sim) ---------------------------------------------------------------------
/** Check the person may launch this sim in this class, record the launch, and return the sim's address with the pass. */
export async function prepareLaunch(userId: string, simId: string, sectionId: string, opts: { mode?: "play" | "session"; play?: string; session?: string } = {}): Promise<R<{ url: string }>> {
  const s = (await db().select().from(sims).where(eq(sims.id, simId)).limit(1))[0];
  if (!s) return fail("No such simulation.", 404);
  if (!s.launchUrl) return fail("This simulation has no address yet. Ask an administrator.", 409);
  const enr = (await db().select().from(enrolments).where(and(eq(enrolments.userId, userId), eq(enrolments.sectionId, sectionId))).limit(1))[0];
  const attached = (await db().select().from(classSims).where(and(eq(classSims.sectionId, sectionId), eq(classSims.simId, simId))).limit(1))[0];
  let role: "student" | "faculty" | "faculty_preview";
  if (enr?.role === "instructor") {
    if (!(await visibleSims(userId)).some((x) => x.id === simId)) return fail("That simulation is not available to you.", 403);
    role = s.published && attached ? "faculty" : "faculty_preview";
  } else if (enr?.role === "student") {
    if (!attached || !s.published) return fail("That simulation is not open in your class.", 403);
    const sec = (await db().select({ p: sections.bookPublishedAt }).from(sections).where(eq(sections.id, sectionId)).limit(1))[0];
    if (!sec) return fail("That class no longer exists.", 404);
    role = "student";
  } else {
    return fail("You are not in this class.", 403);
  }
  const mode = opts.mode === "session" && role !== "student" ? "session" : "play";
  const who = (await db().select({ name: users.displayName, email: identities.subject }).from(users)
    .leftJoin(identities, and(eq(identities.userId, users.id), eq(identities.provider, "password"))).where(eq(users.id, userId)).limit(1))[0];
  await db().insert(simLaunches).values({ userId, simId, sectionId, asRole: role });
  const pass = launchPass({ userId, name: who?.name ?? "Student", email: who?.email ?? null, role, simId, sectionId, mode });
  const target = new URL(s.launchUrl.replace(/\/+$/, ""));
  if (mode === "session" && (opts.play === "team" || opts.play === "individual")) target.searchParams.set("play", opts.play);
  if (mode === "session" && opts.session) target.searchParams.set("session", opts.session);
  target.hash = "lt=" + encodeURIComponent(pass); // in the fragment: never sent to a server, never in a log
  return { ok: true, url: target.href };
}

// ---- completion and transcript (sim -> Wrapper), identical in effect to the platform's ------------
async function knownLaunch(userId: string, simId: string, sectionId: string | null) {
  const where = sectionId
    ? and(eq(simLaunches.userId, userId), eq(simLaunches.simId, simId), eq(simLaunches.sectionId, sectionId))
    : and(eq(simLaunches.userId, userId), eq(simLaunches.simId, simId));
  return (await db().select().from(simLaunches).where(where).orderBy(desc(simLaunches.createdAt)).limit(1))[0] ?? null;
}

export async function recordCompletion(token: unknown): Promise<R> {
  const p = verifyPass(token);
  if (!p) return fail("bad_signature", 401);
  if (!p.sub || !p.sim) return fail("incomplete_token");
  const launch = await knownLaunch(String(p.sub), String(p.sim), p.course ? String(p.course) : null);
  if (!launch) return fail("no_matching_launch", 404); // only someone who really launched this sim, here
  const dur = p.duration != null && Number.isFinite(+p.duration) ? Math.max(0, Math.min(86400, Math.round(+p.duration))) : null;
  let metrics: Record<string, unknown> | null = null;
  if (p.metrics && typeof p.metrics === "object") {
    metrics = {};
    for (const [k, v] of Object.entries(p.metrics).slice(0, 12)) metrics[String(k).slice(0, 60)] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  let summary: string | null = null;
  if (p.summary !== undefined && p.summary !== null) {
    summary = (typeof p.summary === "object" ? JSON.stringify(p.summary) : String(p.summary)).slice(0, 6000);
  }
  await db().insert(simCompletions).values({ userId: String(p.sub), simId: String(p.sim), sectionId: launch.sectionId,
    durationSeconds: dur, summary, metrics: metrics ? JSON.stringify(metrics) : null });
  return { ok: true };
}

const MAX_ENVELOPE = 256 * 1024;
function renderable(env: any): string | null {
  if (!env || typeof env !== "object") return "not_an_object";
  if (!env.simId) return "no_sim_id";
  if (!env.simVersion) return "no_sim_version";
  if (!Array.isArray(env.events)) return "no_events";
  if (!Array.isArray(env.phases)) return "no_phases";
  for (const e of env.events) {
    if (typeof e?.ordinal !== "number") return "event_without_ordinal";
    if (!e.phase) return "event_without_phase";
    if ("answer" in e || "text" in e) return "event_carries_answer_text"; // a transcript is never an answer key
  }
  return null;
}

export async function recordTranscript(token: unknown, envelope: unknown): Promise<R> {
  const p = verifyPass(token);
  if (!p) return fail("bad_signature", 401);
  if (!p.sub || !p.sim) return fail("incomplete_token");
  const wrong = renderable(envelope); if (wrong) return fail(wrong);
  const serialised = JSON.stringify(envelope);
  if (serialised.length > MAX_ENVELOPE) return fail("envelope_too_large", 413);
  if ((envelope as any).simId !== p.sim) return fail("sim_mismatch");
  const launch = await knownLaunch(String(p.sub), String(p.sim), null);
  if (!launch) return fail("no_matching_launch", 404);
  await db().insert(simTranscripts).values({ userId: String(p.sub), simId: String(p.sim), sectionId: p.course ? String(p.course) : launch.sectionId,
    simVersion: String((envelope as any).simVersion).slice(0, 40), envelope: serialised });
  return { ok: true };
}

export async function transcriptsFor(userId: string, sectionId: string, studentId: string, simId: string) {
  if (!(await ownedSection(userId, sectionId))) return null;
  const rows = await db().select().from(simTranscripts).where(and(eq(simTranscripts.sectionId, sectionId),
    eq(simTranscripts.userId, studentId), eq(simTranscripts.simId, simId))).orderBy(desc(simTranscripts.createdAt));
  return rows.map((r) => ({ ...r, envelope: parse(r.envelope) }));
}
