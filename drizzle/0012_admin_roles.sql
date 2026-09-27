-- Admin role, faculty invites, and per-class book publishing.
-- users.system_role: 'admin' can create classes and add faculty and students to any class; 'user' otherwise.
ALTER TABLE "users" ADD COLUMN "system_role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
-- An invite now carries the role the person gets on joining: 'student' (as before) or 'instructor'.
ALTER TABLE "roster_invites" ADD COLUMN "role" text DEFAULT 'student' NOT NULL;--> statement-breakpoint
-- A class's book is visible to its students only once the class's faculty publish it (step 2).
-- Existing classes were already live, so they count as published.
ALTER TABLE "sections" ADD COLUMN "book_published_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sections" SET "book_published_at" = "created_at" WHERE "book_published_at" IS NULL;
