# Spec 17 — Class list import from D2L, set-your-password links, and the mail adapter

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 4 October 2026 · Save as `docs/specs/17_D2L_Class_List.md` (first commit).
Covers backlog items W21 and W20. It also builds the mail adapter that Spec 13 (announcements) will reuse.

## Why

For Spring, faculty will export the class list from D2L and give students access through the Wrapper. The D2L
export has these columns: `Name` (quoted, written "Last, First"), `UserName`, `OrgDefinedId`, `Role` and
`LastAccessed`. **It has no email column.** Every Wright State email is the UserName plus `@wright.edu`.

Today the Wrapper's class-list import reads email and name only, and students must sign up and claim an
invitation themselves. The Wrapper also cannot send email. What's wanted: import the D2L file in one step,
create the student accounts, email each student a one-time link to set their own password, and use the D2L
username when grades are exported back to D2L.

## Before writing any code

1. Read the class-list import (`commitRoster` and `claimInvites` in `src/lib/roster.ts`, the faculty import
   page, `src/app/api/roster`), accounts and sessions (`src/lib/auth.ts`), `src/lib/recovery.ts` (reset and
   verification tokens), the login, sign-up, forgot and reset pages, the faculty roster page where an
   instructor resets a password, and the D2L export in `src/lib/gradebook.ts`.
2. **Report:** how reset tokens are stored (hashed or not), their expiry, whether they are single-use, and the
   rate limits; whether anything sends email today, or only produces a link; and what happens when a student
   signs up with an email that already has an account made by the import or a pending invitation.
3. Plan a **made-up sample file** in the real format for `scripts/fixtures/` (fake people only, never real
   student data): quoted "Last, First" names, CRLF line endings, with and without a byte-order mark, a Faculty
   row, a teaching-assistant row, a duplicate username, a blank username, mixed case, trailing spaces, a name
   with no comma, and a non-ASCII name.
4. Propose a plan and list open questions. **Wait for my go before building.**

## What to build

### 1. The mail adapter (`src/lib/mail.ts`)

- One implementation: **Resend** over its HTTPS API, set by `RESEND_API_KEY` and `MAIL_FROM`. A fake for tests.
  `sendMail({ to, subject, text, html? })` returns ok or an error and never breaks its caller.
- With no API key, nothing is sent and the result says "not configured". Nothing crashes.
- Never log a link, a token, an address or a name.
- Build it so Spec 13 can reuse it.
- The existing **forgot-password** and **email-verification** steps use it, if they currently only produce a link.

### 2. Import from D2L

- On the class's faculty page: **Class list → Import from D2L**. Upload the CSV. Accept a byte-order mark, CRLF,
  quoted fields and extra columns; find columns by header name, ignoring case: Name, UserName, OrgDefinedId, Role.
- **Preview first, nothing written.** Show how many students will be created, how many already have accounts,
  how many are already in the class, which rows are skipped (a non-Student role is listed with its role), and
  problems (blank or duplicate username, unreadable name). Faculty confirm.
- **Identity:** email is the lower-cased UserName plus `@wright.edu`. The domain is a setting
  (`D2L_EMAIL_DOMAIN`, default `wright.edu`), not hard-coded. Display name: "Last, First" becomes "First Last";
  a name with no comma is used as it is.
- **Only the role "Student" creates or enrols a student** (compare ignoring case). Faculty, teaching assistants
  and anyone else are listed in the preview and ignored.
- **On confirm:** create the account with **no usable password**, enrol it as a student, and store the D2L
  username (lower-cased) against the account. If an account with that email already exists, enrol it, attach
  the D2L username, and send no invitation unless that person never set a password.
- **`OrgDefinedId` is read and shown as "ignored" in the preview, and is not stored.** It looks like a student ID
  number. Make storing it a deliberate later change, if my D2L test shows D2L needs it.
- At confirm, a choice: **create accounts and email the invitations now**, or **create accounts only** and send
  them later.

### 3. The invitation: a one-time set-your-password link

- An emailed link, valid for **14 days**, usable once, stored hashed. Reuse the existing reset-token mechanism
  if it fits, with a separate purpose and the longer expiry.
- The email is short and plain: the class name and term, the link, and what to do if it has expired (use
  "Forgot password" on the sign-in page).
- Following the link, the student chooses a password, is signed in, and lands on their course page. **Setting a
  password this way marks the email as verified.**
- The faculty class list shows each student's state: invited (with the date sent), set up, link expired, or not
  sent (with the reason). Buttons: **Resend invitation**, **Resend to everyone not set up**, and **Copy link**
  (a fresh link shown once, for when an email doesn't arrive; it replaces any earlier unused link for that
  student). Limit resends per student per hour.
- A failed send for one student never stops the others, and never loses the account. It is recorded and shown.

### 4. The D2L grade export key

- The D2L export's `Username` column uses the stored D2L username. When there is none, fall back to the part of
  the email before the `@`. A student with neither appears blank, flagged on the export page.
- Whether D2L matches on Username or on Org Defined ID is for my D2L test. Don't change the export beyond this.

### 5. Re-import

- Re-importing the same or a later export adds late students, creates no duplicates, and never touches an
  existing account's password. Students on the class who are **not** in the new file are listed, never removed
  automatically.

### Privacy

The uploaded file isn't stored: process it in memory. The preview isn't stored. No names, addresses, tokens or
links in logs.

## Rules (tests must prove each)

1. The parser reads the real format (CRLF, quoted "Last, First", with and without a byte-order mark, any column
   order, extra columns ignored). Only "Student" creates a student; other roles are listed and ignored.
2. The preview writes nothing.
3. Confirming creates the accounts with no usable password, the derived emails, the D2L usernames stored, and
   student enrolments. `OrgDefinedId` is stored nowhere.
4. An existing account is enrolled and given its D2L username, with no new account and no invitation unless it
   never set a password.
5. The invitation goes out once per student through the (fake) adapter, to the derived address, with the class
   and the link in it. The token is stored hashed, works once, expires after 14 days, and an expired link is
   refused with a clear message. Following the link sets the password, signs the student in, and marks the email
   verified.
6. With no API key, the accounts are created and the invitations show "not sent". One failed send doesn't stop
   the rest. Resend works. Copy link gives a fresh working link and retires the earlier unused one.
7. Re-import is idempotent: late students are added, nobody is duplicated, and students missing from the file
   are listed and not removed.
8. Only the class's faculty and admins can import. Students and other classes' faculty are refused.
9. The D2L export's Username is the stored D2L username, falls back to the email's local part, and flags blanks.
10. Forgot-password sends through the adapter and gives the same answer whether or not the address exists.
11. A captured log of the whole flow contains no token, password, name or email.

## Process

As before: a migration for the new storage (the next number, applied by `auto-init`); `docs/changes/17_D2L_Class_List.md`,
including the setup list below; every suite passes; commits authored as me; **show me the summary and ask before
pushing**; `git pull --rebase` first. The sample file is fake. Put no real student data in the repository.

Setup the change note must list: a Resend account, `RESEND_API_KEY`, `MAIL_FROM`, `D2L_EMAIL_DOMAIN`, and the
sending records for `flexee.org` in DNS.

## After it ships (not part of this build)

I finish the Resend and DNS setup, send a test to my Wright State address, run the rehearsal with the made-up
file, run the D2L export test, and do the real import when the course has students.

## Decisions (4 October 2026)

Answers settled after reading the import, the accounts and session code, `recovery.ts`, the sign-in
pages and the D2L export. Three findings from that reading add work this spec did not originally
name, and one of its framings is corrected.

### What the reading found

- **Reset tokens are stored in plain text.** `auth_tokens.token` is 32 random bytes of hex and is the
  table's **primary key**. Single-use (`usedAt` is stamped on consumption) and expiring - password
  reset after 1 hour, email verification after 24 - but not hashed, so a database read or a backup
  exposes usable links.
- **Nothing has ever sent an email.** `src/lib/mail.ts` is a 12-line stub. With no provider it
  `console.log`s the recipient, the subject and the **whole message body, reset link and token
  included**, which is what this spec's own §1 forbids and what rule 11 will catch. With a provider
  set it **throws**, and no caller catches it, so configuring one today would turn forgot-password
  into a server error. "Never breaks its caller" fixes a live fault, not a hypothetical one.
- **Signing up with an address that already has an account is a dead end**: "An account with that
  email already exists", with no link to sign in and no mention of Forgot password. Since this spec
  creates accounts with no usable password, and `login` refuses an identity whose hash is null, the
  most likely student action after an import would lead nowhere.
- Rate limits exist in only two places, `login` (8 per 15 minutes) and `forgot` (5 per 15 minutes);
  `sendVerification` has none. Rule 10's non-enumeration half is already satisfied: `forgotAction`
  always redirects to `?sent=1` and the page says "If an account exists for that email…".
- `identities.passwordHash` is **already nullable** and `login` already refuses null, so "no usable
  password" needs no schema change for the hash itself.

**A correction to §1's framing.** It says the existing flows should use the adapter "if they
currently only produce a link". They already call `sendMail`; what is missing is an implementation,
a safe return value, and the absence of logging. §1 is a rewrite of a stub and a fix to two callers,
not a new addition.

### 1. All three token kinds are hashed

`password_reset`, `email_verify` and the new `set_password` are all stored hashed. **The migration
deletes the existing rows**, so any outstanding reset or verification link lapses at deploy. Those
links live at most 24 hours and anyone affected can simply ask again.

### 2. The D2L username lives on `users`

`users.d2l_username`, **lower-cased, with a unique index**. It is an attribute of the person rather
than of a class or a login method, so it stays available if that student later signs in through LTI.

### 3. The sign-up dead end is fixed

- An address matching a **passwordless imported account**: send it a set-password link and show the
  neutral "Check your email for a link to finish setting up your account."
- An address with a **real password**: keep the existing message and add links to sign in and to
  Forgot password.

### 4. A new link retires the old one

**Resend and Copy link both replace any earlier unused link** for that student, so only one
invitation is ever live.

### 5. A UserName that already contains `@`

Use it as the email **as given**, store it as the D2L username **exactly as given, lower-cased**, and
**note it in the preview** so faculty can see the row was treated differently.

### 6. Three resends per hour per student

### 7. Who may import

The class's faculty **and admins**, through the same check as `canManageClass` in
`src/lib/publish.ts` - `ownedSection(...) || isAdmin(...)`. The existing import endpoint uses
`ownedSection` alone, so an administrator who does not teach the class cannot import today.

### Also in this build

**(a) Temporary passwords are retired.** The instructor's in-person password reset currently
generates a temporary password and passes it through the **URL query string**
(`?pwreset=…&temp=…`), so it lands in browser history and any proxy log. It is replaced by the same
set-password link, either sent or copied once. Its test is updated with it.

**(b) The mail stub's logging is fixed as part of §1**, since it logs addresses and whole messages,
reset links included, in production today.

**(c) The fixtures use realistic patterns.** No real people and no real-looking staff names: the
"Sethi, Vikram" row becomes a clearly fake name. `UserName` follows the real shape - a letter, three
digits and three letters, for example `w101abc` - and `OrgDefinedId` a letter and eight digits. The
**no-BOM file uses D2L's real column order exactly**: `Name, UserName, OrgDefinedId, Role,
LastAccessed`. The **BOM file keeps a shuffled order with an extra column**, so both the realistic
case and the awkward one are fixtures a person can read rather than assertions in a test.
