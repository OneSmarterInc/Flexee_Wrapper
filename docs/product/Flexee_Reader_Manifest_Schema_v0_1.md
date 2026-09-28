# Flexee Reader — Manifest Schema

**Spec, v0.1 — 15 September 2026**
**Stack: Next.js (App Router) + PostgreSQL + Drizzle. TypeScript end to end.**
**Scope: the content contract for the manifest-driven reader. One book (SAD) in it for Spring, second book = data change.**

This turns the reader's current single `BOOK` object into a versioned, manifest-driven content contract, and specifies how a section reads a pinned set of chapter versions. It is the "chapter format is an interface" work from the platform direction, made concrete.

---

## What exists today, and what changes

The reader renders from one in-file `BOOK` object: `{ title, meta, chapters: [...] }`. Each chapter is `{ num, label, title, sections: string[], html, front }` — 12 chapters plus 7 front-matter entries, opening on the Preface. Figures are inline base64 PNGs; section anchors already use stable ids like `c5s4`.

Three things change:

1. **`BOOK` is externalized** into a book manifest plus one manifest-and-content file set per chapter. The reader loads a manifest instead of embedding content.
2. **Figures are extracted** from inline base64 into named asset files, referenced by id. This is the single largest migration task and the thing that makes the format a contract rather than a blob.
3. **Content is versioned.** A chapter has versions; a section pins the version it reads; bookmarks resolve against the version they were made in.

Everything else in the reader — the navy/ice palette, Georgia serif, dark mode, progress bar, per-account bookmark and resume logic — carries over unchanged.

---

## File layout

```
content/
  sad/
    book.manifest.json
    preface/
      manifest.json
      content.md
    ch05/
      manifest.json
      content.md
      figures/
        fig-02.png
        fig-03.png
    ...
```

`sad` is the book id (matches `"book": "sad"` already used in the question schema, so the two input formats share the identifier). Front-matter entries (`preface`, `dedication`, `glossary`, …) sit alongside chapters; they differ only by `kind`.

---

## Book manifest — `book.manifest.json`

Identifies the book, sets copyright/licence, names the reader's opening entry, and lists the spine in reading order. It carries no content — only ordering and references to chapter manifests.

```jsonc
{
  "schemaVersion": 1,
  "id": "sad",
  "title": "Analysis and Design of Information Systems",
  "subtitle": "MIS 3250",
  "copyright": "Flexee",
  "license": "read-only",
  "defaultEntry": "preface",
  "spine": [
    { "ref": "dedication", "kind": "front" },
    { "ref": "preface",    "kind": "front" },
    { "ref": "ch01",       "kind": "chapter" },
    { "ref": "ch05",       "kind": "chapter" },
    { "ref": "glossary",   "kind": "front" }
  ]
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Version of *this schema*, not the book. Lets the reader reject a manifest it can't parse. |
| `id` | Stable book identifier. Second book (`mis3000`) is a new folder + spine, no code change. |
| `copyright` / `license` | `read-only` encodes the adopter-licence decision: no modification, no redistribution. |
| `defaultEntry` | Which spine `ref` the reader opens on — Preface, matching current behaviour. |
| `spine` | Ordered entries. `ref` points to a chapter-manifest folder; `kind` is `front` or `chapter`. Order here is reading order, so front matter, chapters, and back matter interleave naturally. |

The spine references chapters but does **not** pin versions. Which version a reader actually sees is a per-section decision, held in the database (see "The reading contract" below). The book manifest describes the book as published; the section decides what it reads.

---

## Chapter manifest — `chapter/manifest.json`

The contract. One per chapter and per front-matter entry. Holds metadata, the content pointer, the section list (for the side TOC and bookmark anchors), and the figure registry.

```jsonc
{
  "schemaVersion": 1,
  "id": "ch05",
  "book": "sad",
  "kind": "chapter",
  "number": 5,
  "label": "5",
  "title": "Entity-Relationship Diagrams & Normalization",
  "version": 2,
  "contentHash": "sha256:9f2c…",
  "content": "content.md",
  "sections": [
    { "id": "c5s1", "title": "From Business Rules to a Data Model" },
    { "id": "c5s4", "title": "The Associative Entity" }
  ],
  "figures": [
    {
      "id": "fig-sad-c05-02",
      "src": "figures/fig-02.png",
      "alt": "A first-pass model with the student-to-section relationship unresolved",
      "caption": "Figure 5.2: A first-pass model with the student-to-section relationship unresolved",
      "anchor": "c5s3"
    }
  ],
  "updatedAt": "2026-09-15T00:00:00Z"
}
```

| Field | Meaning |
|---|---|
| `kind` | `chapter` or `front`. `number`/`label` are null for front matter. |
| `version` | Integer, bumped on every republish. This is what a section pins and what a bookmark records. |
| `contentHash` | Hash of `content.md`. Powers the faculty **chapter diff view** — the feature the console depends on — without re-reading the prose to detect a change. |
| `content` | Path to the markdown, relative to the chapter folder. |
| `sections` | Ordered. `id` matches the anchor in the markdown (`{#c5s1}`); `title` feeds the side TOC. Bookmarks point at a section `id` plus an offset. |
| `figures` | Registry. Each figure has a stable `id`, a file `src`, `alt` for accessibility, the rendered `caption`, and the section `anchor` it belongs near. |

### Markdown heading discipline (`content.md`)

The contract that lets one reader render any book. The current chapters already follow most of this; codifying it is what generalizes it.

| Markdown | Role |
|---|---|
| `# Title` | Chapter title (one per file). |
| `## Section` | Major section: a numbered section, `Case Study`, or `Review Questions & Exercises`. |
| `### N. Name {#c5s4}` | Numbered teaching section. The `{#…}` anchor **must** match a `sections[].id`. |
| `#### Name` | Subsection (e.g. "Second Normal Form"). |
| `![alt](figures/fig-02.png){#fig-sad-c05-02}` | Figure reference. The `{#…}` must match a `figures[].id`. |

Two rules the reader relies on: every `###` anchor appears in `sections`, and every figure reference resolves to a `figures` entry. A build-time validator rejects a chapter that breaks either — that is what keeps the format a contract rather than a convention.

---

## The reading contract (database, Drizzle)

"The manifest is the heart of it": a section reads a pinned set of chapter versions, so Faculty A on Chapter 5 v2 and Faculty B on v1 are both correct. The manifests above describe content; these tables decide what a given section sees, and everything hangs off enrolment.

```
Book ──< Chapter ──< ChapterVersion
                          │
Section ──< SectionContentPin >── ChapterVersion   ← what this section reads
   │
   └──< Enrolment >── User
                          │
                     Bookmark (→ ChapterVersion + section anchor + offset)
```

A Drizzle sketch of the pieces the manifest touches (Spring-scope marked):

```ts
// Spring: books, chapters, versions — loaded from the manifests above
book            = { id, title, subtitle, copyright, license, defaultEntry }
chapter         = { id, bookId, kind, number, label, title }
chapterVersion  = { id, chapterId, version, contentHash, contentRef, updatedAt }

// Spring: one section, everyone in it — but the shape is the full model
section         = { id, bookId, name, externalContextId /* nullable — LTI seam */ }
enrolment       = { id, sectionId, userId, role }          // entitlement lives here
sectionPin      = { sectionId, chapterId, chapterVersionId } // the reading manifest

// Spring: per-account bookmarks, versioned so republish can't orphan them
bookmark        = { enrolmentId, chapterVersionId, sectionAnchorId, offset, updatedAt }
```

Two things this buys, both from the platform direction:

- **Bookmarks record `chapterVersionId`, not just a position.** That answers the mid-semester-republish open question *without forcing the decision now*: if you allow republish, a bookmark still resolves against the version it was made in; if you block it, nothing changes. Either policy sits on the same schema.
- **`externalContextId` is a nullable column from day one.** That is the LTI seam left open — empty for a faculty-created section, populated later if a section comes from an LMS. No rewrite to add LTI.

For Spring the whole thing runs with one `section`, one `sectionPin` per chapter (pinned to latest), and every student on one `enrolment`. That is the "put enrolment in the first migration" instruction, satisfied cheaply.

---

## First migration task

Extract figures from the reader's inline base64 into `content/sad/<chapter>/figures/*.png`, assign each a stable id (`fig-sad-cNN-SS`), and rewrite the chapter HTML/markdown to reference them. The caption ids already in the reader (`Figure 5.2:` …) give the numbering for free. Once figures are files, the rest of `BOOK` maps mechanically onto the manifests above.

---

## What this deliberately leaves for later

Faculty console (diff view, publish, notifications), the question bank (its schema is already specified and is a sibling input format to this one), team formation, the tutor's book-scoped context, and LTI itself. None of them change the schema above; each attaches to it. Two decisions still shape the edges — branding (book id and domains) and the mid-semester-republish policy — but neither blocks building the reader against this schema.
