-- Spec 20: the course-grounded student assistant.
--
-- Five tables and one column. Everything is keyed on `enrolment_id` rather than `user_id`, so a
-- student's threads die with their enrolment exactly as their bookmarks, submissions and attempts
-- do: one `DELETE FROM users` or `DELETE FROM sections` still reaches all of it, and the Spec 18
-- clean-up needs no special case.
--
-- `assistant_usage` is the exception that proves the rule: its `enrolment_id` is ON DELETE SET
-- NULL, because the retention job deletes threads while the usage they generated must survive to
-- keep a class's monthly total honest. It holds no content -- a class, a day, a model, two token
-- counts and an estimated cost -- so nothing private outlives the retention window.
CREATE TABLE "assistant_settings" (
	"section_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"daily_per_student" integer DEFAULT 20 NOT NULL,
	"monthly_token_cap" integer DEFAULT 2000000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"enrolment_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"citations_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"enrolment_id" text,
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"section_id" text NOT NULL,
	"enrolment_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"answered_by" text
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "assistant_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_threads_section_idx" ON "assistant_threads" USING btree ("section_id","last_message_at");--> statement-breakpoint
CREATE INDEX "assistant_threads_enrolment_idx" ON "assistant_threads" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "assistant_threads_retention_idx" ON "assistant_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_thread_idx" ON "assistant_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_usage_section_day_idx" ON "assistant_usage" USING btree ("section_id","day");--> statement-breakpoint
CREATE INDEX "assistant_usage_enrolment_day_idx" ON "assistant_usage" USING btree ("enrolment_id","day");--> statement-breakpoint
CREATE INDEX "assistant_questions_section_status_idx" ON "assistant_questions" USING btree ("section_id","status");
