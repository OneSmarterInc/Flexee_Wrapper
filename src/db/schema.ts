import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  real,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The reading model — the first migration.
 *
 * Design decisions this encodes (from the platform brief):
 *  - Entitlement lives on the ENROLMENT, never on the user. Reading a book is
 *    allowed because you are enrolled in a section that adopted it.
 *  - One identity, many enrolments. A person is one `users` row; how they sign
 *    in is one or more `identities` rows (today: password; later: an LTI subject).
 *  - Sections carry a nullable `external_context_id` — the seam an LMS section
 *    populates later. Empty for a section a faculty member created here.
 *  - Bookmarks pin to the chapter VERSION they were made against plus the stable
 *    cNsM section anchor, so a future republish can't silently move a bookmark.
 *
 * Deferred to later migrations (not needed to read): chapter_versions and
 * section_content_pins (faculty console / per-section version pinning), and
 * line_items (assessment / gradebook). The bookmark records the version as a
 * plain integer for now, which is forward-compatible with those tables.
 */

// A person. Sign-in method lives in `identities`, not here.
export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Pluggable identity: (provider, subject) is unique; password identities keep a hash.
export const identities = pgTable(
  "identities",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'password' | later 'lti'
    subject: text("subject").notNull(),   // email for password; LMS subject for lti
    passwordHash: text("password_hash"),  // null for non-password providers
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("identities_provider_subject_uq").on(t.provider, t.subject)],
);

// Server-side sessions; the cookie holds only this id.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // random token
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// A section adopts one book (the cheap version of "adoption"). `externalContextId`
// is the LTI seam; `joinCode` supports self-enrolment by code later.
export const sections = pgTable(
  "sections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    bookId: text("book_id").notNull(),          // matches content/<book-id>
    name: text("name").notNull(),
    joinCode: text("join_code"),
    term: text("term"),                             // e.g. "2027 Spring" — for the course dashboard
    externalContextId: text("external_context_id"), // nullable — LTI seam
    createdBy: text("created_by").references((): any => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sections_join_code_uq").on(t.joinCode)],
);

// Entitlement. A user enrolled in a section can read that section's book.
export const enrolments = pgTable(
  "enrolments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("student"), // 'student' | 'instructor'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("enrolments_section_user_uq").on(t.sectionId, t.userId)],
);

// One reading position per enrolment per book. Pinned to chapter version + anchor.
export const bookmarks = pgTable(
  "bookmarks",
  {
    enrolmentId: text("enrolment_id").notNull().references(() => enrolments.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    entryId: text("entry_id").notNull(),          // e.g. ch05, preface
    chapterVersion: integer("chapter_version").notNull().default(1),
    sectionAnchor: text("section_anchor"),        // cNsM, nullable
    scroll: real("scroll").notNull().default(0),  // 0..1 fraction within the entry
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("bookmarks_enrolment_book_uq").on(t.enrolmentId, t.bookId)],
);

// Roster invites: a CSV upload creates one of these per emailed student before
// they have an account. On sign-in, invites matching the user's email become
// enrolments (see lib/roster.claimInvites). Self-enrolment by join code is the
// other route; both end as an `enrolments` row.
export const rosterInvites = pgTable(
  "roster_invites",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("roster_invites_section_email_uq").on(t.sectionId, t.email)],
);

// A stored, immutable version of one entry's content. The working content tree
// is the latest draft; publishing snapshots it here so two sections can read two
// different Chapter 5s, both correct. `kind` distinguishes an errata fix (pushed
// automatically) from a feature upgrade (gated behind instructor review).
export const chapterVersions = pgTable(
  "chapter_versions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    bookId: text("book_id").notNull(),
    entryId: text("entry_id").notNull(),
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull().default("feature"), // 'feature' | 'errata'
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    manifestJson: text("manifest_json").notNull(), // the entry manifest, serialized
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("chapter_versions_book_entry_version_uq").on(t.bookId, t.entryId, t.version),
    index("chapter_versions_book_entry_idx").on(t.bookId, t.entryId),
  ],
);

// What version each section reads for each entry. "The manifest is the heart of it."
export const sectionContentPins = pgTable(
  "section_content_pins",
  {
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull(),
    versionId: text("version_id").notNull().references(() => chapterVersions.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("section_pins_section_entry_uq").on(t.sectionId, t.entryId)],
);

// --- Assessment (question bank + exams) ---

// One item from the bank. `id` is the stable bank id (<book>-cNN-nnn); ingested
// and updated from content/<book>/questions.json, deduped by content hash.
export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
    chapter: integer("chapter").notNull(),
    section: text("section"),
    objective: text("objective").notNull(),
    objectiveId: text("objective_id"),  // -> learning_objectives.id (nullable during migration)
    type: text("type").notNull().default("multiple_choice"),
    difficulty: text("difficulty").notNull(), // recall | apply | analyse
    stem: text("stem").notNull(),
    optionsJson: text("options_json").notNull(), // [{id,text,correct,rationale}]
    points: integer("points").notNull().default(1),
    shuffleOptions: boolean("shuffle_options").notNull().default(true),
    tagsJson: text("tags_json"),
    metaJson: text("meta_json"),               // structured metadata: use, style, context, figure, review, source
    contentHash: text("content_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("questions_book_chapter_idx").on(t.bookId, t.chapter)],
);

// An exam an instructor assembles for a section. `blueprintJson` is either a draw
// spec {mode:"draw", rules:[{chapter,difficulty,count}]} or {mode:"fixed", ids:[]}.
export const exams = pgTable(
  "exams",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    blueprintJson: text("blueprint_json").notNull(),
    timeLimitMin: integer("time_limit_min"),
    attemptLimit: integer("attempt_limit").notNull().default(1),
    feedback: text("feedback").notNull().default("after_close"), // immediate | after_close
    status: text("status").notNull().default("draft"), // draft | open | closed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("exams_section_idx").on(t.sectionId)],
);

// A student's attempt. `servedJson` records the exact questions and option order
// served to this student, so scoring and review are stable and reproducible.
export const examAttempts = pgTable(
  "exam_attempts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    enrolmentId: text("enrolment_id").notNull().references(() => enrolments.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    servedJson: text("served_json").notNull(),
    score: integer("score"),
    maxPoints: integer("max_points").notNull(),
  },
  (t) => [index("attempts_exam_idx").on(t.examId), index("attempts_enrolment_idx").on(t.enrolmentId)],
);

export const examResponses = pgTable(
  "exam_responses",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    attemptId: text("attempt_id").notNull().references(() => examAttempts.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    selectedOptionId: text("selected_option_id"),
    correct: boolean("correct").notNull().default(false),
    points: integer("points").notNull().default(0),
  },
  (t) => [index("responses_attempt_idx").on(t.attemptId), index("responses_question_idx").on(t.questionId)],
);

// --- Learning objectives & syllabus alignment (assessment of learning) ---

// A book's learning objectives — its "catalog substance". Questions attach to one,
// so results aggregate into mastery instead of staying per-question. Authored with
// the book (content/<book>/objectives.json), like chapters and the question bank.
export const learningObjectives = pgTable(
  "learning_objectives",
  {
    id: text("id").primaryKey(),                 // <book>-cNN-oN
    bookId: text("book_id").notNull(),
    chapter: integer("chapter").notNull(),
    code: text("code"),                          // optional short code
    label: text("label").notNull(),              // the objective statement
    bloom: text("bloom"),                        // optional: recall | apply | analyse
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("objectives_book_chapter_idx").on(t.bookId, t.chapter)],
);

// A section's own syllabus outcomes (e.g. course learning outcomes, accreditation
// codes). Empty until a faculty member provides a syllabus — the adoption seam.
export const sectionOutcomes = pgTable(
  "section_outcomes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    code: text("code").notNull(),               // e.g. "CLO-3"
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("section_outcomes_section_idx").on(t.sectionId)],
);

// Maps a section's syllabus outcome to one or more book objectives, so mastery of
// objectives rolls up to the faculty member's own outcomes.
export const outcomeObjectiveMap = pgTable(
  "outcome_objective_map",
  {
    outcomeId: text("outcome_id").notNull().references(() => sectionOutcomes.id, { onDelete: "cascade" }),
    objectiveId: text("objective_id").notNull().references(() => learningObjectives.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("outcome_objective_uq").on(t.outcomeId, t.objectiveId)],
);

// --- Gradebook (line items for anything gradeable) ---

// One gradebook column. An exam registers here as kind 'exam' (refId = exam id);
// a faculty member can also add kind 'manual' columns (participation, an offline
// assignment). Weight is per section, set by the adopter — nothing assumes a split.
// This is also the LTI line-item seam: each row maps to a gradebook column later.
export const lineItems = pgTable(
  "line_items",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'exam' | 'manual'
    refId: text("ref_id"),        // exam id when kind = 'exam'
    title: text("title").notNull(),
    maxPoints: integer("max_points").notNull(),
    weight: real("weight").notNull().default(1),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("line_items_section_idx").on(t.sectionId), uniqueIndex("line_items_section_ref_uq").on(t.sectionId, t.refId)],
);

// A recorded score for a student on a line item: manual entry for 'manual' items,
// or an override for an 'exam' item (otherwise the exam score is derived from the
// student's latest submitted attempt).
export const lineItemScores = pgTable(
  "line_item_scores",
  {
    lineItemId: text("line_item_id").notNull().references(() => lineItems.id, { onDelete: "cascade" }),
    enrolmentId: text("enrolment_id").notNull().references(() => enrolments.id, { onDelete: "cascade" }),
    points: real("points").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("line_item_scores_item_enrolment_uq").on(t.lineItemId, t.enrolmentId)],
);

// --- LTI 1.3 (attachment layer) ---

// A registered LMS platform (issuer + client). Populated when an institution
// registers Flexee as an external tool.
export const ltiPlatforms = pgTable(
  "lti_platforms",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    deploymentId: text("deployment_id"),
    authLoginUrl: text("auth_login_url").notNull(), // platform OIDC auth endpoint
    tokenUrl: text("token_url").notNull(),          // platform OAuth2 token endpoint (AGS)
    jwksUrl: text("jwks_url").notNull(),            // platform public keys
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lti_platforms_issuer_client_uq").on(t.issuer, t.clientId)],
);

// The tool's own signing keypair (serves JWKS; signs AGS client assertions).
export const ltiKeys = pgTable("lti_keys", {
  kid: text("kid").primaryKey(),
  publicJwk: text("public_jwk").notNull(),
  privatePkcs8: text("private_pkcs8").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Single-use nonces for launch replay protection.
export const ltiNonces = pgTable("lti_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Links a Flexee section to its LMS context + AGS endpoint, captured at launch.
export const ltiLinks = pgTable(
  "lti_links",
  {
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    platformId: text("platform_id").notNull().references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    contextId: text("context_id").notNull(),
    lineitemsUrl: text("lineitems_url"),  // AGS lineitems container
    nrpsUrl: text("nrps_url"),            // NRPS context memberships URL
    scopesJson: text("scopes_json"),      // granted AGS scopes
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lti_links_section_uq").on(t.sectionId)],
);

// --- Account recovery (password reset, email verification, rate limiting) ---

// Single-use, expiring tokens for reset and verification.
export const authTokens = pgTable(
  "auth_tokens",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'password_reset' | 'email_verify'
    email: text("email"),         // target email for verification
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

// Fixed-window rate limiter for auth endpoints.
export const rateCounters = pgTable("rate_counters", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

// --- Course scaffolding (announcements, syllabus, schedule) — the connective tissue ---

export const announcements = pgTable(
  "announcements",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("announcements_section_idx").on(t.sectionId)],
);

// One syllabus per section.
export const sectionSyllabus = pgTable("section_syllabus", {
  sectionId: text("section_id").primaryKey().references(() => sections.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// "What's due when" — dated items per section.
export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    kind: text("kind"),   // reading | exam | assignment | other
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("schedule_section_idx").on(t.sectionId)],
);

// --- Assurance of learning: program outcomes, mappings, evidence, benchmarks ---

// A program's declared outcomes (e.g. ABET student outcomes), captured with their source.
export const programOutcomes = pgTable(
  "program_outcomes",
  {
    id: text("id").primaryKey(),                 // e.g. "wsu-mis-bsb:SO1"
    program: text("program").notNull(),          // e.g. "wsu-mis-bsb"
    framework: text("framework").notNull(),      // e.g. "ABET student outcome"
    code: text("code").notNull(),                // e.g. "SO1"
    label: text("label").notNull(),
    sourceUrl: text("source_url"),
    capturedAt: text("captured_at"),             // date the text was captured from its source
  },
  (t) => [index("program_outcomes_program_idx").on(t.program)],
);

// A course outcome (syllabus) serves one or more program outcomes.
export const outcomeProgramMap = pgTable(
  "outcome_program_map",
  {
    outcomeId: text("outcome_id").notNull().references(() => sectionOutcomes.id, { onDelete: "cascade" }),
    programOutcomeId: text("program_outcome_id").notNull().references(() => programOutcomes.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("outcome_program_uq").on(t.outcomeId, t.programOutcomeId)],
);

// A gradebook column (simulation index, graded work) counted as evidence for a course outcome.
export const lineItemOutcomeMap = pgTable(
  "line_item_outcome_map",
  {
    lineItemId: text("line_item_id").notNull().references(() => lineItems.id, { onDelete: "cascade" }),
    outcomeId: text("outcome_id").notNull().references(() => sectionOutcomes.id, { onDelete: "cascade" }),
    evidenceType: text("evidence_type").notNull(), // "simulation" | "graded work"
  },
  (t) => [uniqueIndex("line_item_outcome_uq").on(t.lineItemId, t.outcomeId)],
);

// Benchmarks for a section's report.
export const aolSettings = pgTable("aol_settings", {
  sectionId: text("section_id").primaryKey().references(() => sections.id, { onDelete: "cascade" }),
  program: text("program"),                                        // which program's outcomes this course reports to
  meetsPct: integer("meets_pct").notNull().default(70),            // a student meets expectations at or above this score
  exceedsPct: integer("exceeds_pct").notNull().default(85),        // a student exceeds expectations at or above this score
  targetPct: integer("target_pct").notNull().default(70),          // the benchmark: share of students who should meet
  minN: integer("min_n").notNull().default(5),                     // below this, results are flagged as too few to conclude
});
