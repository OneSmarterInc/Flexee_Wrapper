-- Spec 17: the D2L class list import, set-your-password invitations, and hashed tokens.
--
-- 1. Tokens are hashed. `auth_tokens.token` held the link's secret in plain text and was the
--    table's primary key, so a database read or a backup handed out usable reset links. The column
--    is replaced by `token_hash` (sha-256 of the secret), which is what the server now stores and
--    compares. Every existing row is deleted: a hash cannot be derived from a plaintext row's
--    successor, so outstanding reset and verification links lapse at this deploy. They live at most
--    24 hours and anyone affected can ask for another.
--
-- 2. A third kind joins them, `set_password` — the 14-day invitation an imported student follows to
--    choose their own password. `section_id` lets its email name the class; `sent_at` and
--    `send_error` are the invitation's own record, so the faculty class list can say "invited on
--    the 4th", "not sent: not configured", or "link expired" without a second table.
--
-- 3. `users.d2l_username` is where a student's D2L UserName lives, lower-cased and unique. On the
--    person rather than on the class or the login method, so it survives a later LTI sign-in and
--    the grade export can key on it.
DELETE FROM "auth_tokens";--> statement-breakpoint
ALTER TABLE "auth_tokens" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "auth_tokens" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_token_hash_pk" PRIMARY KEY ("token_hash");--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "section_id" text;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "send_error" text;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tokens_user_kind_idx" ON "auth_tokens" USING btree ("user_id","kind");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "d2l_username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_d2l_username_uq" ON "users" USING btree ("d2l_username");
