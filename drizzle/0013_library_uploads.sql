-- Book uploads into the library. One row per uploaded book zip; the intake runs in GitHub Actions
-- and writes its result here. Status: checking -> ready | stopped | failed; ready -> publishing ->
-- published | failed.
CREATE TABLE IF NOT EXISTS "library_uploads" (
  "id" text PRIMARY KEY NOT NULL,
  "book_id" text NOT NULL,
  "uploaded_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blob_path" text NOT NULL,
  "file_name" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "status" text DEFAULT 'checking' NOT NULL,
  "report" text,
  "register_version" text,
  "run_url" text,
  "message" text,
  "published_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_uploads_book_idx" ON "library_uploads" ("book_id", "created_at");
