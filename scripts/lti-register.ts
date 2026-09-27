// Register an LMS platform. Provide values from the LMS's LTI developer key.
// node --env-file=.env --experimental-strip-types scripts/lti-register.ts \
//   --issuer https://canvas.test --client-id 125900000000000123 \
//   --auth https://canvas.test/api/lti/authorize_redirect \
//   --token https://canvas.test/login/oauth2/token \
//   --jwks https://canvas.test/api/lti/security/jwks [--deployment 1:abc] [--name "Canvas Test"]
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { ltiPlatforms } from "../src/db/schema.ts";
const url = process.env.DATABASE_URL; if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
const a = process.argv; const get = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const v = { issuer: get("--issuer"), clientId: get("--client-id"), authLoginUrl: get("--auth"), tokenUrl: get("--token"), jwksUrl: get("--jwks"), deploymentId: get("--deployment") ?? null, name: get("--name") ?? null };
for (const [k, val] of Object.entries(v)) if (val === undefined) { console.error(`Missing --${k}`); process.exit(1); }
const sql = postgres(url); const db = drizzle(sql, { schema: { ltiPlatforms } });
await db.insert(ltiPlatforms).values(v as any).onConflictDoUpdate({ target: [ltiPlatforms.issuer, ltiPlatforms.clientId], set: { authLoginUrl: v.authLoginUrl!, tokenUrl: v.tokenUrl!, jwksUrl: v.jwksUrl!, deploymentId: v.deploymentId, name: v.name } });
console.log(`Registered platform ${v.issuer} / ${v.clientId}`);
await sql.end();
