import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import {
  generateKeyPair, exportJWK, exportPKCS8, importPKCS8, importJWK,
  createRemoteJWKSet, jwtVerify, decodeJwt, SignJWT,
} from "jose";
import { db } from "@/db";
import { ltiPlatforms, ltiKeys, ltiNonces, ltiLinks, sections, enrolments, users, identities } from "@/db/schema";
import { createSession } from "@/lib/auth";

const C = "https://purl.imsglobal.org/spec/lti/claim/";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
const SCOPE_SCORE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const SCOPE_LINEITEM = "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem";
const NRPS = "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice";
const SCOPE_NRPS = "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
const DL_SETTINGS = "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";
const DL_CONTENT = "https://purl.imsglobal.org/spec/lti-dl/claim/content_items";
const DL_DATA = "https://purl.imsglobal.org/spec/lti-dl/claim/data";

// ---- tool signing key (serves JWKS, signs AGS client assertions) ----
export async function ensureKey() {
  const existing = (await db().select().from(ltiKeys).limit(1))[0];
  if (existing) return existing;
  const kid = randomUUID();
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const pub = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const pkcs8 = await exportPKCS8(privateKey);
  await db().insert(ltiKeys).values({ kid, publicJwk: JSON.stringify(pub), privatePkcs8: pkcs8 }).onConflictDoNothing();
  return (await db().select().from(ltiKeys).where(eq(ltiKeys.kid, kid)).limit(1))[0];
}
export async function toolJwks() {
  const keys = await db().select().from(ltiKeys);
  return { keys: keys.map((k) => JSON.parse(k.publicJwk)) };
}
export function toolConfig(baseUrl: string) {
  return {
    title: "Flexee Reader",
    oidc_initiation_url: `${baseUrl}/api/lti/login`,
    target_link_uri: `${baseUrl}/api/lti/launch`,
    redirect_uris: [`${baseUrl}/api/lti/launch`],
    jwks_uri: `${baseUrl}/api/lti/jwks`,
    scopes: [SCOPE_SCORE, "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem"],
    custom_parameters: { book: "$Canvas.assignment.id" }, // adopters map the Flexee book id here
    note: "A launch must supply a custom 'book' parameter naming the Flexee book id (e.g. mis3000).",
  };
}

async function platformBy(issuer: string, clientId: string) {
  return (await db().select().from(ltiPlatforms).where(and(eq(ltiPlatforms.issuer, issuer), eq(ltiPlatforms.clientId, clientId))).limit(1))[0] ?? null;
}

// ---- OIDC third-party-initiated login ----
export async function loginInit(p: Record<string, string>, baseUrl: string) {
  const plat = await platformBy(p.iss, p.client_id);
  if (!plat) throw new Error(`Unregistered platform: ${p.iss} / ${p.client_id}`);
  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  await db().insert(ltiNonces).values({ nonce, expiresAt: new Date(Date.now() + 10 * 60_000) });
  const u = new URL(plat.authLoginUrl);
  const q = u.searchParams;
  q.set("scope", "openid"); q.set("response_type", "id_token"); q.set("response_mode", "form_post");
  q.set("prompt", "none"); q.set("client_id", plat.clientId);
  q.set("redirect_uri", `${baseUrl}/api/lti/launch`);
  q.set("login_hint", p.login_hint ?? ""); q.set("nonce", nonce); q.set("state", state);
  if (p.lti_message_hint) q.set("lti_message_hint", p.lti_message_hint);
  return { redirect: u.toString(), state };
}

async function consumeNonce(nonce: string) {
  await db().delete(ltiNonces).where(lt(ltiNonces.expiresAt, new Date())); // GC
  const row = (await db().select().from(ltiNonces).where(eq(ltiNonces.nonce, nonce)).limit(1))[0];
  if (!row) return false;
  await db().delete(ltiNonces).where(eq(ltiNonces.nonce, nonce)); // single use
  return row.expiresAt > new Date();
}

// ---- Resource-link launch: validate id_token, map to user/section/enrolment ----
export async function handleLaunch(idToken: string, state: string, cookieState: string | undefined) {
  if (!cookieState || cookieState !== state) throw new Error("State mismatch");
  const unverified = decodeJwt(idToken);
  const iss = String(unverified.iss), aud = String(Array.isArray(unverified.aud) ? unverified.aud[0] : unverified.aud);
  const plat = await platformBy(iss, aud);
  if (!plat) throw new Error("Unregistered platform on launch");

  const JWKS = createRemoteJWKSet(new URL(plat.jwksUrl));
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: iss, audience: aud });

  if (payload[`${C}version`] !== "1.3.0") throw new Error("Not LTI 1.3");
  const messageType = payload[`${C}message_type`];
  if (messageType !== "LtiResourceLinkRequest" && messageType !== "LtiDeepLinkingRequest") throw new Error("Unsupported LTI message type");
  if (plat.deploymentId && payload[`${C}deployment_id`] !== plat.deploymentId) throw new Error("Deployment mismatch");
  if (!payload.nonce || !(await consumeNonce(String(payload.nonce)))) throw new Error("Invalid or replayed nonce");

  // Deep-linking request: the instructor is choosing content — hand off to the picker.
  if (messageType === "LtiDeepLinkingRequest") {
    const dls = (payload[DL_SETTINGS] as any) || {};
    return { kind: "deeplink" as const, returnUrl: String(dls.deep_link_return_url || ""), data: dls.data ?? null,
             iss, clientId: aud, deploymentId: String(payload[`${C}deployment_id`] || "") };
  }

  const sub = String(payload.sub);
  const name = (payload.name as string) || (payload.given_name as string) || "LTI user";
  const email = (payload.email as string) || null;
  const roles = (payload[`${C}roles`] as string[]) || [];
  const ctx = (payload[`${C}context`] as any) || {};
  const custom = (payload[`${C}custom`] as any) || {};
  const ags = (payload[AGS] as any) || {};
  const bookId = String(custom.book || "").trim();
  if (!bookId) throw new Error("Launch is missing the custom 'book' parameter");

  // identity -> user
  const subject = `${iss}|${sub}`;
  let ident = (await db().select().from(identities).where(and(eq(identities.provider, "lti"), eq(identities.subject, subject))).limit(1))[0];
  let userId: string;
  if (ident) userId = ident.userId;
  else {
    const [u] = await db().insert(users).values({ displayName: name }).returning();
    userId = u.id;
    await db().insert(identities).values({ userId, provider: "lti", subject });
    if (email) await db().insert(identities).values({ userId, provider: "email", subject: email.toLowerCase() }).onConflictDoNothing();
  }

  // context -> section (via the external_context_id seam), namespaced by issuer
  const externalContextId = `${iss}|${ctx.id ?? "unknown"}`;
  let sec = (await db().select().from(sections).where(eq(sections.externalContextId, externalContextId)).limit(1))[0];
  if (!sec) {
    [sec] = await db().insert(sections).values({
      bookId, name: ctx.title || ctx.label || externalContextId, externalContextId,
    }).returning();
  }

  // roles -> enrolment
  const isInstructor = roles.some((r) => /Instructor|TeachingAssistant|ContentDeveloper|Administrator/.test(r));
  await db().insert(enrolments).values({ sectionId: sec.id, userId, role: isInstructor ? "instructor" : "student" }).onConflictDoNothing();

  // capture AGS + NRPS endpoints (preserve any already stored if this launch lacks one)
  const nrpsUrl = (payload[NRPS] as any)?.context_memberships_url ?? null;
  const setObj: any = { contextId: String(ctx.id ?? "") };
  if (ags.lineitems) { setObj.lineitemsUrl = ags.lineitems; setObj.scopesJson = JSON.stringify(ags.scope || []); }
  if (nrpsUrl) setObj.nrpsUrl = nrpsUrl;
  await db().insert(ltiLinks).values({ sectionId: sec.id, platformId: plat.id, contextId: String(ctx.id ?? ""), lineitemsUrl: ags.lineitems ?? null, nrpsUrl, scopesJson: JSON.stringify(ags.scope || []) })
    .onConflictDoUpdate({ target: ltiLinks.sectionId, set: setObj });

  // instructor launch: populate the roster from the LMS up front (best-effort)
  if (isInstructor && nrpsUrl) { try { await syncRoster(sec.id); } catch { /* non-fatal */ } }

  await createSession(userId);
  // instructors land on their teaching dashboard; students land in the reader
  return { kind: "resource" as const, redirect: isInstructor ? `/teach/${sec.id}` : `/${bookId}`, userId, sectionId: sec.id, role: isInstructor ? "instructor" : "student" };
}

// ---- AGS grade pass-back ----
export async function platformToken(platform: typeof ltiPlatforms.$inferSelect, scopes: string[]) {
  const key = await ensureKey();
  const pk = await importPKCS8(key.privatePkcs8, "RS256");
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(platform.clientId).setSubject(platform.clientId).setAudience(platform.tokenUrl)
    .setIssuedAt().setExpirationTime("60s").setJti(randomUUID()).sign(pk);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion, scope: scopes.join(" "),
  });
  const res = await fetch(platform.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  return (await res.json()).access_token as string;
}

export function scorePayload(sub: string, scoreGiven: number, scoreMaximum: number) {
  return {
    userId: sub, scoreGiven, scoreMaximum,
    activityProgress: "Completed", gradingProgress: "FullyGraded",
    timestamp: new Date().toISOString(),
  };
}

export async function postScore(platform: typeof ltiPlatforms.$inferSelect, lineitemUrl: string, sub: string, scoreGiven: number, scoreMaximum: number) {
  const token = await platformToken(platform, [SCOPE_SCORE]);
  const res = await fetch(scoresUrl(lineitemUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/vnd.ims.lis.v1.score+json" },
    body: JSON.stringify(scorePayload(sub, scoreGiven, scoreMaximum)),
  });
  if (!res.ok) throw new Error(`Score post failed: ${res.status}`);
  return true;
}

export async function registerPlatform(v: { issuer: string; clientId: string; deploymentId?: string; authLoginUrl: string; tokenUrl: string; jwksUrl: string; name?: string }) {
  await db().insert(ltiPlatforms).values(v).onConflictDoUpdate({
    target: [ltiPlatforms.issuer, ltiPlatforms.clientId],
    set: { deploymentId: v.deploymentId ?? null, authLoginUrl: v.authLoginUrl, tokenUrl: v.tokenUrl, jwksUrl: v.jwksUrl, name: v.name ?? null },
  });
}

// ---- AGS line-item creation + grade push (needs a live LMS to exercise) ----
function scoresUrl(lineitemUrl: string) {
  const u = new URL(lineitemUrl);
  u.pathname = u.pathname.replace(/\/$/, "") + "/scores";
  return u.toString();
}

// Find-or-create an LMS line item for a Flexee gradebook column (keyed by resourceId).
export async function ensureLineItem(platform: typeof ltiPlatforms.$inferSelect, lineitemsUrl: string, resourceId: string, label: string, scoreMaximum: number) {
  const token = await platformToken(platform, [SCOPE_LINEITEM]);
  const find = new URL(lineitemsUrl); find.searchParams.set("resource_id", resourceId);
  const r = await fetch(find.toString(), { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.ims.lis.v2.lineitemcontainer+json" } });
  if (r.ok) {
    const items = await r.json();
    const found = Array.isArray(items) ? items.find((i: any) => i.resourceId === resourceId) : null;
    if (found?.id) return found.id as string;
  }
  const c = await fetch(lineitemsUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/vnd.ims.lis.v2.lineitem+json" },
    body: JSON.stringify({ scoreMaximum, label, resourceId }),
  });
  if (!c.ok) throw new Error(`Line item create failed: ${c.status}`);
  return (await c.json()).id as string;
}

// Push a whole section's gradebook to the LMS: a line item per column, a score per student.
export async function pushSectionGrades(sectionId: string) {
  const link = (await db().select().from(ltiLinks).where(eq(ltiLinks.sectionId, sectionId)).limit(1))[0];
  if (!link?.lineitemsUrl) throw new Error("No LMS grade endpoint for this section — launch it from the LMS as a graded item first.");
  const platform = (await db().select().from(ltiPlatforms).where(eq(ltiPlatforms.id, link.platformId)).limit(1))[0];
  if (!platform) throw new Error("Platform not found");

  const { gradebook } = await import("@/lib/gradebook");
  const { items, students } = await gradebook(sectionId);

  // enrolment -> LMS user sub (from the stored lti identity, de-namespaced)
  const roster = await db().select({ enrolmentId: enrolments.id, subject: identities.subject })
    .from(enrolments).innerJoin(identities, and(eq(identities.userId, enrolments.userId), eq(identities.provider, "lti")))
    .where(eq(enrolments.sectionId, sectionId));
  const prefix = `${platform.issuer}|`;
  const subByEnrolment = new Map(roster.map((r) => [r.enrolmentId, r.subject.startsWith(prefix) ? r.subject.slice(prefix.length) : r.subject]));

  let pushed = 0, skipped = 0;
  for (const it of items) {
    const lineitemUrl = await ensureLineItem(platform, link.lineitemsUrl, it.id, it.title, it.maxPoints);
    for (const s of students) {
      const c = s.cells[it.id]; const sub = subByEnrolment.get(s.enrolmentId);
      if (c.points == null || !sub) { skipped++; continue; }
      await postScore(platform, lineitemUrl, sub, c.points, it.maxPoints);
      pushed++;
    }
  }
  return { pushed, skipped };
}

export async function sectionHasLtiLink(sectionId: string) {
  return !!(await db().select().from(ltiLinks).where(eq(ltiLinks.sectionId, sectionId)).limit(1))[0]?.lineitemsUrl;
}

// ---- Deep Linking: sign the short-lived context, and the response back to the LMS ----
type DlCtx = { returnUrl: string; data: string | null; iss: string; clientId: string; deploymentId: string };

export async function signDeepLinkState(ctx: DlCtx) {
  const key = await ensureKey();
  const pk = await importPKCS8(key.privatePkcs8, "RS256");
  return new SignJWT({ ...ctx }).setProtectedHeader({ alg: "RS256", kid: key.kid }).setIssuedAt().setExpirationTime("15m").sign(pk);
}
export async function verifyDeepLinkState(token: string): Promise<DlCtx> {
  const key = await ensureKey();
  const pub = await importJWK(JSON.parse(key.publicJwk), "RS256");
  const { payload } = await jwtVerify(token, pub);
  return { returnUrl: String(payload.returnUrl), data: (payload.data as string) ?? null, iss: String(payload.iss), clientId: String(payload.clientId), deploymentId: String(payload.deploymentId) };
}

// Build the signed Deep Linking Response the browser auto-POSTs back to the LMS.
export async function buildDeepLinkResponse(ctx: DlCtx, bookId: string, bookTitle: string, baseUrl: string) {
  const key = await ensureKey();
  const pk = await importPKCS8(key.privatePkcs8, "RS256");
  const contentItem = { type: "ltiResourceLink", title: `Flexee — ${bookTitle}`, url: `${baseUrl}/api/lti/launch`, custom: { book: bookId } };
  const claims: Record<string, unknown> = {
    [`${C}message_type`]: "LtiDeepLinkingResponse", [`${C}version`]: "1.3.0",
    [`${C}deployment_id`]: ctx.deploymentId, [DL_CONTENT]: [contentItem],
  };
  if (ctx.data) claims[DL_DATA] = ctx.data;
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(ctx.clientId).setAudience(ctx.iss).setIssuedAt().setExpirationTime("5m").setJti(crypto.randomUUID()).sign(pk);
}

// ---- NRPS: pull the course roster from the LMS ----
function nextLink(headers: Headers): string | null {
  const link = headers.get("link");
  if (!link) return null;
  const m = link.match(/<([^>]+)>\s*;\s*rel="?next"?/);
  return m ? m[1] : null;
}

export async function sectionHasNrps(sectionId: string) {
  return !!(await db().select().from(ltiLinks).where(eq(ltiLinks.sectionId, sectionId)).limit(1))[0]?.nrpsUrl;
}

export async function syncRoster(sectionId: string) {
  const link = (await db().select().from(ltiLinks).where(eq(ltiLinks.sectionId, sectionId)).limit(1))[0];
  if (!link?.nrpsUrl) throw new Error("No LMS roster endpoint — enable Names & Role Provisioning on the deployment.");
  const platform = (await db().select().from(ltiPlatforms).where(eq(ltiPlatforms.id, link.platformId)).limit(1))[0];
  if (!platform) throw new Error("Platform not found");
  const token = await platformToken(platform, [SCOPE_NRPS]);

  let url: string | null = link.nrpsUrl;
  let added = 0, seen = 0;
  while (url) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.ims.lti-nrps.v2.membershipcontainer+json" } });
    if (!res.ok) throw new Error(`NRPS fetch failed: ${res.status}`);
    const data = await res.json();
    for (const m of (data.members || [])) {
      if (m.status && m.status !== "Active") continue;
      seen++;
      const subject = `${platform.issuer}|${m.user_id}`;
      let ident = (await db().select().from(identities).where(and(eq(identities.provider, "lti"), eq(identities.subject, subject))).limit(1))[0];
      let userId: string;
      if (ident) userId = ident.userId;
      else {
        const [u] = await db().insert(users).values({ displayName: m.name || m.given_name || "Student" }).returning();
        userId = u.id;
        await db().insert(identities).values({ userId, provider: "lti", subject });
        if (m.email) await db().insert(identities).values({ userId, provider: "email", subject: String(m.email).toLowerCase() }).onConflictDoNothing();
      }
      const isInstr = (m.roles || []).some((r: string) => /Instructor|TeachingAssistant|ContentDeveloper|Administrator/.test(r));
      const ins = await db().insert(enrolments).values({ sectionId, userId, role: isInstr ? "instructor" : "student" }).onConflictDoNothing().returning();
      if (ins.length) added++;
    }
    url = nextLink(res.headers);
  }
  return { added, seen };
}
