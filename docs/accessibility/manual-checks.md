# The thirty-minute accessibility check

A script for one person, a keyboard and a screen reader. Nothing here needs a developer: it is six
short passes over the parts of the Wrapper a student or a faculty member actually uses.

Everything in it is something the automated suites **cannot** judge. `test:a11y-pages` runs axe over
all 44 pages, but jsdom paints nothing and lays nothing out, so it has no opinion on whether a focus
ring is visible, whether a target is big enough, what a screen reader actually says, or whether the
order things are read in makes sense. That is what this is for.

## Before you start

**NVDA** (Windows, free) from <https://www.nvaccess.org/download/>. On a Mac, VoiceOver is already
there: ⌘F5.

Three keys do most of the work.

| | NVDA | VoiceOver |
|---|---|---|
| Start and stop | Ctrl+Alt+N / Insert+Q | ⌘F5 |
| Read the next thing | Down arrow | VO+→ (Ctrl+Option+→) |
| Jump by heading | H | VO+⌘+H |
| List the headings | Insert+F7 | VO+U, then → to Headings |
| Stop it talking | Ctrl | Ctrl |

**Put the mouse away.** Not beside the keyboard — out of reach. Every step below is Tab, Shift+Tab,
Enter, Space, the arrows and Escape. If you find yourself reaching for the mouse, that is a finding.

Record what you find at the bottom of this file, under a dated heading, and open an issue for
anything that stops you. A sentence and the page is enough: "On the gradebook, Tab goes from the
last score box to the top of the page" is a complete report.

---

## 1 — Sign in (4 minutes)

Start at `/login`, signed out, with NVDA running.

1. Press Tab **once**. You should hear **"Skip to content, link"** and *see* it appear near the top
   left. Press Enter. Focus should land on the page's main text.
2. Tab through the form. Each box should announce its own name: **"Email, edit"**, then
   **"Password, protected edit"**. If you hear only "edit", the label is not tied to the box.
3. Look at each box as you reach it. There should be an obvious ring **around** it, clear of the
   box's own border. If you cannot tell which box has focus from across the desk, that is a finding.
4. Submit the form empty. You should *hear* the error without going looking for it, and when you Tab
   back to a box you should hear the error again as part of that box.
5. Sign in wrongly on purpose. Same two things: announced at once, and repeated on the field.
6. If you use a password manager, check it offers the saved password here, and offers to **save a
   new** one on `/signup` rather than filling the old one in.

## 2 — A set-password invitation (3 minutes)

Open a `/set-password?token=…` link from an invitation, or `/set-password?expired=1` for the dead
case.

1. One heading, and the page's title in the window or tab should read **"Set your password —
   Flexee"**.
2. The box should announce **"New password, at least 8 characters"**, not "edit".
3. On the expired page, the line about the link having expired should be **read out**, and `Forgot
   password` reachable by Tab.

## 3 — A chapter, with a figure and a table (8 minutes)

Sign in as a student and open a chapter — `/sad/ch04` has both a figure and a table.

1. Press Insert+F7 (NVDA) for the heading list. Read it. The chapter title should be the only
   **level 1**, its sections all at **level 2**, and nothing should jump a level. A list that reads
   1, 3, 3, 3 is the fault this spec fixed; if you see it again, say so.
2. Press H repeatedly and listen. The sections should come in the order the "In this chapter" list
   gives them.
3. Arrow down to a figure. You should hear a description of the **picture** — "Context diagram for
   the course registration system" — and then its caption. If you hear only "Figure 4.1", the alt
   text is not doing its job; note the chapter and the figure number.
4. Where a figure has a **Description** collapsible under it: Tab to it, press Enter or Space. It
   should open, and you should hear "expanded". Press it again: "collapsed". Read the description —
   it should tell you what is in the picture, not repeat the caption.
5. Find a table. Arrow into the middle of it. Your screen reader should name the **column** as it
   reads each cell: "Physical DFD, column 2, …". If it reads only the value, the header cells are
   not marked up.
6. Turn the page with the Previous/Next controls, by keyboard. Each should say **where it goes**, not
   just "next".
7. Narrow the window to about a phone's width. The page arrows should give way to a bar at the
   bottom. Both should be easy to hit with a thumb — about the size of a fingertip, not a pea.

## 4 — Sitting an exam (5 minutes)

Open an exam as a student.

1. Each question's options should be reachable by Tab and selectable with **Space**, and each should
   announce its own text.
2. Check the order things are read in matches the order they appear. A question read after the
   options that belong to it is a finding.
3. Submit. Whatever the page says next should be **announced**, not just drawn.

## 5 — Submitting an assignment (3 minutes)

1. The file picker should announce what it is for before you open it.
2. Attach something. The page's confirmation should be read out.
3. Check the due date and any "late" marking are **read**, not only coloured.

## 6 — The class list, and the dialog (7 minutes)

Sign in as faculty and open a class.

1. Tab to a student's checkbox. You should hear **"Select Maria Alvarez, checkbox, not checked"** —
   the student's own name, not "checkbox".
2. Select two students with Space. The bar that appears should be **read out** as it appears.
3. Press Remove. The dialog opens. Now the important part: **Tab around it twenty times.** Focus must
   stay inside the dialog. If it escapes to the page behind, that is the most serious finding on this
   list — a screen reader user cannot find their way back.
4. Read what the dialog says. The counts should be read as a sentence, and the box you type the
   phrase into should announce what it wants.
5. Press **Escape**. The dialog should close, nothing should be deleted, and focus should return to
   the Remove button you came from.
6. Download the invitation links. Check the file saves with a sensible name, and that the warning
   about treating it like a list of passwords is **read**, not only shown in small print.

## Both themes, and no motion

Run at least steps 1, 3 and 6 again with:

- **Dark mode.** The toggle is in the corner of every page. Everything that was legible should stay
  legible: there is no colour in the app that is not defined for both themes, but a composited
  result is still worth one person's eyes.
- **Reduced motion on.** Windows: Settings → Accessibility → Visual effects → Animation effects off.
  Mac: System Settings → Accessibility → Display → Reduce motion. Nothing should slide, fade or
  pulse. The highlight that marks a figure you jumped to should simply **be there**, not flash.

## What this does not cover, and who does

| | |
|---|---|
| axe over all 44 pages, every impact | `npm run test:a11y-pages` |
| every colour pair in both themes, computed from the tokens | `npm run test:a11y-colour` |
| no hand-written colour anywhere in `src` | `npm run test:a11y-source` |
| heading outlines over all 38 chapters of three books | `npm run test:headings` |
| figure captions, long descriptions, table headers | `npm run test:figures` |
| contrast as composited, visible focus, target size, the focus trap | `npm run a11y:browser` (opt-in) |
| **whether any of it is actually usable** | this script |

The last row is the reason the others are not enough.

---

## Findings

Add a dated heading and your notes. Keep the ones that were fixed; a list of what used to be wrong
is how the next person knows what to watch.

<!-- ### 2026-10-05 — first run, NVDA 2024.4, Firefox
     (nobody has run it yet) -->
