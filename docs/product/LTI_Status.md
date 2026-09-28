# Flexee — LTI 1.3 status

## What LTI adds

Flexee is now an **LTI 1.3 tool**: an instructor adds it in the LMS, students click through
already authenticated (SSO), and grades can flow back to the LMS gradebook. It attaches at
the three seams built earlier — pluggable identity, `sections.external_context_id`, and
gradebook line items — so no core rewrite was needed.

## Endpoints (for registering Flexee in an LMS)

- `GET /api/lti/login` — OIDC third-party login initiation
- `POST /api/lti/launch` — resource-link launch (validates the id_token, signs the user in)
- `GET /api/lti/jwks` — the tool's public keys
- `GET /api/lti/config` — tool configuration for registration

Register a platform with `npm run lti:register -- --issuer … --client-id … --auth … --token … --jwks … [--deployment …]`.
A launch must carry a **custom `book` parameter** naming the Flexee book id (e.g. `mis3000`).

## Verified here (local crypto + mapping, no LMS required)

- **Launch id_token validation** — RS256 signature against the platform JWKS, and enforced
  `issuer`, `audience` (= client_id) and `exp`. Wrong audience, tampered signatures, and a
  wrong signing key are all rejected.
- **Replay protection** — the launch nonce is single-use; a replay is rejected.
- **Message checks** — `message_type = LtiResourceLinkRequest`, LTI `1.3.0`, deployment id.
- **Claim mapping (idempotent)** — LMS `sub` → an `lti` identity → one user (reused across
  launches, no duplicates); `context.id` → a section via `external_context_id`; LMS roles →
  instructor/student enrolment. Verified with a locally minted, signed id_token.
- **AGS grade pass-back** — client-credentials assertion, **line-item find-or-create per
  gradebook column**, and score posting, all verified against a mock LMS HTTP server (token,
  lineitems GET/POST, scores POST); a second push finds the existing line item (no duplicate).
- **Deep Linking** — the response JWT (content item + custom `book` + echoed data) signs and
  verifies; the instructor book-picker page and auto-POST-back are built.
- **NRPS roster sync** — verified against a mock LMS: paginated membership fetch, inactive
  members skipped, role mapping, idempotent re-sync; runs on the instructor launch + a manual
  "Sync roster" button. Instructors land on their dashboard, students in the reader.

## NOT verified here — requires an LMS / conformance test before production

- A **real launch from an actual LMS** (Canvas/Moodle/Brightspace test instance or the 1EdTech
  reference tool) end to end.
- **Remote JWKS fetch** and the **AGS network round-trips** (token request, score POST) —
  the code is written; only the network calls remain untested.
- The **cross-site state cookie** (`SameSite=None; Secure`) — LTI launches are cross-site, so
  the tool must run under **HTTPS**; this can't be exercised over local http.

## Not implemented (optional LTI services)

- **Deep Linking** (instructor picks content in the LMS to place)

Dynamic Registration is additive and unnecessary for SSO + grade pass-back.

## Recommended path to production

1. Stand the app up under HTTPS in staging.
2. Register a test LMS (or the 1EdTech reference implementation) with the endpoints above.
3. Run a real launch; confirm SSO, section mapping and roles.
4. Add AGS line-item creation, then confirm a score round-trips into the LMS gradebook.
5. Run the 1EdTech LTI Advantage conformance suite before enabling for an institution.

Consistent with the platform brief: standalone remains the default; this makes LTI a
registerable, mechanically-verified attachment, to be conformance-tested when an institution
adopts it.
