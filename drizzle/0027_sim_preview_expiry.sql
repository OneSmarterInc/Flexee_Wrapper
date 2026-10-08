-- Spec 27 B2, decision 3 (Addendum A §3, Addendum B §5): a faculty preview lasts seven days, one
-- per person per sim, ever, and only an administrator can reset it.
--
-- sim_previews today is the equivalent of the old platform's `sim_access` table — an administrator
-- granting a named person sight of an *unpublished* simulation, deliberately with no expiry, whose
-- own schema explains why: "a trial expires because it is a trial, but a review grant ends when the
-- sim is published or an admin revokes it." It is not the equivalent of its `previews` table, which
-- is the seven-day self-serve trial and has no counterpart here at all.
--
-- One table now carries both, told apart by expires_at alone: NULL is the permanent administrator
-- grant, a timestamp is a trial that ends. Every row that exists when this runs keeps its NULL, so
-- **nothing anyone holds today is shortened** — that was a condition of the decision, not a
-- convenience.
--
-- "Once per person per sim, ever" needs no new constraint. sim_previews_pk is already unique on
-- (sim_id, user_id), so a second start cannot insert; what it needs is for the second start to
-- *refuse* rather than quietly extend or silently do nothing. The old platform used
-- ON CONFLICT DO NOTHING there, which makes a second attempt look like success. That is in the
-- code, and it is the behaviour tested hardest.
--
-- The reset is recorded rather than performed by deleting the row and letting a fresh insert look
-- like a first start. Without reset_at an administrator could hand out unlimited seven-day trials
-- and leave no trace of having done so, and "once ever" would be true of the table and false of the
-- world.
--
-- The constraint is named, unlike granted_by's, which 0015 declared inline and left auto-named; the
-- newer migrations name theirs and this follows them.
--
-- A correction to this file must be a new migration, never an edit, for the reason written out at
-- length in 0025: drizzle compares the journal's timestamp against the newest applied row and never
-- re-compares the recorded hash, so an edit to an applied migration silently never runs.
ALTER TABLE "sim_previews" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sim_previews" ADD COLUMN "reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sim_previews" ADD COLUMN "reset_by" text;--> statement-breakpoint
ALTER TABLE "sim_previews" ADD CONSTRAINT "sim_previews_reset_by_users_id_fk" FOREIGN KEY ("reset_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
