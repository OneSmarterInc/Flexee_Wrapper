# 20 — The AI provider seam, and the course-grounded student assistant

Slice 1 of the vision track (backlog V1, V2 and the decisions recorded as V9).

The spec and the decisions behind it are in [`docs/specs/20_Course_Assistant.md`](../specs/20_Course_Assistant.md).
**The settings to put in place are at the end of this file.**

## Deploying this changes nothing visible

**The assistant is off globally by default.** `AI_ENABLED` is false unless it is exactly `"true"`,
and `aiAvailable()` also wants a provider key, so until both are set:

- the panel never renders, on any page, for any student;
- `/api/assistant/ask` answers **404**, before it reads the request;
- the faculty page says so, and still lets a class's switch be set for later.

Then **each class is off as well** until one of its faculty turns it on. Three things have to agree
before a question can leave the building: the global switch, a key, and the class.

## Measured before it was built

From the two books' packages, read-only, with no provider calls:

| | SAD (MIS 3250) | MIS 4950 |
|---|---|---|
| Words · tokens (chars ÷ 4) | 27,112 · ~42,700 | 29,523 · ~43,700 |
| Indexed section chunks | 117 | 109 |
| Right chapter in the top 5 passages | **96.9%** of 288 bank stems | **97.8%** of 323 |

So the method is **BM25 over section chunks**, built in memory from the class's pinned versions and
cached by content hash. No embeddings, no vector store, no chunk table: the whole of either book is
about 350 KB, and the index that ships is the index that was measured.

**A score threshold cannot decide relevance, and the spec's rule 7 was amended because of it.** A
first calibration looked clean — genuine questions at a fifth percentile of 8.3, off-topic ones
peaking at 7.7 — and it was measuring question length. Re-run with long off-topic questions (a Roth
IRA question, a campus-wifi problem, a 2008-crisis essay prompt) the off-topic maximum is 14.9, well
above genuine questions. Normalising by query length is worse; two term-coverage signals separate no
better.

So the refusal is **three layers**:

1. **A tiny no-call floor** — nothing in the question matches anything in the book. It fired for
   none of the 200 in-book stems measured, so it catches only the hopeless case, with no provider
   call, which is what rule 7 was reaching for.
2. **The model refuses**, from a prompt holding nothing but the retrieved passages. This costs one
   call, and that is the amendment.
3. **A structural check afterwards** — an answer citing nothing in the supplied passages becomes
   "not in the book" and offers **Ask your instructor**.

An off-topic question therefore usually costs one call (about $0.004–$0.013). The alternative, a
hard floor, turns away about one genuine question in twenty, and telling a student their own
course's question is not in their book is a worse failure than a small bill.

## What changed

### The seam

`src/lib/ai` holds one interface — messages in, text and token counts out — and two adapters chosen
by `AI_PROVIDER`: **Anthropic's Messages API**, and any **OpenAI-compatible chat endpoint** (which
also covers a self-hosted model later, through `AI_BASE_URL`). The assistant imports only the
interface. Neither adapter throws: an HTTP error and a dead socket both come back as data, because a
provider being down must not lose a student's question.

Nothing logs a prompt, an answer, a key or an identifier. A failure logs a status code, and a test
captures the log while the stubbed provider returns an error body quoting the prompt back, to prove
the body is dropped.

### What the assistant does

- It answers **only from the class's published book at the class's pinned versions**, through the
  same `resolveEntryForSection` the reader uses, so a student and the assistant read the same words.
- **Chapters only.** Front matter is not course content.
- **Each chapter's review questions are not indexed**, and the panel says the assistant does not
  discuss them. Excluding them *raised* retrieval (SAD went 96.9% from 83.7% at rank 1 and 48/50 to
  50/50 on the 50-stem sample), because those sections are dense with question-like language.
- The **question bank is never indexed and never in a prompt.** The harness proves it by scanning
  every captured prompt for the bank's own option and rationale text.
- Citations are **checked, not trusted**: the entry must be one the passages came from and the
  fragment one of that entry's section, figure or table ids. Another book, an invented anchor, a
  bare URL and a link into the Wrapper are all reduced to their own text. Model output carries no
  markup at all, and is never handed to `dangerouslySetInnerHTML`.
- **Six messages of history** (three exchanges), capped at 1,500 tokens, and no memory across
  threads.

### The controls

- The class's switch, the per-student daily limit (a count of requests) and the **monthly cap in
  tokens** live on **Course assistant** in the class workspace. Only the class's faculty and admins
  can change them. The cap is tokens so that a change in a provider's prices cannot move a limit; a
  price table turns tokens into an estimated dollar figure for the meter, and that estimate is the
  only number on the page that is not measured.
- **Off during an exam or quiz a student has open**, with a message that says why and that it comes
  back on submission. Another student is unaffected.
- **A faculty member can switch it off for one assignment**, from that assignment's page — for work
  students must do unaided, including **an exam held outside the Wrapper**. The class keeps the
  assistant everywhere else.
- At any limit the assistant says so and offers Ask your instructor.

### What is stored

Threads and messages against the enrolment, with their citations, readable by **that student and
the class's faculty only** — `threadFor` is the single place that decides, and an admin who does not
teach the class gets the usage meter and never content.

A **usage record per request** holds a class, a day, a provider, a model, two token counts and an
estimated cost. No content, tested by dumping the table and searching it.

**A daily cron** (`/api/cron/assistant-retention`, 04:00 UTC, guarded by `CRON_SECRET`) deletes
threads whose last message is older than `ASSISTANT_RETENTION_DAYS` (120). Messages and inbox items
go with them by cascade; **usage records stay**, so a class's monthly total does not shrink when a
conversation is forgotten. With no `CRON_SECRET` the route refuses rather than running unguarded.

### Ask your instructor

A student hands the conversation to the class's faculty; faculty reply in the Wrapper and the reply
appears in the thread where the student asked. An email says there **is** a reply and links to it —
never what it says. The reply lands first and the email is sent after, so a transport that fails
loses nothing.

### The notice

Shown wherever the panel is, in full:

> AI assistant. It answers from your course book, and it can be wrong. Your instructor can see these
> questions. Only your question and the matching passages from the book are sent to the AI service,
> never your name, email or grades. Please don't type personal details.

## Migration

**0020** — `assistant_settings`, `assistant_threads`, `assistant_messages`, `assistant_usage`,
`assistant_questions`, and `assignments.assistant_off`. Keyed on the enrolment, so a student's
threads die with their enrolment as their bookmarks and submissions do, and the Spec 18 clean-up
needs no special case. `assistant_usage.enrolment_id` is `ON DELETE SET NULL` for the reason above.

## Tests

- `npm run test:ai-seam` — **13 checks**. Both adapters against a stubbed fetch: no network, no key.
- `npm run test:assistant` — **20 checks**. Chunking, retrieval, the prompt, the citation checker,
  the three refusal layers, the gate's ordering, and the notice word for word. It ends by capturing
  a provider request for a student whose nine identifiers are unique strings and asserting that
  none appears; `SHOW_PROMPT=1` prints the request in full.
- `npm run test:assistant-class` — **18 checks** across rules 1, 2, 5, 8, 9, 10, 11 and 12,
  including a captured log of the whole flow searched for the question, the answer, the student's
  name, their address and both ids.
- `npm run test:reader-frame` — **28**, one new: the panel is keyboard-operable, announces answers
  politely, carries the notice, and adds no axe violation.
- `npm run eval:assistant` — offline, both books, every measure clear of the bar.

Two things the tests found, both fixed here:

- **The gate's "unpublished" message was unreachable.** `enrolmentForBook` returns nothing for a
  student whose class has not published its book, so they were told "not switched on for this class"
  when the truth was that the book is not open yet.
- **A reply's email belonged to the action, not the store** — so the reply lands in one transaction
  and the courtesy email sits outside it.

### What the tests do not judge

- **A real provider.** Everything runs against the fake. Whether a model reads five passages well is
  the `--real` run, whose bar is printed before it sends: ≥95% citing the right chapter, ≥98%
  carrying a citation, and 30 answers per book read by hand.
- **The browser.** jsdom computes no layout, so colour contrast, focus visibility and touch-target
  size are outside its reach, as is whether a citation's jump lands where it should.
- **The cron's schedule.** The route and the sweep are tested; that Vercel calls it at 04:00 is
  configuration.

## Settings to put in place

| Setting | What it does |
|---|---|
| `AI_ENABLED` | `true` turns the assistant on for the Wrapper. **Anything else, including unset, is off.** |
| `AI_PROVIDER` | `anthropic` (the default) or `openai`. |
| `ANTHROPIC_API_KEY` | The key, for the Anthropic adapter. |
| `OPENAI_API_KEY` | The key, for the OpenAI-compatible adapter. |
| `AI_BASE_URL` | An OpenAI-compatible endpoint other than OpenAI's — a self-hosted server, say. |
| `AI_MODEL` | The model. Defaults to `claude-sonnet-5-5` or `gpt-4.1-mini` by adapter. |
| `AI_PRICE_IN_PER_MTOK` · `AI_PRICE_OUT_PER_MTOK` | Dollars per million tokens, for the meter's estimate only. Default 3 and 15. |
| `ASSISTANT_RETENTION_DAYS` | How long a conversation is kept. Default 120. |
| `CRON_SECRET` | Vercel Cron's bearer token. Without it the retention route refuses. |

Per class, on **Course assistant**: the switch (off), questions per student per day (20), and tokens
per month (2,000,000 — about 830 questions at the measured ~2,400 a question).

`vercel.json` now carries the project's first cron entry: `/api/cron/assistant-retention` daily at
04:00 UTC. The project is on Vercel Pro, so a daily cron is within the plan.

## What happens next, and is not part of this build

Vikram reads the two providers' current retention and training terms, chooses one, sets the key and
the caps in Vercel, runs `npm run eval:assistant -- --real --yes` on both books against the bar
above, and pilots it with TAs in November. Whether students see it is decided in December. Slice 2,
the faculty assistant, builds on this seam.
