-- Spec 27 B1, decision 1 (Addendum B §1): access release — the Wrapper's replacement for the old
-- platform's `paid` flag on an enrolment.
--
-- Not named `paid`, by instruction, and the old platform's own schema says why: "No payment tables
-- — money is handled outside the system and lands here as a 'paid' flag." Nothing here takes
-- payment either. What is released is a student's place in one class, which unlocks every
-- simulation in it: per student, per class, never per sim and never per run.
--
-- A timestamp rather than a boolean, matching withdrawn_at: null means not released. The three
-- columns together answer "who released this, when, and against what paperwork", which is what the
-- old platform's paid_at / paid_by / paid_note existed for. The note is faculty-only: it never
-- appears in the roster response and never leaves the Wrapper.
--
-- This gates launching a simulation and nothing else. Reading the book, exams and assignments are
-- granted by the enrolment itself and are deliberately untouched: a student invited today must be
-- able to open their book today.
--
-- A CORRECTION TO THIS FILE MUST BE A NEW MIGRATION, NEVER AN EDIT. drizzle's migrator records
-- each file's hash but selects what to apply by comparing the journal's `when` against the newest
-- row in __drizzle_migrations (drizzle-orm/pg-core/dialect.js), so it never compares that hash
-- again. Editing this file after it has run is therefore not detected and not re-applied: the edit
-- silently never happens, and the database keeps whatever the first version did. If the backfill
-- below turns out to be wrong, fix it in 0027 and leave this alone.
ALTER TABLE "enrolments" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "released_by" text;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "released_note" text;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrolments_section_released_idx" ON "enrolments" USING btree ("section_id","released_at");--> statement-breakpoint
-- Decision 1: new enrolments are not released; existing ones are. Every row that exists when this
-- runs was created when any enrolled student could launch any simulation in their class, so
-- released_at = created_at is the literal truth rather than a convenient backdate. now() would
-- claim an act that nobody performed today. created_at is NOT NULL (0000_init.sql) and has never
-- been altered, so no COALESCE is needed and no row can be skipped by a null.
--
-- released_by stays null because no person did it, and the note says so — otherwise a null
-- released_by on a released row cannot be told from the other way it happens: released_by is
-- ON DELETE SET NULL, so a real release by a since-deleted account also leaves it null.
UPDATE "enrolments"
   SET "released_at" = "created_at",
       "released_note" = 'Released by migration 0025: this class had open simulation access before release existed.'
 WHERE "released_at" IS NULL;
