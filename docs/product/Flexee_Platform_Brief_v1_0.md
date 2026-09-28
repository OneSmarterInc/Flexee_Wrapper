# Flexee Platform — consolidated brief

**Version 1.0 — 10 September 2026**
**Everything known about the platform, in one file.**

Paste this into a new conversation to start work on the Flexee platform with full context. It consolidates three documents that were written separately: the platform direction, the assessment layer, and the standalone-first revision. Where they disagreed, the later one wins and the change is marked.

---

## Read this first

**Nothing here is committed or scheduled.** This is direction. Spring 2027 needs a student reader for one book and one section — everything else on this page is where the thing is going, not what is being built.

**How it came about.** The platform was not designed up front. It emerged across one working conversation, each piece prompted by a specific need: a reader with a table of contents and a bookmark; then a faculty version where content reaches the instructor before students; then a second book, which turned one product into a catalogue; then D2L, which settled that it must be one platform with one identity; then a library of short simulations, which made a course a schedule rather than a bundle; then a comparison with McGraw Hill's SIMNET, which exposed the assessment gap; then the observation that LTI approval may never come, which inverted the whole deployment story.

**What exists today**, built and tested, outside the platform:

| Artifact | State |
|---|---|
| The SAD book | 12 chapters, 27,183 words, 48 figures. Written, audited, compiled. |
| `SAD_Reader_v1.0.html` | Single-file reader — TOC, bookmark, progress, dark mode, mobile. 1.6 MB, no server. |
| MVCFN simulation engine | v1.0.2. 28 API endpoints, tested end to end. |
| Student workspace, instructor console | v1.1 each. Vite + React. Built, not deployed. |
| Adopter package | 13 de-coursed decks, answer key, faculty guide, two student guides, the book in three forms. |
| RapidSims, RapidSims+ | Exist. Not examined in this conversation. |

**The platform is what turns those into a product.**

---

## What Flexee is

**An LMS-integrated platform of books and simulations, adopted per course section.**

Not a textbook website with a simulation attached. A catalogue a faculty member draws from, and a schedule they assemble from it.

The unit of adoption is a **section**, not an institution and not a person. A colleague adopts a book and some simulations for their Spring section; entitlement flows from enrolment in that section and ends when the term does.

---

## The catalogue

| Kind | Built | Planned |
|---|---|---|
| Books | Analysis & Design of Information Systems (MIS 3250) | Introduction to MIS (MIS 3000) |
| Long simulations | MVCFN — semester-long, teams of four, nine AI stakeholders | — |
| Short simulations | RapidSims, RapidSims+ | A series, reusable across courses |

**The short simulations are strategically important.** A one-week sim can be adopted across MIS 3000, MIS 3250 and a colleague's operations course. It is reusable in a way a semester-long simulation is not, and it is what a cautious adopter tries first. Adoption probably starts there and grows toward the book and the long sim, not the other way round.

---

## The core model

```
Student ──< Enrolment >── Section ──< Adoption >── Book / Simulation
                │                         │
        bookmarks, tutor history,    course plan: what is
        team memberships             released, and when
```

### Four rules that follow

**1. Entitlement lives on the enrolment, never on the user.**
A student reads the SAD book because they are enrolled in a section that adopted it — not because they "have" it. Drops, transfers, auditing and repeating the course next year all resolve without anyone revoking anything.

**2. One identity, many enrolments.**
A student in two Flexee-adopting courses signs in once and picks a course. Two logins would be an obvious defect and there is no acceptable version of it. This is settled by the LTI ambition regardless — two tools in one D2L shell is untenable.

**3. A course is a schedule, not a bundle.**
Faculty adopt a book and a library of simulations, then decide week by week what appears. Week 3 gets one RapidSim, Week 5 another. Nothing is predetermined by adoption. The platform needs a **course plan** between adoption and student visibility, and a **release** concept — content exists but is not visible until published.

**4. Teams belong to a section and a simulation, not to a student.**
Groups differ between simulations, and typically should. Faculty form teams per simulation, per section.

---

## Team formation is a platform capability

Not an MVCFN feature. Each simulation declares what it needs; the platform provides one mechanism.

```
Simulation declares:   team_mode: required | optional | individual
                       team_size: 4
Faculty sees:          who is enrolled
Faculty chooses:       auto-random | manual | self-select | individual
Platform produces:     teams within that section, for that simulation
Simulation consumes:   teams as given
```

Faculty learn one mechanism whatever they adopt. Without this, every new simulation reimplements roster handling and none do it identically.

**Open questions:** can teams change mid-term (MVCFN teams hold a budget ledger and submissions, so this is not a simple membership edit)? Do teams persist across simulations in the same section (faculty choice, but the platform must allow either)?

---

## The reader

### Student reader
Chapters, side table of contents, bookmarks per account, and an **AI tutor** in the right margin.

**Tutor behaviour, decided:** it answers and explains. The review questions are not graded — the simulation is the assessment — so a tutor that answers them is helping someone learn rather than letting them skip a gate.

**Two constraints:**
- Scope its context to the book. Because the SAD chapters are strictly decoupled — no MVCFN, no food bank, no simulation content anywhere — a tutor scoped to the book *cannot* leak simulation answers. It has never seen them. The editorial decoupling rule protects the tutor by construction.
- The faculty answer document must never enter the tutor's context. Not because answering is wrong, but because those answers are written for instructors and shouldn't reach a student-facing surface by accident.

**For adopters:** ship the tutor off by default, bring-your-own-key. Flexee owns the book; it shouldn't own another institution's API bill.

### Faculty console

Faculty are publishers to their own section. Content reaches them first; they decide what reaches students.

| Feature | Notes |
|---|---|
| Errata | **Push automatically.** A correction is not a pedagogical choice. |
| Chapter upgrades | **Gated.** Notification → review → one-click publish to their section. |
| New editions and new books | Notification, review, dismiss when handled. |
| **Chapter diff view** | The feature everything else depends on. If reviewing an upgrade means re-reading 2,400 words, most faculty won't, and the notification becomes noise. |
| Answers to review questions | 80+ questions. The most-requested adopter material. |
| Slide decks | De-coursed — one set, MIS 3250 references removed. |
| Teaching notes per chapter | Where students get stuck, timing, what to emphasise. |
| Term mapping | The book assumes 14 weeks. A 10-week quarter needs guidance on what to cut. |
| Test bank | Distinct from review questions. |
| Reading analytics | Which chapters opened, where students stopped. Students should be told this exists. |
| **Support chat with Flexee** | Async, threaded, **attached to the chapter it was sent from**. Serves errata reports, teaching questions and adoption queries through one channel. |

**The manifest is the heart of it.** A section reads a pinned set of chapter versions. Faculty A publishes Chapter 5 v2; Faculty B doesn't. Two sections, two different Chapter 5s, both correct.

**Open question:** can a chapter change mid-semester? A student halfway through Chapter 5 has a bookmark pointing into text that no longer exists. Either block mid-term publishing, or version bookmarks against chapter versions.

---

## The chapter format is an interface

Two books sharing one reader means the storage format stops being an implementation detail and becomes a **contract**: markdown with a known heading discipline, figures named and referenced consistently, a manifest per chapter.

The MIS 3250 chapter build brief already specifies exactly this. **It should be rewritten as a platform input specification** rather than instructions for one book's writing team. It is the part of the SAD work that generalises furthest.

*(Realised as `Flexee_Reader_Manifest_Schema` in `specs/`.)*

---

## Source-of-truth reversal — SAD only, decided 9 Sep

Chapters were derived from deck speaker notes. **That reverses: chapters become source, decks derive from chapters.**

Two consequences to handle:

- **The mapping is not 1:1.** Twelve chapters, fourteen weeks. Weeks 7 and 8 have no chapter and sit outside the derivation.
- **Some deck content has no chapter home.** The approved notes carry course mechanics — milestone references, scoring, rework multipliers — that chapters deliberately exclude. If chapters are the only source, that material is orphaned.

**So the rule is:** chapters are source for *teaching content*; decks carry an additional course-mechanics layer that exists only in the deck and survives regeneration.

---

## D2L and LTI

**Superseded — see Appendix B.** Standalone is the default; LTI is a seam it attaches to. The three seams below stand; the framing does not.

### The original framing, kept for the seams

Down the road. **LTI 1.3** — faculty add Flexee as an external tool, students click through already authenticated, grades flow to the gradebook.

Not to be built now. But three things should be built *so as not to preclude it*, all cheap today and expensive later:

| Now | Why |
|---|---|
| Identity is **pluggable** — a user has one or more identities | Email-and-password as the only path means rewriting auth to add LTI |
| Sections carry a **nullable external context id** | Otherwise LMS-created and manually-created sections need reconciling forever |
| Gradeable things have a **line item** concept | The simulation grades. Those scores eventually map to gradebook columns. |

---

## What this means for the MVCFN engine

Its current auth is a team code from an environment variable, with no notion of section, roster or student. That is correct for one class run by its author.

Under the platform, teams come from the roster and students authenticate as themselves. **That is a real change to the engine's auth**, touching the same tables as the Postgres port.

**Not a reason to change the port** — it should ship as specified. Recorded so nobody is surprised.

---

## Sequencing

**Spring 2027 needs a student reader for one book and one section. Nothing else on this page.**

The trap is building only that. A hardcoded single-book reader is fast and is exactly what gets thrown away when the second book arrives.

**The middle path: build the reader manifest-driven from day one, ship it with one book in it.** Adding a second book becomes a data change rather than a rewrite.

| | Work | When |
|---|---|---|
| 1 | Front matter, author's preface, glossary | Now — pure content, needs no platform |
| 2 | Student reader — manifest-driven, one book | Before Spring |
| 3 | Accounts, enrolment, bookmarks | With the reader |
| 4 | AI tutor | With or shortly after |
| 5 | Faculty console, versioning, publishing, tenancy | After Spring, when adopters exist |
| 6 | RapidSims library, course plan, team formation | As the sims are built |
| 7 | LTI / D2L | When adoption justifies it |

**Even in step 3, put `enrolment` in the first migration** — with exactly one section and everyone in it. That is the cheap version of this entire document.

---

## Decided in this conversation

| Question | Answer |
|---|---|
| Reader or textbook? | **Reader.** Concise by design, best with a simulation alongside. |
| Copyright | **Flexee.** |
| Adopter licence | **Read only.** No modification, no redistribution. |
| Bookmarks | **Per account** — so the reader needs identity and a database. |
| AI tutor | **Answers and explains.** Scoped to the book. Off by default for adopters, bring-your-own-key. |
| Deck variants | **One de-coursed set.** |
| Reader vs compiled HTML | **The reader is the product.** The compiled HTML becomes a fallback. |
| Reader and simulation identity | **One platform, one identity.** Settled by the LTI ambition. |
| Source of truth | **Reversed for SAD** — chapters are source, decks derive. |
| Platform stack | **Next.js (App Router) + PostgreSQL + Drizzle, TypeScript end to end. No Laravel.** *(Added 15 Sep.)* |

---

## Assessment

**See Appendix A** for the schema and the reasoning.

---

## Still open

1. Can a chapter be republished mid-semester, and what happens to bookmarks?
2. Do teams persist across simulations in a section, or are they formed fresh each time?
3. Can team membership change mid-term, given MVCFN teams hold a budget ledger and submissions?
4. Is the platform Flexee-branded, or does a colleague adopt a named book? Affects naming and domains.
5. Does the MVCFN simulation eventually run inside the platform, or stay a separate deployment the platform links to?
6. What else belongs in the faculty version — the list above is a start, not a specification.

---

# Appendix A — Assessment layer

## What this is for

The comparison that prompted it: McGraw Hill's SIMNET holds the book, the quizzes and the assignments, does the grading, and passes a number to the institution's LMS. The LMS is only a grade viewer. The hard work is on the publisher's side.

**Flexee occupies the same position, and already does the harder half.**

| SIMNET | Flexee |
|---|---|
| The platform holds the content | The reader |
| Quizzes, tests, auto-graded exercises | **Missing** |
| Assignments and grading | The simulation — five indices, 60/40 split |
| Grade transfer | LTI AGS, when it exists |
| The LMS | Grade viewer, same role |

**The gap is the routine half.** Flexee assesses judgment — whether a team discovered the right requirements and can defend a model — which SIMNET cannot do. It has no quizzes, no test bank, no exams. An adopter comparing the two finds Flexee does the difficult thing well and the ordinary thing not at all.

**Intended end state:** an adopter selects questions for an exam, or has them served at random, students take it in the platform, scores are recorded, and those scores travel with the simulation grades when LTI arrives.

## The one decision that must be made before question one is written

**Write the bank as structured data. Never as prose in a document.**

A question living in a Word file is a paragraph. A question living as a record can be filtered, sampled, randomised, scored and reported without anyone touching it again. Converting a thousand questions from the first form to the second is a project; starting in the second form costs nothing.

**The bank is a platform input format, exactly as the chapter format is.** That comparison is the point: the chapter build brief turned out to be a specification for what the reader consumes. The question schema is the same kind of artifact, and it should be written down before there is content to migrate.

### Schema

```json
{
  "id": "sad-c04-017",
  "book": "sad",
  "chapter": 4,
  "section": "Balancing across levels",
  "objective": "Explain the balancing rule and why it matters",
  "type": "multiple_choice",
  "difficulty": "apply",
  "stem": "A Level-0 process shows three inbound and two outbound flows...",
  "options": [
    { "id": "a", "text": "...", "correct": false,
      "rationale": "Why a student who picks this has misunderstood." },
    { "id": "b", "text": "...", "correct": true,
      "rationale": "Why this is right." }
  ],
  "points": 1,
  "shuffle_options": true,
  "tags": ["dfd", "balancing", "review"]
}
```

**Fields that matter and are easy to omit:**

`objective` — what the question tests, not what it is about. Without it an adopter cannot assemble an exam that covers a chapter's aims rather than its vocabulary.

`difficulty` — recall, apply, analyse. A random draw with no difficulty control produces an exam of definitions.

`rationale` **on every option, not only the correct one.** This is what makes a wrong answer teach something, and it is the field nobody writes retrospectively.

`section` — lets a question be tied to where the reader covers it, which is what allows "revise this" to point somewhere.

## What the bank is not

**The 84 review questions in the book are not quiz questions and do not convert.** They are open and discursive by design: *give the strongest case for this position, then explain why restraint is usually better.* No machine grades that, and making them machine-gradable would destroy what they are for.

**The auto-graded bank is new content.** Roughly twenty to thirty questions per chapter, so two to four hundred for the book. A real writing job, best done a chapter at a time.

The review questions and their answer key remain useful as **source material** — a good multiple-choice question is often a distillation of a discursive one, and the answer key already records the common misunderstanding each question targets, which is where the wrong options come from.

## What the platform will need

| Piece | Note |
|---|---|
| Question bank storage | Per book. Versioned like chapters. |
| Assembly | An adopter picks questions, or specifies a draw — five from chapter 4, mixed difficulty. |
| Random serving | Different students get different questions from the same pool. Requires enough questions per objective to make that fair. |
| Attempt and scoring | Per enrolment, like everything else. Time limits, attempt limits, whether feedback shows immediately. |
| Reporting | Per student, and per question so an adopter can see which item everyone got wrong. |
| Grade line items | Each exam becomes a gradebook column, alongside the five milestones. |

**All of it hangs off enrolment**, like the reader and the simulation. Nothing here changes the core model.

## Sequencing

**Not now.** Spring 2027 needs the reader and the simulation. This is direction. When it does start, the order that avoids waste:

1. **Fix the schema.** Cheap now, expensive after a thousand questions exist.
2. **Write one chapter's questions** against it and see what the schema forgot.
3. Build storage and assembly.
4. Build attempts and scoring.
5. Wire scores to LTI line items when LTI arrives.

**Step 2 is the one people skip.** A schema that has never had real content written against it is always missing a field.

## What to say to adopters, and where

**In conversation: say it.** A colleague deciding whether to adopt is entitled to know where the platform is going, and it is true.

**In the faculty guide, or anything printed: do not.** The guide currently promises only what exists, which is why it can be sent to anyone without hedging. A colleague who adopts partly because a test bank is coming, and then teaches two terms without one, remembers that — and it is the kind of thing that costs a second adoption rather than a first. Add it to the guide when it ships, not before.

---

# Appendix B — Standalone first

## The inversion

The earlier plan said: build so as not to preclude LTI. That was the wrong way round.

LTI approval requires an institution's IT and security review. At your own university that is months. At every adopter's, it is their own process on their own timeline, and **most of them will never do it.** A tool that needs institutional approval before a colleague can try it does not get tried.

**So standalone is the default, not the contingency.** Flexee runs on its own, holds its own rosters, keeps its own grades, and exports them. LTI is an upgrade that a few institutions eventually buy, attaching at a seam left for it.

**The test:** a colleague who has heard about this on a Tuesday should be able to run it with their class the following term without asking their IT department for anything.

## What standalone requires

### Rosters — faculty create their own
No LMS to sync from, so two routes, and both are needed.

**CSV upload.** A faculty member exports their class list from wherever it lives and uploads it. The importer must tolerate what real exports look like: extra columns, different header names, names in one field or two, trailing blank rows, an ID column that is sometimes numeric and sometimes not. It should show what it parsed and let the person correct it before committing.

**Self-enrolment by section code.** The faculty member creates a section, gets a code, and gives it to the class. Students enrol themselves. This is how the first week actually goes when a roster is not final.

Both produce the same thing: enrolments in a section. Everything else in the platform already hangs off that.

### Flexee is the gradebook
Not a feed into someone else's. It holds: milestone scores (engine and instructor components separately); exam and quiz scores when the assessment layer exists; a running total per student with the weighting the adopter set; and a view a faculty member will actually use to see where a class stands. **Weighting is per section, set by the adopter.** Nothing in the materials assumes a split, and the gradebook must not either.

### Grade export is the integration story
**A CSV in the format the institution's LMS imports.** That is how every tool works before it is approved, it is a day of work, and it turns LTI from a dependency into a convenience. Export the whole gradebook or one column; include the student identifier the LMS keys on (which is why the roster importer must capture it); offer the common shapes — D2L, Canvas, Blackboard, Moodle all differ slightly — and a plain generic CSV; say plainly which format is which. **If export works properly, nobody has to file a request.**

### The unglamorous half
Account recovery and password reset. Students who mistype their email at sign-up. A student who enrolled in the wrong section. A faculty member who uploaded the roster twice. Someone who needs their account merged. **Nobody plans for these and every deployment needs them.** They are the reason standalone costs more than it looks.

## What this changes about privacy

Under LTI, the institution's LMS holds the grades and Flexee passes it a number. **Standalone, Flexee holds student grades directly.** That is a different posture, and an adopter's counsel or registrar may ask about it before a department will use it. Worth having answers ready for: what is stored and for how long; who at Flexee can see it; what happens at the end of a term and at the end of an adoption; whether a student can obtain or delete their own record; where the data physically sits. The question arrives from the institution, not the faculty member, and usually late.

## Where LTI attaches

| Seam | What it means |
|---|---|
| **Pluggable identity** | A user has one or more identities. Today: email and password. Later: an LTI subject. Same user, two ways in. |
| **External context id** | A nullable field on a section. Empty for a section a faculty member created; populated when the section came from an LMS. |
| **Line items** | Anything gradeable is already a line item with a score. Under LTI it maps to a gradebook column; standalone it is a CSV column. **Same structure either way.** |

**Nothing about LTI needs building now.** These three make it a later feature rather than a later rewrite.

## Sequencing

Unchanged for Spring: the reader, one book, one section. When the platform proper starts, the standalone essentials come first, because without them nothing can be used by anybody:

1. Accounts, sections, enrolments
2. Roster CSV upload, and self-enrolment by code
3. The gradebook
4. Grade export as CSV
5. Everything else — faculty console, publishing, assessment
6. LTI, when an institution asks and will pay for the approval process

---

# Open questions, consolidated

1. Can a chapter be republished mid-semester, and what happens to a student's bookmark?
2. Do teams persist across simulations within a section, or form fresh each time?
3. Can team membership change mid-term, given MVCFN teams hold a budget ledger and submissions?
4. Is the platform Flexee-branded, or does a colleague adopt a named book?
5. Does MVCFN eventually run inside the platform, or stay a separate deployment the platform links to?
6. What else belongs in the faculty version beyond the list in the main document?
7. What are the answers on data governance — retention, access, end of term, end of adoption — before a registrar asks?
