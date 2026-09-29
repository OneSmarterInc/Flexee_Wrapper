# Wrapper change 6 — Publishing a book to a class

**28 September 2026** · Patch: `0006-class-publishing.patch` · apply on top of the code of 28 Sep (changes 1–5)

## The rule

A class's book is **hidden from its students until the class's faculty publish it.** Faculty (and
admins) can always open it, so they can prepare. Publishing is **per class**: publishing MIS 3250
section 01 does not open section 02.

- **New classes start unpublished.** Classes that existed before migration 0012 were marked
  published by that migration, so nothing changes for anyone already using the site.
- A fresh install's default classes (`npm run db:seed`) start published, so a new installation
  works as before.

## What changed

| Where | Change |
|---|---|
| `src/lib/publish.ts` (new) | `canManageClass` (class faculty or any admin), `classBookState`, `chooseClassBook` (only while unpublished; re-pins chapter versions), `publishClassBook` (keeps the first publication date), `unpublishClassBook` |
| `src/lib/enrolment.ts` | `enrolmentForBook` — the check every book page already uses — now grants a student access only through a class whose book is published; instructors always. New `userClasses` for the home page |
| `src/lib/roster.ts` | `createSection` leaves the book unpublished |
| `src/app/page.tsx` | Home shows **the user's own classes**, not the whole catalogue. A student sees "Your instructor hasn't opened this book yet" until publication; faculty see an unpublished warning and a Teach link |
| `src/app/actions.ts` | **Self-enrolment is retired.** The old "Enroll" button let anyone put themselves in a book's default class, which bypassed publishing and the admin model. Students join with a class code or are added by an admin |
| `src/components/ClassBookPanel.tsx` (new) | The class's book, its status, **Publish / Unpublish**, and — while unpublished — a book picker from the library |
| `src/app/class-book-actions.ts` (new) | The server actions behind the panel; each re-checks permission |
| `src/app/teach/[section]/page.tsx`, `src/app/admin/[section]/page.tsx` | The panel, for faculty and for admins |
| `scripts/seed.ts` | Default classes start published |
| `scripts/it-publish.ts` (new), `scripts/it-admin.ts` | Tests; the admin test now expects new classes unpublished |

## Apply and test

    git am 0006-class-publishing.patch
    npm run test:publish      # 14 passed
    npm run test:admin        # 12 passed

No migration: the `book_published_at` column arrived with change 3 (migration 0012).
All other suites still pass (storage 13, intake 13, and the twelve older `it-*` scripts).

## Check on the test site

1. As admin, create a class, add a faculty member and a student.
2. As the student: the class shows "Your instructor hasn't opened this book yet"; opening the
   book's address directly returns to the home page with an explanation.
3. As the faculty member: the class page shows **Not published**; switch the book if needed, then
   **Publish to this class**.
4. As the student: **Open** and **Exams** now appear.
5. **Unpublish**: the student loses access again; the faculty member keeps it.

## Next

Uploading books into the library in the app (the upload page and the intake run on screen).
