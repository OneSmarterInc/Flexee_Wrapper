CREATE TABLE "learning_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"chapter" integer NOT NULL,
	"code" text,
	"label" text NOT NULL,
	"bloom" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_objective_map" (
	"outcome_id" text NOT NULL,
	"objective_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "objective_id" text;--> statement-breakpoint
ALTER TABLE "outcome_objective_map" ADD CONSTRAINT "outcome_objective_map_outcome_id_section_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."section_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_objective_map" ADD CONSTRAINT "outcome_objective_map_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_outcomes" ADD CONSTRAINT "section_outcomes_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "objectives_book_chapter_idx" ON "learning_objectives" USING btree ("book_id","chapter");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_objective_uq" ON "outcome_objective_map" USING btree ("outcome_id","objective_id");--> statement-breakpoint
CREATE INDEX "section_outcomes_section_idx" ON "section_outcomes" USING btree ("section_id");