CREATE TABLE "lti_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"public_jwk" text NOT NULL,
	"private_pkcs8" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_links" (
	"section_id" text NOT NULL,
	"platform_id" text NOT NULL,
	"context_id" text NOT NULL,
	"lineitems_url" text,
	"scopes_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_platforms" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"deployment_id" text,
	"auth_login_url" text NOT NULL,
	"token_url" text NOT NULL,
	"jwks_url" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lti_links_section_uq" ON "lti_links" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_platforms_issuer_client_uq" ON "lti_platforms" USING btree ("issuer","client_id");