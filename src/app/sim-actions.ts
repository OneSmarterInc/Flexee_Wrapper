"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { identities } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { adminUpdateSim, adminAddSim, grantPreview, addSimToClass, removeSimFromClass } from "@/lib/sims";

const s = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v.trim() : ""; };
const back = (path: string, r: { ok: boolean; error?: string }, ok: string) =>
  redirect(`${path}?${r.ok ? "ok=" + encodeURIComponent(ok) : "error=" + encodeURIComponent(r.error ?? "Something went wrong.")}`);
async function me(next: string) { const u = await currentUser(); if (!u) redirect(`/login?next=${encodeURIComponent(next)}`); return u!; }

export async function updateSimAction(f: FormData) {
  const u = await me("/admin/sims");
  back("/admin/sims", await adminUpdateSim(u.id, s(f, "simId"), { title: s(f, "title"), tagline: s(f, "tagline"), description: s(f, "description"),
    launchUrl: s(f, "launchUrl"), published: f.get("published") === "on" }), "Saved.");
}
export async function addSimAction(f: FormData) {
  const u = await me("/admin/sims");
  back("/admin/sims", await adminAddSim(u.id, { id: s(f, "id"), title: s(f, "title"), launchUrl: s(f, "launchUrl") }), "Added, unpublished.");
}
export async function grantPreviewAction(f: FormData) {
  const u = await me("/admin/sims");
  const email = s(f, "email").toLowerCase();
  const who = (await db().select({ id: identities.userId }).from(identities).where(and(eq(identities.provider, "password"), eq(identities.subject, email))).limit(1))[0];
  if (!who) back("/admin/sims", { ok: false, error: `No account signs in with ${email}. They need to sign up first.` }, "");
  back("/admin/sims", await grantPreview(u.id, s(f, "simId"), who!.id), `${email} can now see it before publication.`);
}
export async function addClassSimAction(f: FormData) {
  const section = s(f, "sectionId"); const u = await me(`/teach/${section}/sims`);
  back(`/teach/${section}/sims`, await addSimToClass(u.id, section, s(f, "simId")), "Added to the class.");
}
export async function removeClassSimAction(f: FormData) {
  const section = s(f, "sectionId"); const u = await me(`/teach/${section}/sims`);
  back(`/teach/${section}/sims`, await removeSimFromClass(u.id, section, s(f, "simId")),
    "Removed from the class. Its gradebook column and any marks are kept.");
}

// --- Spec 12: how a sim's column is graded ---

/** Both of these are faculty-only: ownedSection is checked here, and again by section id in the library. */
export async function setSimRuleAction(f: FormData) {
  const section = s(f, "sectionId"); const u = await me(`/teach/${section}/sims`);
  const { ownedSection } = await import("@/lib/roster");
  if (!(await ownedSection(u.id, section))) redirect("/teach");
  const { setSimRule, SIM_RULES } = await import("@/lib/gradebook");
  const rule = s(f, "rule") as any;
  if (!SIM_RULES.includes(rule)) back(`/teach/${section}/sims`, { ok: false, error: "Unknown grading rule." }, "");
  try { await setSimRule(section, s(f, "lineItemId"), rule); }
  catch (e: any) { back(`/teach/${section}/sims`, { ok: false, error: e?.message ?? "Could not change that." }, ""); }
  back(`/teach/${section}/sims`, { ok: true },
    rule === "report" ? "Now a participation record — it counts towards nothing." : "Grading rule saved.");
}

export async function setSimPointsAction(f: FormData) {
  const section = s(f, "sectionId"); const u = await me(`/teach/${section}/sims`);
  const { ownedSection } = await import("@/lib/roster");
  if (!(await ownedSection(u.id, section))) redirect("/teach");
  const { setSimPoints } = await import("@/lib/gradebook");
  try { await setSimPoints(section, s(f, "lineItemId"), Number(f.get("points"))); }
  catch (e: any) { back(`/teach/${section}/sims`, { ok: false, error: e?.message ?? "Could not save the points." }, ""); }
  back(`/teach/${section}/sims`, { ok: true }, "Points saved.");
}
