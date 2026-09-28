# Wrapper change 3 — Administrators, classes, faculty and students

**For:** Akshay · **From:** Vikram · **27 September 2026** · Patch: `0003-admin-classes-faculty-students.patch`
**Apply after** patches `0001` and `0002`.

## The model (Phase 1 of the teaching platform)

Three kinds of people:

| Who | Can |
|---|---|
| **Admin** | Create classes; add faculty and students to any class; see every class |
| **Faculty** | Teach the classes they are added to (records, gradebook, quizzes — as today) |
| **Student** | Read and take quizzes in the classes they are in |

Being an admin does not make someone a teacher: a class's faculty are the people added to it as
faculty. An admin who also teaches (Vikram) ticks **I teach this class** when creating it.

**Classes are now created by admins only.** Faculty see "Classes are set up by an administrator".

Coming next in Phase 1: book upload into a **library** by faculty or admins, with each class's
faculty **publishing** a book to their class before its students can see it (the database column
for that, `sections.book_published_at`, is added now), then **assignments and case studies** with
submission and grading.

## Apply

```
git am 0003-admin-classes-faculty-students.patch
npm install
npm run db:deploy          # applies migration 0012
```

Migration `0012_admin_roles` adds three columns and is safe on the live database:
`users.system_role` (default `user`), `roster_invites.role` (default `student`), and
`sections.book_published_at` (existing classes are marked published, so nothing changes for them).

## Make the first admin

Nobody is an admin until you make one. Vikram signs up normally on the site, then from a machine
with the database address in `.env`:

```
npm run admin:set -- vikram@<his sign-in email>
```

It prints the name and confirms. More admins can be made the same way (`--remove` takes it away).
After that, **Administration** appears for admins on the teaching page, at `/admin`.

## What an admin does

1. **/admin** — every class, grouped by term, with its book, faculty, student count and pending
   invitations. **Create a class**: book, class name, term, and "I teach this class".
2. **/admin/<class>** — the class's join code, and two lists:
   - **Faculty** — add by email (`email` or `email, name`, one per line).
   - **Students** — add by email the same way, or upload a CSV class list (`email, name`).

   People who already have an account are in the class at once. Anyone else gets an
   invitation and **lands in the class, with the right role, when they sign up with that email** —
   no email service needed. Remove people, or withdraw invitations, from the same page.

Rules the code enforces: a faculty member is never demoted by appearing in a later student list;
someone added as faculty is promoted if they were a student; header rows, blank lines, invalid
addresses and duplicates in a list are skipped.

## Tests

```
npm run test:admin         # 12 passed
```

Covers the migration on a database that already has classes and invites; making an admin by
email; creating a class with and without teaching it; adding faculty and students with and without
accounts; invitations becoming the right role on sign-up; the no-demotion rule for enrolments and
invitations; invitations withdrawable only within their own class; the admin overview.

**Also fixed:** ten older test scripts listed their migrations by name and had gone stale (eight
were already failing on `main` before this patch). They now load every migration, and all pass:
`it-console`, `it-scaffolding`, `it-gradebook`, `it-gb-starter`, `it-mastery`, `it-assessment`,
`it-acceptance`, `it-content`, `it-recovery`, `it-instr-reset` — plus `it-aol`, `it-meta`,
`test:storage` and `test:intake`.

## Check on the test site

1. Sign up as a new user; confirm **/admin** says it is for administrators.
2. `npm run admin:set -- <that email>`; reload; **Administration** appears.
3. Create a class without "I teach this class". Add a faculty member who has an account and one who
   does not; add three students by paste and two by CSV.
4. Sign up as the invited faculty member: the class appears under **My courses**, as faculty.
5. Sign up as an invited student: the class's book appears on their home page.
6. As a non-admin faculty member, confirm the teaching page no longer offers "Create a section".
