-- Spec 11: grading categories and retake rules. A class's syllabus grading - weighted categories,
-- optional drop-lowest, a letter scale - plus which attempt of a quiz or exam counts.
-- Everything here is additive and defaulted so a class with no categories grades exactly as before:
-- line_items.category_id stays NULL, and existing exams keep today's behaviour via 'latest'.
CREATE TABLE IF NOT EXISTS "grading_categories" (
  "id" text PRIMARY KEY NOT NULL,
  "section_id" text NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "weight" real DEFAULT 0 NOT NULL,
  "drop_lowest" integer DEFAULT 0 NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grading_categories_section_idx" ON "grading_categories" ("section_id");--> statement-breakpoint

-- Every gradebook column belongs to at most one category. NULL means "not categorised", which is
-- also what every existing row is, so today's whole-gradebook weighting still applies to it.
ALTER TABLE "line_items" ADD COLUMN IF NOT EXISTS "category_id" text REFERENCES "grading_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_items_category_idx" ON "line_items" ("category_id");--> statement-breakpoint

-- One letter scale per class, as an ordered list of {letter, min} bands in JSON. Absent means the
-- default A/B/C/D/F scale, so a class need not have a row to show letters.
CREATE TABLE IF NOT EXISTS "letter_scales" (
  "section_id" text PRIMARY KEY NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "bands_json" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- A quiz and an exam differ only in how they default, so one discriminator covers it.
-- Every existing row is an exam.
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'exam' NOT NULL;--> statement-breakpoint

-- Which attempt reaches the gradebook: highest | latest | average | first. Existing rows default to
-- 'latest' because that is what the gradebook has always used, so no grade moves when this ships.
-- New quizzes are created with 'highest' and new exams with 'first', in application code.
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "counted_attempt" text DEFAULT 'latest' NOT NULL;
