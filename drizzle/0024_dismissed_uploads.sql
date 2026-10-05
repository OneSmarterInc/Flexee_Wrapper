-- Spec 22 §2: dismiss an upload record.
--
-- An upload record is a receipt, not a book. A failed or stopped one has served its purpose once
-- the problem is fixed, and a ready one that nobody added is a decision taken by not acting. None
-- of them can be removed today, so the list only grows.
--
-- Soft and reversible by design: the row stays, with the time and the person, so "who dismissed
-- this and when" is answerable. Nothing in Blob storage is touched — the zip is still there.
--
-- A record for a book already added to the library is history and is never dismissible; that is
-- enforced in the library, not here, because the condition is the row's own status.
ALTER TABLE "library_uploads" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "library_uploads" ADD COLUMN "dismissed_by" text;--> statement-breakpoint
ALTER TABLE "library_uploads" ADD CONSTRAINT "library_uploads_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
