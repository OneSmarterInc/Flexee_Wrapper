# Flexee — Information for LMS Administrators & IT Security

For Wright State's Brightspace (D2L) administrator and IT security review. Companion to the
full **Flexee D2L Integration Guide**.

## What Flexee is

An LMS-integrated reader + assessment tool. Students launch it from a D2L course (LTI 1.3
single sign-on), read the book, take objective-linked exams, and their grades flow back to
the D2L gradebook. It runs as a standalone web application; the LMS connection is standard
**LTI 1.3 / LTI Advantage** (SSO, AGS grades, Deep Linking, NRPS roster).

## Registration (admin, one time)

Standard LTI Advantage registration in **Manage Extensibility → LTI Advantage → Register
Tool**, using Flexee's OIDC login, launch, and JWKS URLs; then a deployment with the
**Assignment and Grade Services**, **Deep Linking**, and **Names and Role Provisioning**
extensions enabled. Full steps and the exact endpoints are in the integration guide. No D2L
corporate/vendor account is required — this is institution-level self-registration.

## Data Flexee stores

| Category | Examples | Purpose |
|---|---|---|
| Identity | Name, email, the D2L user id (LTI subject) | Sign-in, roster |
| Enrolment | Section and role (instructor/student) | Access/entitlement |
| Reading | Bookmark position | Resume where left off |
| Assessment | Exam attempts, selected answers, scores | Grading, feedback, reporting |
| Gradebook | Column scores, weights, totals | Course grade + push-back to D2L |
| Auth (password sign-in path only) | Bcrypt password hash; reset/verify tokens | Non-LMS logins, if used |

**Not stored:** no password for LTI/SSO users (D2L authenticates them); no payment or
financial data; no special-category personal data beyond ordinary education records.

## Where it lives, and who can see it

- **One PostgreSQL database under the operator's control.** Hosting location is a deployment
  decision — we recommend WSU-approved hosting for a WSU pilot. LTI signing keys are held
  server-side; all traffic is over **HTTPS/TLS** (required for LTI).
- **Access is scoped:** a student sees only their own attempts and grades; an instructor sees
  only their own sections; cross-user access via tampered requests is blocked (verified).
  Sessions are httpOnly; passwords (non-SSO path) are bcrypt-hashed; auth endpoints are rate
  limited; LTI launches are validated (signature, single-use nonce, audience/issuer).

## FERPA posture

Flexee holds student education records (attempts, grades), so it operates as a school
official / vendor with a legitimate educational interest under FERPA. We recommend a
data-sharing / data-protection agreement, and Flexee aligns with the **1EdTech TrustEd Apps**
data-privacy expectations for LTI tools.

## Honest status — decisions and reviews still needed before production

These are not yet done and should be settled with WSU before go-live:

- **Retention & deletion policy.** There is no automated purge yet. End-of-term and
  end-of-adoption data deletion is currently an operator process to define and document.
- **Student data access/deletion requests.** No student self-serve export/delete yet;
  requests are fulfilled by the operator (account merge/delete tooling exists).
- **Formal security assessment.** The integration's mechanics are verified in development, but
  no third-party security review or penetration test has been performed. We expect to complete
  WSU's vendor security questionnaire (e.g. **HECVAT**) as part of review.
- **Accessibility.** A formal WCAG/VPAT audit has not been done; the reader is built to be
  responsive and keyboard/theme aware, but an accessibility review is recommended.

## Contact

<Flexee owner / support contact, hosting details, and the app's base URL to register>.
