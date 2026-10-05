-- Spec 19 §1: withdrawal — soft, reversible, and the opposite of Remove.
--
-- The enrolment stays with every record hanging off it: attempts, submissions, grades, the reading
-- position, the assistant's threads. What changes is that the student loses access to the class and
-- drops out of every statistic, head count, bulk action and export until they are restored.
--
-- On the enrolment rather than the user, because it is a fact about taking part in one class. Null
-- means active, which is every existing row.
ALTER TABLE "enrolments" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "withdrawn_by" text;--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrolments_section_withdrawn_idx" ON "enrolments" USING btree ("section_id","withdrawn_at");
