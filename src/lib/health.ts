import crypto from "node:crypto";
import { appUrlFrom, configuredAppUrl } from "@/lib/app-url";

/**
 * C2-2 v1.1 §5 step 1 — what `/api/health` answers.
 *
 * Two bodies, and which one you get depends on a secret. The public one is a liveness answer: it
 * says this deployment is up and nothing else. The diagnostic one is for the switch-over, and is
 * the only place that can confirm the Wrapper and the sims share a `LAUNCH_SECRET` without
 * revealing it.
 *
 * Split from the route so the access rule and the bodies can be tested as values. The route adds
 * the status code and the headers and nothing else.
 *
 * **It never touches the database.** A liveness check that queries Postgres fails when Postgres is
 * slow, which is exactly when a monitor should still be able to reach the site; and the real round
 * trip already exists on /admin/status, where it is attributed and cached. So `database` below
 * reports whether the *setting* is present, not whether it answers.
 */

/** The public body. Identical whatever is configured, so it cannot be read for configuration. */
export const publicBody = () => ({ ok: true as const, service: "flexee-wrapper" });

/**
 * Is this request allowed the diagnostic body?
 *
 * Both sides are hashed before comparing, rather than compared directly. `timingSafeEqual` throws
 * on a length mismatch, so the old platform guarded it with `want.length === given.length` — which
 * answers "how long is the secret" to anyone who asks. Hashing makes both operands 32 bytes, so
 * there is no length to leak and one constant-time compare does the whole job.
 *
 * With `HEALTH_SECRET` unset, nothing is allowed. That is the default, and it means a deployment
 * that has never been configured cannot be interrogated.
 */
export function mayDiagnose(given: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const want = env.HEALTH_SECRET ?? "";
  if (!want) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(h(want), h(given ?? ""));
}

/**
 * Eight hex characters of a SHA-256 of the launch secret — enough for two people to agree they
 * hold the same string, and not enough to be the string.
 *
 * This is the point of the whole endpoint. A `LAUNCH_SECRET` that differs between the Wrapper and
 * a sim makes every pass fail verification, and the symptom — students bounced at launch, consoles
 * showing nothing — is indistinguishable from a dozen other faults. Comparing fingerprints settles
 * it in one call. 32 bits is a deliberate trade: it is behind HEALTH_SECRET, and it is short enough
 * that it is useless for attacking a well-chosen secret while still being read aloud over a call.
 */
export const fingerprint = (value: string | undefined | null) =>
  value ? crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8) : null;

const setWord = (v: string | undefined) => (v && v.trim() ? "configured" : "MISSING");

/** The diagnostic body. Reports what is set and what it resolves to — never a value. */
export function diagnosticBody(
  env: Record<string, string | undefined> = process.env,
  req?: { proto?: string | null; host?: string | null },
) {
  const configured = configuredAppUrl(env);
  return {
    ...publicBody(),
    diagnostic: true as const,
    build: env.VERCEL_GIT_COMMIT_SHA
      ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) + (env.VERCEL_GIT_COMMIT_REF ? ` on ${env.VERCEL_GIT_COMMIT_REF}` : "")
      : "local",
    // Whether the setting is there, not whether the database answers: see the note above.
    database: setWord(env.DATABASE_URL),
    launchSecret: setWord(env.LAUNCH_SECRET),
    launchSecretFingerprint: fingerprint(env.LAUNCH_SECRET),
    // The two addresses that matter at switch-over. `appUrl` is what the sims must be pointed at;
    // `linksWillUse` is what an emailed link would actually say, which differs when APP_URL is
    // unset and is the thing that silently sends people to a preview deployment.
    appUrl: configured ?? "not set",
    linksWillUse: appUrlFrom(env.APP_URL, req?.proto, req?.host),
  };
}
