# Spec 14 — Reader frame: course header, page navigation, figures and tables list

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 2 October 2026 · Save as `docs/specs/14_Reader_Frame.md` (first commit).
Covers backlog items W1, W10 and W11. Book content and the intake are not touched.

## Why

Three gaps, seen on the live site:

1. **Pages don't say which course they belong to.** The student Exams page shows a heading and two
   buttons, and nothing about the book or class. A student in two classes, or anyone arriving from a
   link, can't tell where they are.
2. **The only way to the next or previous page is the link at the very bottom.** On a long chapter that
   means scrolling through everything, and again to go back.
3. **There is no way to jump to a figure or table.**

## Before writing any code

1. Read how course pages are built: the reading page and every other page under `src/app/[book]/`
   (exams, assignments, grades, sims), the faculty pages under `src/app/teach/[section]/`, the course
   sidebar, the shared layout and workspace components, how the previous/next order is computed
   (`getToc` in `src/lib/content.ts`), and how chapter markdown becomes HTML (remark/rehype).
2. **Report:**
   - every kind of page inside a course, and what each shows at the top today;
   - whether an "In this chapter" panel exists, and where;
   - how figures and tables appear in the rendered HTML (ids, captions);
   - for SAD and MIS 3000, **how many tables carry a numbered caption** ("Table N.M") and how many don't.
3. Propose a plan and list open questions. **Wait for my go before building.**

## What to build

### 1. Course header, on every page inside a course

- **One shared component, rendered by a layout**, so any page under `/[book]/` or `/teach/[section]/`
  gets it without changing that page. A page added later gets it automatically.
- It shows: the book's **full title** (title and subtitle from the manifest, for example "Technology and
  the Organization: An Introduction to Management Information Systems"), the **class name and term**,
  and **my role in the class** (Student or Faculty), with a link to Course home.
- Compact on a phone: the title truncates, with the full title available on tap and as a tooltip.
- Pages keep their own headings. The header only says where you are.

### 2. Moving between pages without scrolling

- **Side arrows** in the left and right margins of the text, always in view while reading: left is the
  previous page, right the next. Large, clear, with the target page's title on hover and focus. None on
  the first page (no previous) or the last (no next). Crossing a chapter boundary works as the existing
  next/previous links do.
- **Keyboard:** left and right arrow keys turn the page. Ignore them while focus is in a text field,
  select or editable area, and when Alt, Ctrl, Meta or Shift is held (Alt+Left stays browser Back).
- **Phones and tablets:** no margin room, so a **horizontal swipe**, plus two compact **Previous and
  Next buttons fixed at the bottom** of the screen. Swipes must not fire on ordinary scrolling, when
  zoomed in, or inside a figure or table that scrolls sideways.
- **At the top:** Previous and Next beside the existing Back and Course home buttons.
- **Keep the links at the bottom** as they are.
- All of these are real links with accessible names (for example "Next: Chapter 3, Emerging
  Technologies"), a visible focus outline, and touch targets large enough to hit. Respect reduced
  motion.

### 3. Figures and tables list

- A list of the **current chapter's figures and tables**, in the "In this chapter" panel if there is
  one, otherwise beside the text. Each entry shows its number and a short caption, for example "Figure
  4.2: Level 0 data flow diagram". Shown only when the chapter has any.
- **Clicking an entry jumps to it** and briefly highlights it (a highlight that is also visible
  without animation). Each figure and table gets a **stable address** built from its number
  (`#fig-4-2`, `#table-4-1`), so a link can be shared and survives a reload. A fixed header must not
  cover the target after the jump. Focus moves to the target so screen readers announce it.
- **In-text mentions** such as "see Figure 4.2" become links to the same targets, but only when that
  figure or table exists in this chapter, and never inside headings or code.
- **Tables:** list only tables that have a numbered caption "Table N.M". Don't invent numbers. Tell me
  from step 2 how many each book has; I'll take any gap to the Books coordinator.
- On a phone the list collapses behind a **"Figures and tables"** button.
- All of this is done when the page is drawn. The books' content and the intake don't change.

## Rules (tests must prove each)

1. Every page type under `/[book]/` and `/teach/[section]/` shows the course header with title, class,
   term and role, and a test page added for the purpose gets it with no change to that page.
2. Previous and next targets follow the book's order across chapter boundaries; the first page has
   no previous and the last no next.
3. The arrow-key handler ignores typing in form fields and modified keys.
4. A chapter's list contains exactly its figures, in order; every entry's target exists once in the
   rendered page.
5. In-text links appear only for figures and tables present in the chapter, and never in headings or code.
6. A chapter with no figures or tables shows no list.
7. Accessibility: links have accessible names, focus is visible, the list is a labelled navigation
   region. Run an automated accessibility check over one rendered chapter page and report what it finds.

## Process

As before: `docs/changes/14_Reader_Frame.md`; every existing suite still passes; commits authored as me;
**show me the summary and ask before pushing**; `git pull --rebase` first. No migration is expected;
if you find one is needed, tell me before building.

## Decisions (2 October 2026)

Answers settled after reading the pages this spec names. Where these differ from the sections above,
these win.

### 1. Tables: list what the manifest registers, by the book's own numbering

There is **no "Table N.M" convention in either book** - the string does not appear once in SAD or
MIS 3000. The numbering lives in each chapter's `manifest.json`, in the `figures[]` registry, whose
entries carry `kind` (`image` or `table`), `number` and `caption`.

So the list shows **whatever a chapter's manifest registers as numbered**, whether its `kind` is
`image` or `table`, labelled by its own number as the book calls it ("Figure 6.1"). A table entry
additionally carries a small **"table"** tag so a reader can tell them apart. Unregistered tables are
ignored. No "Table N.M" convention is introduced and no standard changes.

What that means per book, counting chapters only:

| | Markdown tables | Registered and numbered | Numbered figures |
|---|---|---|---|
| SAD | 32 | **0** | 48 images |
| MIS 3000 | 10 | **9** (as `kind: "table"`) | 16 images |

MIS 3000 numbers its tables in the **Figure** sequence and its prose calls them "Figure 6.1"; SAD
registers no tables at all. Both gaps are content matters for the Books coordinator, not for this
spec.

### 2. The list's heading is derived from the chapter

"**Figures**" when the chapter registers no tables, "**Figures and tables**" when it registers any.

### 3. Tables are captioned only when the counts agree

Nothing in the markdown says which `<table>` belongs to which manifest entry, so they are matched by
**document order** - and only when a chapter's markdown table count equals its manifest table count.
Where the counts differ, **none** of that chapter's tables is captioned and none appears in the list,
rather than risk captioning the wrong one.

Chapters affected today: **none**. Every chapter that registers a table has exactly as many
rendered tables as it claims, so all 9 of MIS 3000's registered tables are captioned and listed.
(An earlier count of this put MIS 3000 at 11 tables with ch14 ambiguous. That was a miscount: the
regex used to find table separator rows also matched an empty body row, `| | | | | |`, in ch14. The
rendered count is 10 tables, and ch14 holds one table matching its one claim.)

Two cases remain where nothing is captioned, correctly:

- **MIS 3000 ch08** - 1 rendered table, 0 registered: nothing is claimed, so no number is invented.
- **SAD, every chapter** - 32 rendered tables, 0 registered, so none is captioned.

The guard still matters even though nothing trips it today: document order is the only way to tell
which table is which, so one unaccounted-for table would shift every number after it. It is tested
with a constructed chapter rather than a real one.

### 4. The header shows the manifest's title, then its subtitle

Show `title`, then `subtitle` when there is one. **No content is edited.** The long title this spec
quotes as an example is not in the manifests, and a separate spec will make the register's Title the
source.

Recorded from reading the intake, because it explains why: `tools/flexee_intake.py` does **not derive
the title from anything**. At the point it writes `book.manifest.json` it reads the *previous*
manifest at the output path and carries the old values forward:

```python
base = json.loads(prev_book.read_text()) if prev_book.exists() else {}
bm = {..., "title": base.get("title", book.upper()), "subtitle": base.get("subtitle"), ...}
```

With no previous manifest, `title` falls back to **the book id uppercased** ("SAD", "MIS3000") and
`subtitle` to **null**. The register is parsed for Publisher, Author, Editor, Edition, Chapters,
Figures and Book version - but **not for a Title**, and the SAD register carries no Title row. So the
future spec needs both a Title row in the register standard and a change here to read it.

### 5. One compact line, not a block

The header is one line: book title · class and term · role, with a Course home link. On pages that
use the workspace shell it belongs in the heading area, above the page's own heading, so the stack
never reaches three titles. On the 13 bare faculty pages it goes at the top. Those 13 are **not**
moved onto the shell; that is a separate task.

### 6. Page turning is reading-page only

The header goes on every course page. The side arrows, arrow keys, swipe and the fixed Previous and
Next bar apply to the reading page alone.

### 7. Accessibility check: axe in jsdom

axe-core run in jsdom, as a devDependency, is enough for this spec. Its limits are stated plainly in
the summary: jsdom computes no layout and paints nothing, so it cannot judge colour contrast, whether
a focus outline is actually visible, hit-target size, or live focus and scroll behaviour after a jump.
Those remain checks by eye.
