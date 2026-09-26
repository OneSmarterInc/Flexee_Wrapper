CREATE TABLE "line_item_scores" (
	"line_item_id" text NOT NULL,
	"enrolment_id" text NOT NULL,
	"points" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"title" text NOT NULL,
	"max_points" integer NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "line_item_scores" ADD CONSTRAINT "line_item_scores_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_scores" ADD CONSTRAINT "line_item_scores_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_item_scores_item_enrolment_uq" ON "line_item_scores" USING btree ("line_item_id","enrolment_id");--> statement-breakpoint
CREATE INDEX "line_items_section_idx" ON "line_items" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "line_items_section_ref_uq" ON "line_items" USING btree ("section_id","ref_id");