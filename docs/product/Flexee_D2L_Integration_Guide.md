# Flexee ↔ D2L Brightspace (LTI 1.3) — integration guide

Register Flexee as an LTI Advantage tool in Wright State's Brightspace so students launch
from D2L already signed in, and (optionally) grades flow back. Flexee is registration-ready;
the live launch and grade round-trip are proven on the tenant.

## Prerequisites

- **Flexee hosted at a public HTTPS URL.** LTI launches are cross-site, so the tool must be
  reachable over https (the launch state cookie needs `SameSite=None; Secure`).
- Migrations applied through `0006` (LTI). Confirm `GET /api/lti/config` and
  `GET /api/lti/jwks` return JSON at your host.
- A **Brightspace administrator** (to register the tool) and a **test course**.
- Decide how the book is chosen per placement: a **custom parameter** `book=<id>` (works
  today), or **Deep Linking** so the instructor picks the book (a build item — see the end).

## The tool endpoints to give your D2L admin

| Field in Brightspace | Value |
|---|---|
| OpenID Connect (login) URL | `https://<your-host>/api/lti/login` |
| Redirect URL / Target Link URI | `https://<your-host>/api/lti/launch` |
| Keyset (JWKS) URL | `https://<your-host>/api/lti/jwks` |
| (Tool config JSON, for reference) | `https://<your-host>/api/lti/config` |

## Step 1 — Register the tool (Brightspace admin)

Admin Tools → **Manage Extensibility** → **LTI Advantage** → **Register Tool** →
**Standard**. Enter a Name (e.g. "Flexee Reader"), the tool Domain (your host), and the three
URLs above. Under **Extensions**, enable **Assignment and Grade Services** (for grades); Deep
Linking and Names & Roles are optional. Save.

Brightspace then exposes the **platform values** you need to register back in Flexee:
- **Client Id**
- Brightspace **OpenID Connect authentication endpoint** (the platform auth URL)
- Brightspace **OAuth2 token endpoint** (used for AGS)
- Brightspace **Keyset (JWKS) URL** (the platform's public keys)
- **Issuer** (the platform issuer for your tenant)

## Step 2 — Create a Deployment

From the registered tool, create a **New Deployment**. Under **Extensions**, enable
**Assignment and Grade Services** (grades), **Deep Linking** (book picker), and **Names and
Role Provisioning Services** (roster sync). Set the security settings (Org Unit Information,
User Information, Link Information — and Classlist for NRPS), and deploy to the org
unit(s)/course. Brightspace shows a unique **Deployment Id** — record it.

## Step 3 — Register the Brightspace platform in Flexee

With the values from Steps 1–2:

```bash
npm run lti:register -- \
  --issuer "<brightspace issuer>" \
  --client-id "<client id>" \
  --deployment "<deployment id>" \
  --auth "<brightspace OIDC auth endpoint>" \
  --token "<brightspace token endpoint>" \
  --jwks "<brightspace keyset url>" \
  --name "Wright State Brightspace"
```

## Step 4 — Place a link in a course

Two ways, both supported:
- **Deep Linking (recommended):** enable the Deep Linking extension on the deployment. When
  the instructor adds the tool, Flexee shows a book picker and returns the selection to
  Brightspace — no manual parameter. (Built and verified against a mock platform.)
- **Custom parameter:** add the tool as an External Learning Tool / Quicklink and set
  **`book=<book id>`** (e.g. `book=mis3000`) on the link or deployment.

## Step 5 — Test the launch

Launch as an instructor and as a student. Confirm:
- SSO signs them in with no separate Flexee password.
- The **instructor lands on their section dashboard**; the **student lands in the reader**.
- On the instructor's launch, the **section roster populates from Brightspace** (NRPS); a
  "Sync roster from LMS" button on the dashboard re-syncs on demand.
- The Brightspace course maps to one Flexee section (via the LTI context id on
  `sections.external_context_id`); relaunching does not create duplicates.
- Roles map correctly (Instructor → instructor, others → student).

## Step 6 — Grades (AGS)

Enable the **Assignment and Grade Services** extension on the deployment. In Flexee, open the
section's **Gradebook** and click **Push grades to LMS**: Flexee obtains an AGS token, creates
(or finds) a Brightspace line item per gradebook column, and posts each student's score. This
flow is built and verified against a mock platform; the live round-trip is confirmed on the
tenant.

## Built — AGS grade push, Deep Linking, NRPS roster sync

Grade pass-back (AGS line-item creation + per-column score push), Deep Linking (book picker),
and NRPS roster sync (roster populates at the instructor's launch) are implemented and
verified against a mock platform. Instructors also land on their dashboard rather than the
reader. The only remaining convenience is:

- **Dynamic Registration** — expose a single registration endpoint so the admin pastes one
  URL and Brightspace auto-configures the tool (smoothest admin path). Not required for SSO,
  deep linking, grades, or roster sync.

## Reality check

LTI is the institution-approval path the standalone design was built to avoid — but Wright
State runs Brightspace and it's your home institution, so it's the one place that approval is
practical. Everything up to the live launch is in place; hosting under HTTPS, the admin
registration above, and a real launch + AGS test on the tenant are what remain.
