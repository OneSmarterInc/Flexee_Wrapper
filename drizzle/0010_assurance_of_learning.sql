CREATE TABLE "aol_settings" (
	"section_id" text PRIMARY KEY NOT NULL,
	"program" text,
	"meets_pct" integer DEFAULT 70 NOT NULL,
	"exceeds_pct" integer DEFAULT 85 NOT NULL,
	"target_pct" integer DEFAULT 70 NOT NULL,
	"min_n" integer DEFAULT 5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_item_outcome_map" (
	"line_item_id" text NOT NULL,
	"outcome_id" text NOT NULL,
	"evidence_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_program_map" (
	"outcome_id" text NOT NULL,
	"program_outcome_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"program" text NOT NULL,
	"framework" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"source_url" text,
	"captured_at" text
);
--> statement-breakpoint
ALTER TABLE "aol_settings" ADD CONSTRAINT "aol_settings_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_outcome_map" ADD CONSTRAINT "line_item_outcome_map_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_outcome_map" ADD CONSTRAINT "line_item_outcome_map_outcome_id_section_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."section_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_program_map" ADD CONSTRAINT "outcome_program_map_outcome_id_section_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."section_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_program_map" ADD CONSTRAINT "outcome_program_map_program_outcome_id_program_outcomes_id_fk" FOREIGN KEY ("program_outcome_id") REFERENCES "public"."program_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_item_outcome_uq" ON "line_item_outcome_map" USING btree ("line_item_id","outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_program_uq" ON "outcome_program_map" USING btree ("outcome_id","program_outcome_id");--> statement-breakpoint
CREATE INDEX "program_outcomes_program_idx" ON "program_outcomes" USING btree ("program");