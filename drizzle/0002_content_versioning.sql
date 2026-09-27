CREATE TABLE "chapter_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"kind" text DEFAULT 'feature' NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"manifest_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_content_pins" (
	"section_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"version_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_content_pins" ADD CONSTRAINT "section_content_pins_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_content_pins" ADD CONSTRAINT "section_content_pins_version_id_chapter_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_versions_book_entry_version_uq" ON "chapter_versions" USING btree ("book_id","entry_id","version");--> statement-breakpoint
CREATE INDEX "chapter_versions_book_entry_idx" ON "chapter_versions" USING btree ("book_id","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_pins_section_entry_uq" ON "section_content_pins" USING btree ("section_id","entry_id");