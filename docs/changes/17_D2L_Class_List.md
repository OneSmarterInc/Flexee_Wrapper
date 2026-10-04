# 17 — The D2L class list, set-your-password links, and the mail adapter

Backlog items W21 and W20, and the mail adapter Spec 13 (announcements) will reuse.

The spec and the decisions behind it are in [`docs/specs/17_D2L_Class_List.md`](../specs/17_D2L_Class_List.md).
**The setup Vikram does after this ships is at the end of this file.**

## Three things the reading found, which changed the shape of the work

- **Reset tokens were stored in plain text.** `auth_tokens.token` was 32 bytes of hex and the
  table's primary key. A database read or a backup handed out usable reset links.
- **Nothing had ever sent an email.** `src/lib/mail.ts` was a 12-line stub that logged the
  recipient, the subject and the **whole message body, reset link included**, and **threw** if a
  provider was configured. So configuring Resend without touching this file would have turned
  forgot-password into a server error. §1 is a rewrite of a stub, not a new addition.
- **Signing up with an address that already had an account was a dead end** — and this spec creates
  accounts with no usable password, so that is the first thing an imported student was likely to do.

## What changed

### The mail adapter

`sendMail({ to, subject, text, html? })` returns `{ ok, error?, id? }` and keeps three promises:

- **It never throws.** A student's account is created whether or not their invitation left the
  building; a failure is data.
- **It never logs a link, a token, an address or a name.** The only thing it logs is a provider
  status code (`[mail] provider refused a message: HTTP 422`). Even the provider's error body is
  dropped, because a provider quotes the recipient back at you.
- **With no `RESEND_API_KEY` and `MAIL_FROM`, nothing is sent** and the reason is the stable string
  `not configured`, which is what the class list then shows.

One real implementation, Resend over its HTTPS API, and `setMailTransport()` for the test fake.
`MAIL_PROVIDER` is no longer read.

There is deliberately **no dev-mode logging of links**. Reading a link out of a log was the old
stub's one convenience, and faculty now have **Copy link** for the case it existed for.

### Hashed tokens, all three kinds

`auth_tokens.token` became `token_hash` — the sha-256 of the secret. The secret exists in the link
and nowhere else, for `password_reset`, `email_verify` and the new `set_password` alike.

**Migration 0018 deletes every existing row**, so outstanding reset and verification links lapse at
deploy. They live at most 24 hours and anyone affected can ask again.

### Import from D2L

**Class roster → Import from D2L** on the class's faculty page, and on the admin class page.

The file is read **in the browser** and sent as text for one preview and one commit: it is never
uploaded as a file and never stored, and the preview lives only in the page's own state. Parsing is
done server-side by the same pure module (`src/lib/d2l.ts`), so what is counted and what is written
cannot disagree.

- CRLF, a byte-order mark, quoted `"Last, First"` names, any column order, extra columns ignored,
  columns found by name ignoring case.
- **Only the role `Student`** creates or enrols anyone. Faculty and teaching assistants are listed
  in the preview with their role and ignored.
- Email is the lower-cased `UserName` plus `D2L_EMAIL_DOMAIN` (default `wright.edu`). A `UserName`
  that is **already an address** is used as it is, stored as the D2L username as given, and
  **noted in the preview** so faculty can see the row was treated differently.
- `"Last, First"` becomes "First Last"; a name with no comma is used as written; non-ASCII is left
  alone. Blank and duplicate usernames are listed as problems, not imported.
- **`OrgDefinedId` is shown as "ignored" and stored nowhere.** A test asserts every id in the
  fixture is absent from `users`, `identities`, `enrolments` and `auth_tokens`.
- **The preview writes nothing**, proved by a census of every table before and after.
- On confirm: accounts with **no usable password** (`login` already refuses a null hash), a student
  enrolment, and the D2L username on the account. An existing account is enrolled and given its
  username, with **its password untouched**, and gets an invitation only if it never set one.
- Faculty choose **create accounts and email the invitations now**, or **create accounts only**.

`users.d2l_username` is lower-cased with a **unique index**. A username another account already
holds is therefore reported rather than crashed on — which happens when the email domain changes,
since the same username then derives a different address and so a different person. The student is
created, the username is not moved, and the preview and the result both say so.

### The invitation

A one-time link, valid **14 days**, stored hashed, with its own kind and the class on the row so
the email can name it. Following it sets the password, **marks the email verified**, clears any
stale session, and signs the student in.

- **A new link retires the old one.** Resend and Copy link both delete that student's unused
  invitation first, so only one link is ever live and a student cannot be caught out by which of
  two emails they happened to open.
- **Three resends per hour per student**, through the existing fixed-window limiter.
- The class list shows **Set up**, **Invited `<date>`**, **Link copied `<date>`**, **Link expired**,
  **Not sent: `<reason>`**, or **Not invited yet**. Nothing is stored twice: having a password is
  what "set up" means, and the rest comes from the newest invitation row.
- **Resend to everyone not set up** walks the class; one failed send never stops the rest.
- An expired link is refused with a clear message pointing at Forgot password — which works for a
  passwordless account, so that remedy is real.

### Temporary passwords are gone

The instructor's **Reset password** generated a temporary password and passed it through the **URL
query string** (`?pwreset=…&temp=…`), so it was written into browser history and into any log
between the server and the browser. It is replaced by the same set-password link, sent or copied
once. `setStudentPassword` and `tempPassword` are deleted, and
[`scripts/it-instr-reset.ts`](../../scripts/it-instr-reset.ts) now proves both are gone and that
neither `actions.ts` nor the faculty page puts a password in a query string.

### The sign-up dead end

- An address matching a **passwordless imported account** is sent a set-password link and shown
  "Check your email for a link to finish setting up your account." — the same words whether or not
  the send succeeded, and whether or not the person typing owns that address.
- An address with a **real password** keeps the existing message, now with links to **Sign in** and
  **Forgot password**.

### The D2L grade export key

The `Username` column is the stored D2L username; failing that, the part of the address before the
`@`; failing both, **blank** rather than a name D2L cannot match, with a count flagged beside the
export links. Nothing else about the export changed.

## Migration

**0018** — `auth_tokens.token` → `token_hash` (primary key), with every existing row deleted;
`section_id`, `sent_at` and `send_error` on the same table, which is what makes an invitation its
own record without a second table; `users.d2l_username` with a unique index. Applied by
`auto-init` on deploy, like the rest.

## Tests

- `npm run test:d2l` — **36 checks**, one group per rule of the spec, in its order. The two
  fixtures are read as bytes (CRLF present, one with a BOM, one without, D2L's own column order);
  the preview is bracketed by a table census; the hashed token is compared against sha-256 both
  ways; the 14-day expiry is forced past and refused; the whole flow's logs are captured and
  searched for the token, the reset token, the password, the address, the name and the provider's
  error body.
- `npm run test:instr-reset` — **7 checks**, rewritten. It used to mirror the temporary-password
  code; it now tests the replacement against the real module, and it is in `package.json` for the
  first time, so it runs with everything else rather than only by hand.
- `npm run test:gradebook`, `test:gb-starter`, `test:grading`, `test:sim-grades` cover the export
  change through the gradebook they already exercise.
- `scripts/it-recovery.ts` needed one change — its mirrored `issue`/`consume` now hash — and it
  gained a check that the stored row is not the token.

Two sabotages, run and undone, to show the suite bites: putting the old stub's
`console.log(to, text)` back fails rule 11 naming the token it found, and making `hashToken` return
its argument fails rule 5 on "the secret itself is not stored".

**The scripts typecheck earned its keep again.** Renaming the column broke `it-recovery.ts`, which
`tsconfig.json` does not cover; `npm run typecheck` caught it before anything ran.

### What the tests do not judge

- **Signing in.** `completeSetPassword` is proved to set the password, verify the address and clear
  stale sessions; the cookie itself is set by `createSession` in the server action, which needs a
  request to exist. The action is three lines over a tested function.
- **That Resend accepts the request.** The provider path is exercised against a stubbed `fetch`
  (422 and a network failure). Whether a real message arrives is the test Vikram runs after setup.
- **The two routes' own wiring.** `canImport`, the parser, the preview and the commit are all
  tested directly; the route handlers around them are a permission check and a JSON envelope.

## Byte-exact fixtures

[`scripts/fixtures/d2l_class_list.csv`](../../scripts/fixtures/d2l_class_list.csv) uses **D2L's
real column order** — `Name, UserName, OrgDefinedId, Role, LastAccessed` — with no BOM;
[`d2l_class_list_bom.csv`](../../scripts/fixtures/d2l_class_list_bom.csv) has a BOM, a shuffled
order and an extra `Availability` column. Between them: quoted "Last, First" names, CRLF, a Faculty
row, a teaching-assistant row, a duplicate username, a blank username, a mixed-case username and
role, trailing spaces, a name with no comma, two non-ASCII names, a blank line, and a `UserName`
that is already an address.

**Everyone in them is invented.** No real student data is in the repository. The patterns are the
real ones — `UserName` a letter, three digits and three letters; `OrgDefinedId` a letter and eight
digits — so a rehearsal looks like the real thing.

`.gitattributes` now carries `scripts/fixtures/*.csv -text`. Without it, `* text=auto eol=lf` would
have normalized the CRLF out of the files on commit and destroyed the thing they exist to test.

## One harness change

`next/headers` is now stubbed in `scripts/test-support/hooks.mjs`, which every suite loads, rather
than only in the JSX loader. `src/lib/auth` reads the session cookie through it, so anything
importing `auth` — or `recovery`, which hashes passwords with it — could not be imported by a test
before this. That is why `it-recovery.ts` mirrored the token code instead of calling it.

## Setup, after this ships

1. A **Resend** account, and a verified sending domain for `flexee.org`.
2. `RESEND_API_KEY` and `MAIL_FROM` (for example `Flexee <noreply@flexee.org>`) in Vercel, for
   production and preview.
3. `D2L_EMAIL_DOMAIN` — `wright.edu` is the default, so it only needs setting for another
   institution.
4. **DNS for `flexee.org`**, as Resend's dashboard specifies: the SPF/`MX` records for its sending
   subdomain, the DKIM `TXT` record, and a DMARC policy. Nothing sends until the domain verifies.

Until step 2 is done, importing still works: accounts are created and every invitation reads
**Not sent: not configured**, with **Copy link** to hand one over.
