-- Assignments and case studies, with student submissions graded by faculty (scores go to the gradebook
-- as a line item of kind 'assignment'). Files are stored in private Blob storage; these rows record them.
CREATE TABLE IF NOT EXISTS "assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "section_id" text NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "kind" text DEFAULT 'assignment' NOT NULL,
  "title" text NOT NULL,
  "instructions" text DEFAULT '' NOT NULL,
  "due_at" timestamp with time zone,
  "points" integer NOT NULL,
  "allow_late" boolean DEFAULT true NOT NULL,
  "published" boolean DEFAULT false NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_section_idx" ON "assignments" ("section_id", "due_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignment_files" (
  "id" text PRIMARY KEY NOT NULL,
  "assignment_id" text NOT NULL REFERENCES "assignments"("id") ON DELETE CASCADE,
  "blob_path" text NOT NULL,
  "file_name" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submissions" (
  "id" text PRIMARY KEY NOT NULL,
  "assignment_id" text NOT NULL REFERENCES "assignments"("id") ON DELETE CASCADE,
  "enrolment_id" text NOT NULL REFERENCES "enrolments"("id") ON DELETE CASCADE,
  "text" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'submitted' NOT NULL,
  "late" boolean DEFAULT false NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "score" real,
  "feedback" text,
  "graded_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "graded_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_assignment_enrolment_uq" ON "submissions" ("assignment_id", "enrolment_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission_files" (
  "id" text PRIMARY KEY NOT NULL,
  "submission_id" text NOT NULL REFERENCES "submissions"("id") ON DELETE CASCADE,
  "blob_path" text NOT NULL,
  "file_name" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
