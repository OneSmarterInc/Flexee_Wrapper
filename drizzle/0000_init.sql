CREATE TABLE "bookmarks" (
	"enrolment_id" text NOT NULL,
	"book_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"chapter_version" integer DEFAULT 1 NOT NULL,
	"section_anchor" text,
	"scroll" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrolments" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"name" text NOT NULL,
	"join_code" text,
	"external_context_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_enrolment_book_uq" ON "bookmarks" USING btree ("enrolment_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_section_user_uq" ON "enrolments" USING btree ("section_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_uq" ON "identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_join_code_uq" ON "sections" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");