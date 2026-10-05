-- Spec 19 §2: a log of who did what to a class list.
--
-- Counts only. There is no column for a name, an address or a student's id, so rule 9 ("the log
-- holds counts only") is true by construction rather than by review. `actor_id` is the one id here,
-- and it identifies a member of staff acting in their own class.
--
-- `detail_json` carries numbers: {"attempts":12,"submissions":4,"scores":9,"skipped":2}. Nothing
-- reads it as anything else, and nothing writes anything else into it.
CREATE TABLE "class_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"detail_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_actions" ADD CONSTRAINT "class_actions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_actions" ADD CONSTRAINT "class_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_actions_section_idx" ON "class_actions" USING btree ("section_id","created_at");
