import "server-only";
import { and, count, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Removing test accounts and test classes (Spec 18 §4).
 *
 * The decisions live here rather than in the script so they can be held to by a test: which
 * domains are allowed, who is spared, what would go, and what is left behind. The script is argv,
 * printing, and the one thing a test cannot do — reading a typed confirmation from a person.
 *
 * Two facts from the reports that shape it:
 *
 *  - **The cascade is complete.** One `DELETE FROM users` takes that person's identities,
 *    sessions, invitation tokens, enrolments, bookmarks, submissions and their file rows, exam
 *    attempts and responses, line-item scores, and every sim launch, completion, transcript and
 *    preview grant. One `DELETE FROM sections` takes its enrolments, assignments, exams, line
 *    items and class sims. So the deletes themselves are two statements; the long list below
 *    exists to tell the operator what those two statements will reach.
 *  - **Blob storage is not touched.** The rows that point at uploaded files go; the files stay.
 *    They are counted and reported, never deleted (decision 6).
 */

const {
  users, identities, sessions, authTokens, enrolments, bookmarks, sections,
  submissions, submissionFiles, assignments, assignmentFiles, examAttempts, examResponses,
  lineItems, lineItemScores, lineItemOutcomeMap, gradingCategories, letterScales,
  sectionOutcomes, outcomeObjectiveMap, outcomeProgramMap, rosterInvites, sectionContentPins,
  announcements, sectionSyllabus, scheduleItems, aolSettings, ltiLinks, classSims,
  simLaunches, simCompletions, simTranscripts, simPreviews, libraryUploads, exams,
} = schema;

/** Only domains the standards reserve for testing. Anything else is refused. */
export const TEST_SUFFIXES = [".invalid", ".test", ".example", ".localhost"] as const;

export function domainAllowed(domain: string) {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  if (!d || d.includes("@") || d.includes("/") || d.startsWith(".")) return false;
  return TEST_SUFFIXES.some((s) => d === s.slice(1) || d.endsWith(s));
}

/** The database this would run against, with no credentials in it. */
export function hostOf(databaseUrl: string | undefined) {
  if (!databaseUrl) return "";
  try {
    const u = new URL(databaseUrl);
    return u.hostname + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    return "";
  }
}

/** The operator has to type the host back, exactly. */
export const confirmed = (typed: string, host: string) =>
  host.length > 0 && typed.trim() === host;

export type CleanupOptions = {
  domain?: string;
  sectionId?: string;
  includeWork?: boolean;
  includeFaculty?: boolean;
};

export type CleanupPlan = {
  domain: string | null;
  sectionId: string | null;
  accounts: {
    matched: number;
    deleting: number;
    sparedHoldingWork: number;
    sparedFacultyOrAdmin: number;
  };
  /** Rows the two deletes would reach, per table. */
  perTable: Record<string, number>;
  /** Uploaded files whose rows go but whose objects stay in Blob storage. */
  orphanedUploads: number;
  classes: number;
};

const n = async (q: Promise<{ c: number | string }[]>) => Number((await q)[0]?.c ?? 0);

/** Which accounts the options name, and which of those are spared. */
async function chooseAccounts(o: CleanupOptions) {
  if (!o.domain) return { ids: [] as string[], matched: 0, work: 0, faculty: 0 };
  const suffix = `%@${o.domain.trim().toLowerCase().replace(/^@/, "")}`;
  const rows = await db().select({ userId: identities.userId, role: users.systemRole })
    .from(identities).innerJoin(users, eq(users.id, identities.userId))
    .where(and(eq(identities.provider, "password"), like(identities.subject, suffix)));
  const all = [...new Set(rows.map((r) => r.userId))];
  if (!all.length) return { ids: [], matched: 0, work: 0, faculty: 0 };

  // Faculty and admins: an admin account, or anyone who teaches anything.
  const admins = new Set(rows.filter((r) => r.role === "admin").map((r) => r.userId));
  const teaching = new Set((await db().select({ userId: enrolments.userId }).from(enrolments)
    .where(and(inArray(enrolments.userId, all), eq(enrolments.role, "instructor")))).map((r) => r.userId));
  const privileged = new Set([...admins, ...teaching]);

  // Work: an exam attempt, a submission, or a grade recorded against one of their enrolments.
  const enrs = await db().select({ id: enrolments.id, userId: enrolments.userId }).from(enrolments)
    .where(inArray(enrolments.userId, all));
  const ofEnrolment = new Map(enrs.map((e) => [e.id, e.userId]));
  const ids = enrs.map((e) => e.id);
  const holders = new Set<string>();
  if (ids.length) {
    for (const table of [examAttempts, submissions, lineItemScores]) {
      const rows2 = await db().select({ enrolmentId: (table as typeof submissions).enrolmentId })
        .from(table as typeof submissions)
        .where(inArray((table as typeof submissions).enrolmentId, ids));
      for (const r of rows2) { const u = ofEnrolment.get(r.enrolmentId); if (u) holders.add(u); }
    }
  }

  const keep = (u: string) =>
    (o.includeFaculty || !privileged.has(u)) && (o.includeWork || !holders.has(u));
  return {
    ids: all.filter(keep),
    matched: all.length,
    work: all.filter((u) => holders.has(u)).length,
    faculty: all.filter((u) => privileged.has(u)).length,
  };
}

/**
 * What the deletes would reach. Counted, never guessed: the dry run and `--apply` print the same
 * numbers from the same code.
 */
async function countEverything(userIds: string[], sectionId: string | null) {
  const perTable: Record<string, number> = {};
  const put = (t: string, v: number) => { if (v) perTable[t] = (perTable[t] ?? 0) + v; };
  const hasUsers = userIds.length > 0;

  // --- the accounts, and everything hanging off them
  if (hasUsers) {
    put("users", userIds.length);
    put("identities", await n(db().select({ c: count() }).from(identities).where(inArray(identities.userId, userIds))));
    put("sessions", await n(db().select({ c: count() }).from(sessions).where(inArray(sessions.userId, userIds))));
    put("auth_tokens", await n(db().select({ c: count() }).from(authTokens).where(inArray(authTokens.userId, userIds))));
    put("library_uploads", await n(db().select({ c: count() }).from(libraryUploads).where(inArray(libraryUploads.uploadedBy, userIds))));
    for (const [name, table, col] of [
      ["sim_launches", simLaunches, simLaunches.userId],
      ["sim_completions", simCompletions, simCompletions.userId],
      ["sim_transcripts", simTranscripts, simTranscripts.userId],
      ["sim_previews", simPreviews, simPreviews.userId],
    ] as const) {
      put(name, await n(db().select({ c: count() }).from(table as never).where(inArray(col as never, userIds))));
    }
  }

  // --- the enrolments those accounts hold, plus (if named) the whole class
  const enrWhere = [
    ...(hasUsers ? [inArray(enrolments.userId, userIds)] : []),
    ...(sectionId ? [eq(enrolments.sectionId, sectionId)] : []),
  ];
  const enrs = enrWhere.length
    ? await db().select({ id: enrolments.id }).from(enrolments).where(or(...enrWhere))
    : [];
  const enrIds = enrs.map((e) => e.id);
  put("enrolments", enrIds.length);
  if (enrIds.length) {
    put("bookmarks", await n(db().select({ c: count() }).from(bookmarks).where(inArray(bookmarks.enrolmentId, enrIds))));
    put("line_item_scores", await n(db().select({ c: count() }).from(lineItemScores).where(inArray(lineItemScores.enrolmentId, enrIds))));
    const subs = await db().select({ id: submissions.id }).from(submissions).where(inArray(submissions.enrolmentId, enrIds));
    put("submissions", subs.length);
    if (subs.length) put("submission_files", await n(db().select({ c: count() }).from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id)))));
    const atts = await db().select({ id: examAttempts.id }).from(examAttempts).where(inArray(examAttempts.enrolmentId, enrIds));
    put("exam_attempts", atts.length);
    if (atts.length) put("exam_responses", await n(db().select({ c: count() }).from(examResponses).where(inArray(examResponses.attemptId, atts.map((a) => a.id)))));
  }

  // --- the class's own furniture
  if (sectionId) {
    put("sections", 1);
    const asgs = await db().select({ id: assignments.id }).from(assignments).where(eq(assignments.sectionId, sectionId));
    put("assignments", asgs.length);
    if (asgs.length) put("assignment_files", await n(db().select({ c: count() }).from(assignmentFiles).where(inArray(assignmentFiles.assignmentId, asgs.map((a) => a.id)))));
    const exs = await db().select({ id: exams.id }).from(exams).where(eq(exams.sectionId, sectionId));
    put("exams", exs.length);
    const lis = await db().select({ id: lineItems.id }).from(lineItems).where(eq(lineItems.sectionId, sectionId));
    put("line_items", lis.length);
    if (lis.length) put("line_item_outcome_map", await n(db().select({ c: count() }).from(lineItemOutcomeMap).where(inArray(lineItemOutcomeMap.lineItemId, lis.map((l) => l.id)))));
    const outs = await db().select({ id: sectionOutcomes.id }).from(sectionOutcomes).where(eq(sectionOutcomes.sectionId, sectionId));
    put("section_outcomes", outs.length);
    if (outs.length) {
      put("outcome_objective_map", await n(db().select({ c: count() }).from(outcomeObjectiveMap).where(inArray(outcomeObjectiveMap.outcomeId, outs.map((o) => o.id)))));
      put("outcome_program_map", await n(db().select({ c: count() }).from(outcomeProgramMap).where(inArray(outcomeProgramMap.outcomeId, outs.map((o) => o.id)))));
    }
    for (const [name, table, col] of [
      ["grading_categories", gradingCategories, gradingCategories.sectionId],
      ["letter_scales", letterScales, letterScales.sectionId],
      ["roster_invites", rosterInvites, rosterInvites.sectionId],
      ["section_content_pins", sectionContentPins, sectionContentPins.sectionId],
      ["announcements", announcements, announcements.sectionId],
      ["section_syllabus", sectionSyllabus, sectionSyllabus.sectionId],
      ["schedule_items", scheduleItems, scheduleItems.sectionId],
      ["aol_settings", aolSettings, aolSettings.sectionId],
      ["lti_links", ltiLinks, ltiLinks.sectionId],
      ["class_sims", classSims, classSims.sectionId],
    ] as const) {
      put(name, await n(db().select({ c: count() }).from(table as never).where(eq(col as never, sectionId))));
    }
  }

  const orphanedUploads = (perTable["submission_files"] ?? 0) + (perTable["assignment_files"] ?? 0) + (perTable["library_uploads"] ?? 0);
  return { perTable, orphanedUploads };
}

export async function planCleanup(o: CleanupOptions): Promise<CleanupPlan> {
  if (o.domain && !domainAllowed(o.domain)) {
    throw new Error(`"${o.domain}" is not a reserved test domain. Allowed: ${TEST_SUFFIXES.join(", ")}.`);
  }
  if (!o.domain && !o.sectionId) throw new Error("Nothing to do: give --domain, --class, or both.");
  const chosen = await chooseAccounts(o);
  const sectionId = o.sectionId ?? null;
  if (sectionId) {
    const found = await db().select({ id: sections.id }).from(sections).where(eq(sections.id, sectionId)).limit(1);
    if (!found[0]) throw new Error("No class with that id.");
  }
  const { perTable, orphanedUploads } = await countEverything(chosen.ids, sectionId);
  return {
    domain: o.domain ?? null,
    sectionId,
    accounts: {
      matched: chosen.matched, deleting: chosen.ids.length,
      sparedHoldingWork: o.includeWork ? 0 : chosen.work,
      sparedFacultyOrAdmin: o.includeFaculty ? 0 : chosen.faculty,
    },
    perTable, orphanedUploads,
    classes: sectionId ? 1 : 0,
  };
}

/**
 * Do it. Two statements inside one transaction, because the cascade does the rest: a half-finished
 * clean-up would be worse than none.
 */
export async function applyCleanup(o: CleanupOptions): Promise<CleanupPlan> {
  const plan = await planCleanup(o);
  const ids = (await chooseAccounts(o)).ids;
  await db().transaction(async (tx) => {
    if (plan.sectionId) await tx.delete(sections).where(eq(sections.id, plan.sectionId));
    if (ids.length) await tx.delete(users).where(inArray(users.id, ids));
  });
  return plan;
}

/** A census of every table, for proving afterwards that nothing dangles. */
export async function tableCensus(tables: readonly string[]) {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await db().execute(sql.raw(`select count(*)::int as c from "${t}"`));
    const rows = (r as unknown as { rows?: { c: number }[] }).rows ?? (r as unknown as { c: number }[]);
    out[t] = Number(rows[0].c);
  }
  return out;
}
