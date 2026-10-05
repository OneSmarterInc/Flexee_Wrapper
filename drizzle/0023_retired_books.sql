-- Spec 22 §1: retire a book — soft, reversible, admin-only.
--
-- A row here, rather than a field in the book's manifest, for one reason: the intake rewrites
-- book.manifest.json on every re-upload, so a flag written there would be wiped the next time the
-- book went through. There is no books table to add a column to either — listBooks() walks the
-- content store and reads each manifest — so the book id is the key, as it is everywhere else in
-- the schema (sections.book_id, questions.book_id, chapter_versions.book_id are all plain text).
--
-- Present means retired. Nothing is deleted, in storage or here: a class already using the book
-- keeps working unchanged, because the reading path resolves a book by id and never consults a
-- list. What retirement changes is that the book stops appearing in the pickers.
CREATE TABLE "retired_books" (
	"book_id" text PRIMARY KEY NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" text
);
--> statement-breakpoint
ALTER TABLE "retired_books" ADD CONSTRAINT "retired_books_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
