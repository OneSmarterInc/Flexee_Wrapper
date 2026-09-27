CREATE TABLE "roster_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "roster_invites" ADD CONSTRAINT "roster_invites_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_invites_section_email_uq" ON "roster_invites" USING btree ("section_id","email");--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;