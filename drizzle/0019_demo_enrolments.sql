-- Spec 18: D2L's built-in "Demo Student" becomes a real student enrolment, flagged.
--
-- A flag on the enrolment rather than a new role. A role of 'demo' would silently drop the demo
-- out of every existing `role = 'student'` query — including the gradebook and the grade export,
-- which must keep it so the file still matches D2L's own row — and it would read the book anyway.
-- The flag is additive: every existing query keeps working, and only the handful of statistics
-- that must leave a demo out say so.
--
-- It belongs on the enrolment because being a demo is a fact about taking part in one class, not
-- about the person: the same account could be a demo in one class and nothing in another.
ALTER TABLE "enrolments" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "enrolments_section_demo_idx" ON "enrolments" USING btree ("section_id","is_demo");
