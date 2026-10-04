# Spec 20 — The AI provider seam and the course-grounded student assistant

**For:** Claude Code, working in `D:\Code\Wrapper\Flexee_Wrapper` · **From:** Vikram (via the Wrapper chat)
**Date:** 4 October 2026 · Save as `docs/specs/20_Course_Assistant.md` (first commit).
Slice 1 of the vision track (backlog V1, V2 and the decisions recorded as V9; `Flexee_Spring_2027_Readiness_Plan`, section 5).

## Why

Students in the two Spring classes (SAD and MIS 4950) read a book, take exams and do assignments. They need an
answer at eleven at night, and faculty need a way to see what students can't find. An assistant that answers only
from the class's own published book, links to the exact section, and passes to the instructor what it can't
answer is the Wrapper's flagship differentiator. This slice builds it, behind a switch that is off by default.

## Decisions already made (do not reopen)

| Decision | What was decided |
|---|---|
| Provider | Hosted, behind a provider-agnostic seam, so it can be switched later. Chosen after Vikram reads at least two providers' current business terms: no training on what is sent, and short retention. **Do not hard-wire a provider.** |
| What is sent | Only the student's question, that thread's earlier turns, and the passages from the class's own published book that answer it. **No name, email, D2L username, id or grade.** |
| What is kept | The conversation is stored against the student, visible to **that student and the class's faculty only**, and deleted at the end of term. |
| The switch | **Off by default for each class.** A faculty member turns it on. Students see a plain notice: "AI assistant. It answers from your course book, and it can be wrong. Your instructor can see these questions." |
| Academic integrity | **Off while a student has an exam or quiz attempt in progress.** A faculty member can also turn it off for chosen assignments. |
| Cost | A monthly cap, and a per-class limit. |
| Before students see it | Tested against the question banks. |

## Before writing any code

1. Read how book content reaches the reader (`ContentStore`, `src/lib/content.ts`, `src/lib/render.ts`), how a class's
   **pinned** content versions are resolved, the reader page frame (where a panel can sit), how exam and quiz attempts
   are stored (to detect one in progress), where a class's settings live, the mail adapter, and whether
   `vercel.json` already holds any cron entry.
2. **Measure, before choosing a retrieval method.** From the SAD and MIS 4950 packages (read-only, through Drive
   for Desktop under `G:\My Drive\Flexee`), report each book's size in words and approximate tokens. Then, with no
   provider calls, test simple lexical retrieval over section-sized chunks: for 50 question stems per book, does
   the passage from the question's own chapter appear in the top 5? Report the numbers. **Recommend the simplest
   method that clears the quality bar** (lexical, embeddings in Neon, or whole-chapter context), with its cost per
   question. I decide at go.
3. Report the API controls two providers offer for retention and training. Don't judge terms; I will.
4. Propose a plan, the schema, and any open questions. **Wait for my go before building.**

## What to build

### 1. The provider seam

- One interface in `src/lib/ai/` with a single call: messages in, text and token counts out. The assistant imports
  **only the interface**. A fake provider drives every test.
- Two adapters, chosen by `AI_PROVIDER`: **Anthropic's Messages API**, and an **OpenAI-compatible chat endpoint**
  (which also covers a self-hosted server, such as LocalMind's local model, later). No provider-specific code
  outside its adapter.
- `AI_ENABLED` is a global switch, **false by default**. With it false, or no key set, the panel never appears and
  the endpoint refuses.
- Never log a question, an answer, or an identifier. Log only status codes and token counts.

### 2. The assistant's behaviour

- It answers **only from the class's published book at the class's pinned versions.** A book not published to the
  class is never used. The question bank, with its stems, options and rationales, **is never indexed or put in any
  prompt.**
- Every answer **cites** the section, figure or table it drew on, as a link to that exact place in the book (the
  section, figure and table addresses exist). Only links to addresses in this class's book are kept; anything else
  a model returns is stripped. Render the model's output as restricted text, never as HTML.
- When no passage is relevant enough, it says so plainly and offers **Ask your instructor**, **without calling the
  provider.**
- It has no tools and takes no actions. It cannot see grades, other students, or the class roster.
- It keeps the thread's recent turns (propose how many) and no memory across threads.
- Off during an exam or quiz attempt in progress (see "Controls"). A clear message says why.

### 3. What is stored, and for how long

- Threads and messages are stored against the student and the class, with their citations. Visible to **that
  student and the class's faculty only.** An admin who doesn't teach the class sees counts, never content.
- A scheduled job (Vercel Cron, protected by `CRON_SECRET`) **deletes threads whose last message is older than
  `ASSISTANT_RETENTION_DAYS`** (default 120). Usage records stay; they hold no content.

### 4. Controls and cost

- A class's switch lives on the faculty class page. Only the class's faculty and admins can change it.
- Per-student daily limit and per-class monthly cap, both settings with sensible defaults. At a limit, the assistant
  says so and offers **Ask your instructor**.
- A **usage** record per request: class, day, provider, model, tokens in and out, and an estimated cost. No content.
  Faculty and admins see usage per class and a month-to-date total against the cap.
- A faculty member can turn it off for a chosen assignment.

### 5. Ask your instructor

- A student can send a question to the class's faculty, with the thread attached. Faculty see an inbox of open
  items, reply in the Wrapper, and the student sees the reply in the thread. An email goes through the mail
  adapter to say there is a reply (it fails softly if mail isn't configured).
- Keep it small. This is not a messaging system.

### 6. Where it appears

- A panel in the reader, on course pages, labelled and keyboard-operable, with the notice above. New answers are
  announced to screen readers. Citations are links that jump to the place in the book.
- A faculty section: the switch, the usage meter, the inbox, and the class's threads.
- It does not appear for a class where it is off, or while the student has an open attempt.

### 7. The evaluation harness

- `npm run eval:assistant`: for each question in a bank, ask its **stem** as a student question and check that the
  answer cites a section from that question's own chapter. It never feeds the bank's options or rationales to the
  assistant. Report the share that cite the right chapter, the share that say "not in the book", and the cost.
- Offline against the fake provider in CI. With a real provider it prints an **estimated cost first** and needs
  `--yes`.
- Propose a pass bar with your plan. It must also show the assistant **refuses to give an exam answer** while an
  attempt is in progress.

## Rules (tests must prove each)

1. The assistant imports only the provider interface. Every test uses the fake provider. With `AI_ENABLED` false or
   no key, the panel is absent and the endpoint refuses.
2. A new class has it off. Only the class's faculty and admins can switch it. For a class where it is off,
   students see nothing and the endpoint refuses.
3. Retrieval uses only the class's published, pinned book. A book not published to the class is never used. No
   prompt contains any text from the question bank (scan the captured prompts for known stems and rationales).
4. The captured request to the provider contains no name, email, D2L username, id or grade, tested with a student
   whose identifiers are unique strings.
5. With an exam or quiz attempt in progress, the endpoint refuses with a clear message. It works again after the
   attempt is submitted. Other students are unaffected.
6. Answers carry citations that link to addresses in this class's book. A link to anywhere else is stripped, and
   model output is never rendered as HTML.
7. When nothing relevant is found, the assistant says so and offers Ask your instructor, with no provider call.
8. Per-student and per-class limits are enforced, with a clear message at the limit. Each request writes a usage
   record with tokens and cost and no content.
9. A thread is readable by its student and the class's faculty only. Another student, another class's faculty, and
   an admin who doesn't teach the class cannot read it.
10. The retention job deletes threads older than the setting, needs `CRON_SECRET`, and keeps usage records.
11. Ask your instructor creates an inbox item with the thread; the faculty reply reaches the student; an email
    failure doesn't lose it.
12. A captured log of the whole flow contains no question text, answer text or student identifier.
13. The evaluation harness runs offline, reports its measures, and prints a cost estimate and requires `--yes`
    before using a real provider.
14. The panel is keyboard-operable, announces new answers to screen readers, and passes the automated accessibility
    check used in Spec 14.

## Process

As before: a migration with the next number; `docs/changes/20_Course_Assistant.md`, including the settings
(`AI_ENABLED`, `AI_PROVIDER`, the key, `AI_MODEL`, `ASSISTANT_RETENTION_DAYS`, the limits and the cron entry) and
the notice wording; every suite passes; commits authored as me; **show me the summary and ask before pushing**;
`git pull --rebase` first. Put no real student data or API key in the repository.

## After it ships (not part of this build)

Vikram reads the providers' terms, chooses one, sets the key and the caps in Vercel, runs the evaluation on the
real provider, and pilots it with TAs in November. Whether it is switched on for students is decided in December.
Slice 2 (the faculty assistant) builds on this seam.

## Decisions (4 October 2026)

Settled after the "before writing any code" reports: the two books measured from the Drive
packages, lexical retrieval tested offline over 100 bank stems with no provider calls, and the two
providers' retention and training controls listed for Vikram to judge.

### What the measurement found

| | SAD (MIS 3250) | MIS 4950 |
|---|---|---|
| Chapters · words · characters | 12 · 27,112 · 170,605 | 12 · 29,523 · 174,609 |
| Tokens (chars ÷ 4 · words × 1.33) | ~42,700 · ~36,100 | ~43,700 · ~39,300 |
| Words per chapter | 1,501–2,543 (median 2,343) | 2,257–2,811 (median 2,442) |
| Section chunks | 129 (median 182 words, max 649) | 121 (median 237 words, max 809) |
| Bank questions | 288 | 323 |

Both books together: 56,635 words, ~86,000 tokens, 250 section chunks. Small corpora, which is why
the simplest method wins.

**BM25 over section chunks, 50 stems per book spread across all twelve chapters, fixed seed:**

| | SAD | MIS 4950 |
|---|---|---|
| Right chapter in top 5 | 48/50 (96%) | 50/50 (100%) |
| Right chapter at rank 1 | 45/50 (90%) | 44/50 (88%) |
| Right section in top 5 | 45/50 (90%) | 47/50 (94%) |
| With Review Questions sections excluded | **50/50 (100%)** | 49/50 (98%) |

99 of 100 at top 5. Excluding each chapter's own Review Questions sections *improves* the result
rather than flattering it: both SAD misses were scenario-style stems, and for one of them all five
top chunks were Review Questions sections of other chapters, which are dense with question-like
language and act as magnets.

Payloads: top-5 chunks ≈ 1,200–1,600 tokens typical, ≤4,300 worst case; a whole chapter ≈
3,100–3,750; a whole book ≈ 36–39k.

**A correction, found by checking an intermediate result.** A first calibration appeared to show a
clean relevance floor — in-book stems at p5 ≈ 8.4, off-topic questions peaking at 7.7 — and it was
wrong. It was measuring question length: the off-topic probes were short, the bank's stems are long
scenarios. Re-run with *long* off-topic questions, the separation collapses:

| | SAD | MIS 4950 |
|---|---|---|
| In-book p5 | 8.26 | 8.34 |
| Off-topic **max** | 14.89 | 13.52 |
| Best floor keeping ≥95% of in-book | 8.0 → refuses 5/10 | 8.5 → refuses 5/10 |

Normalising by query length is worse (off-topic 2.79 against an in-book median of 1.68), and two
term-coverage signals separate no better. **No lexical score distinguishes a long off-topic question
from a genuine one.** Lexical retrieval is the right way to *rank* passages and nowhere near a
relevance judge.

### The method

**BM25 over section chunks, built in memory from the pinned markdown and cached per version.** No
embeddings, no pgvector, no chunk table. The index that ships is the index that was measured, and
the evaluation harness builds the identical one. Whole-chapter context is the fallback if a future
book drops below ~90% at top 5; embeddings are worth revisiting only if the refusal behaviour below
proves unsatisfactory, and could not be tested offline.

Cost per question: ~250 tokens of system prompt + 1,200–1,600 of passages + ~400 of thread history
+ ~60 of question ≈ 2,000–2,400 in, 300–500 out. At illustrative rates of $1/$5 per million tokens
that is ~$0.004 a question, ~$2.60 for a full 611-question evaluation, ~$5 a month at 1,200
questions. Rates to be confirmed against the provider's current pricing.

### 1. Rule 7 is amended

The spec's rule 7 reads "When no passage is relevant enough, it says so plainly and offers Ask your
instructor, **without calling the provider**". The measurement says that cannot be done from lexical
scores without also turning away about one genuine question in twenty. **Rule 7 now has three
layers:**

1. **A tiny no-call floor.** No query term matches any chunk, or the top score is below ~4. This
   fired for **0 of 200** in-book stems and catches only the genuinely empty case — no provider
   call, exactly as the rule intended.
2. **The model refuses.** The prompt carries only the retrieved passages and instructs it to answer
   solely from them, and otherwise to say the book does not cover it. This costs one call.
3. **A structural check afterwards.** An answer citing nothing in the supplied passages is replaced
   by "not in the book" and Ask your instructor, and any link outside this class's book is stripped.

Recorded because the amendment weakens a rule as written: an off-topic question usually costs one
provider call. The alternative — a hard floor — would refuse genuine questions, and a student who is
told their own course's question is "not in the book" has been failed in a way that a small bill is
not.

### 2. Review Questions sections are not indexed

Excluded from the index, and the panel says the assistant does not discuss the chapters' review
questions, so a student who asks is told why rather than left guessing.

### 3. Chapters only

Only `kind: "chapter"` spine entries are indexed. Front matter is not course content.

### 4. The cap is in tokens

`monthly_cap_cents` is replaced by a **monthly token cap per class**, enforced on tokens. A price
table in settings turns tokens into an **estimated** dollar figure for the usage meter, so a
provider's price change cannot silently move the limit. The **per-student daily limit stays a count
of requests**.

### 5. Vercel Pro, a daily retention cron

### 6. The notice, exactly

> AI assistant. It answers from your course book, and it can be wrong. Your instructor can see these
> questions. Only your question and the matching passages from the book are sent to the AI service,
> never your name, email or grades. Please don't type personal details.

### 7. MIS 4950 is admitted alongside

The evaluation harness therefore accepts a **local packages path**, so it can run against MIS 4950
before the book is in the library.

### Approved as proposed

The schema (`assistant_settings`, `assistant_threads`, `assistant_messages`, `assistant_usage`,
`assistant_questions`, and `assignments.assistant_off`), keyed on `enrolment_id` so a thread dies
with the enrolment as every other piece of student work does; **six messages of thread history**
(three exchanges), capped at 1,500 tokens, and no memory across threads; and the pass bar for
`npm run eval:assistant` — ≥95% of answers citing a section from the question's own chapter, ≥98%
carrying at least one valid citation, **zero** prompts containing any bank option or rationale text,
and 100% refusal while an attempt is in progress.
