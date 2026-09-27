CREATE TABLE "exam_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"enrolment_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"served_json" text NOT NULL,
	"score" integer,
	"max_points" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"selected_option_id" text,
	"correct" boolean DEFAULT false NOT NULL,
	"points" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"title" text NOT NULL,
	"blueprint_json" text NOT NULL,
	"time_limit_min" integer,
	"attempt_limit" integer DEFAULT 1 NOT NULL,
	"feedback" text DEFAULT 'after_close' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"chapter" integer NOT NULL,
	"section" text,
	"objective" text NOT NULL,
	"type" text DEFAULT 'multiple_choice' NOT NULL,
	"difficulty" text NOT NULL,
	"stem" text NOT NULL,
	"options_json" text NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"shuffle_options" boolean DEFAULT true NOT NULL,
	"tags_json" text,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_responses" ADD CONSTRAINT "exam_responses_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_exam_idx" ON "exam_attempts" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "attempts_enrolment_idx" ON "exam_attempts" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "responses_attempt_idx" ON "exam_responses" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "responses_question_idx" ON "exam_responses" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "exams_section_idx" ON "exams" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "questions_book_chapter_idx" ON "questions" USING btree ("book_id","chapter");