-- RapidSims behind the front door (Flexee Systems Map, contract C2). The catalogue of sims, preview
-- grants before publication, the sims each class uses, and what sims report back: launches,
-- completions and instructor transcripts. Mirrors the frozen RapidSims platform so sims need no change.
CREATE TABLE IF NOT EXISTS "sims" (
  "id" text PRIMARY KEY NOT NULL,
  "number" integer,
  "title" text NOT NULL,
  "tagline" text,
  "description" text,
  "minutes" integer,
  "launch_url" text,
  "published" boolean DEFAULT false NOT NULL,
  "detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sims_number_uq" ON "sims" ("number") WHERE "number" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_previews" (
  "sim_id" text NOT NULL REFERENCES "sims"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "granted_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sim_previews_pk" ON "sim_previews" ("sim_id", "user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "class_sims" (
  "section_id" text NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "sim_id" text NOT NULL REFERENCES "sims"("id") ON DELETE CASCADE,
  "added_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "class_sims_pk" ON "class_sims" ("section_id", "sim_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_launches" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sim_id" text NOT NULL REFERENCES "sims"("id") ON DELETE CASCADE,
  "section_id" text REFERENCES "sections"("id") ON DELETE SET NULL,
  "as_role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sim_launches_user_sim_idx" ON "sim_launches" ("user_id", "sim_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_completions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sim_id" text NOT NULL REFERENCES "sims"("id") ON DELETE CASCADE,
  "section_id" text REFERENCES "sections"("id") ON DELETE SET NULL,
  "duration_seconds" integer,
  "summary" text,
  "metrics" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sim_completions_section_idx" ON "sim_completions" ("section_id", "sim_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_transcripts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sim_id" text NOT NULL REFERENCES "sims"("id") ON DELETE CASCADE,
  "section_id" text REFERENCES "sections"("id") ON DELETE SET NULL,
  "sim_version" text,
  "envelope" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
