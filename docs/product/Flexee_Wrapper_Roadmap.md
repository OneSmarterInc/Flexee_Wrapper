# Flexee Wrapper — prioritized roadmap (AI-first LMS)

**16 September 2026.** The Wrapper is the LMS being built; there is no other. This ranks the
full wish list against three questions: is it needed to teach MIS 3000 and SAD standalone in
Spring 2027, is it an AI-first differentiator worth building for its own sake, and how much
does it cost given what already exists.

## The governing principle — the Wrapper integrates, it does not absorb

Read every tier below through this. The Wrapper is an integrator, not a feature factory. Its
job is to hold a course together — who the student is, what section they are in, what is
published, what is due, where grades live, and the place a student lands — and to expose clean
sockets that components plug into. The components (LocalMind, the OneSmarter agent engine, the
Cyberbrief newsroom pattern, the Excel worksheet tool) live and grow on their own. Because the
Wrapper talks to them through a stable public interface rather than swallowing their code,
every improvement they make arrives in the Wrapper for free: upgrade LocalMind's model and
every course's AI gets smarter without the Wrapper changing a line.

Two consequences follow, and they reshape the list. First, the Wrapper's own code should be
only the thin, durable connective tissue no component owns, plus the sockets themselves; the
thick, fast-moving, model-heavy capability stays in the components. Most of Tier 2 and Tier 3
below are therefore not Wrapper builds at all — they are component builds the Wrapper surfaces,
and what the Wrapper actually builds is the small, stable socket. Second, the discipline that
protects the whole design is the LocalMind rule applied everywhere: the Wrapper only ever
talks to a component through the same public interface an outside adopter would use. The moment
it reaches into a component's internals for speed, it has absorbed that component and its
maintenance and release cycle, which is the failure mode this philosophy exists to prevent.

The single highest-value Wrapper investment beyond Spring is therefore not any one AI feature.
It is the socket layer — the AI provider seam and a component-registration pattern that lets a
new tool be added the way a book is, as data rather than a rewrite — because that is what turns
"integrator" from a description into a mechanism.

## Already built and verified (the baseline)

The reader, the content pipeline, accounts and enrolment, the instructor console, content
publishing with per-section version pinning, assessment with exams and objective-level mastery,
the gradebook with CSV export, account recovery, standalone Docker deployment, the dormant LTI
attachment, and the complete 338-question MIS 3000 bank. This is enough to run a standalone
term today except for the Tier 0 pieces. All of it is Wrapper-native connective tissue, which
is why it belongs in the Wrapper rather than in a component.

## Tier 0 — Spring-critical, Wrapper-native, buildable now

These are integrator work and content, not component features, which is why they are the
Wrapper's to build. The course scaffolding trio — announcements, syllabus, and a "what's due
when" schedule, all section-scoped — plus the faculty course dashboard showing sections as
cards by term. The SAD question bank, authored like MIS 3000. The imprint correction (Flexee
Publishing, author Vikram Sethi, editor Chuck Nemer, first edition 2027) across the title page,
copyright page, licence text, and reader chrome.

## Tier 1 — cheap wins that protect the work in progress

The intake figure-downsampling and the consistency scanner, worth having before the SAD book
and deck are final rather than after. These are pipeline tools, still Wrapper-side.

## Tier 2 — the AI-first core (mostly components behind sockets; seam first)

The AI provider seam is the one true Wrapper build here and comes first — a provider-agnostic
socket pointed by default at LocalMind's local Qwen, with the agent engine's grounding behind
it. Then the features, each of which is a component surfaced through the socket rather than new
Wrapper code: the course-grounded student assistant that answers from the course and escalates
what it cannot (the agent engine plus the already-built mastery data), the faculty AI assistant
(draft an announcement, assemble a quiz, read objective gaps), and the per-course newsroom (the
Cyberbrief pattern).

## Tier 3 — ambitious differentiators, component-led, research-heavy

The multi-agent conversation engine harvested from the OneSmarter café, which underwrites
in-platform simulations and a multi-voice classroom; the virtual AI classroom, a persona-bound
deck-driven lecturer carrying the consent and identity questions that are MeshKor's; worksheet
and applied assessment from the Excel platform, a non-multiple-choice type an MIS course wants;
and AI auto-ingestion, a raw document becoming a course draft a human then curates. Each is a
component maturing on its own that the Wrapper surfaces when it is ready.

## Tier 4 — later, blocked, or strategic

The publisher-over-LTI platform with Flexee as the first tool; the chapter-anchored support
channel and the email adapter; usage metering and billing when this becomes a paid product;
simulation milestones feeding the gradebook and team formation, both waiting on a simulation
coming in-platform; the accreditation and outcome-hierarchy work, held until its AACSB and HLC
research brief; and data governance and an accessibility audit, owed before institutional or
public exposure.

## Decisions to make, which are not builds

Ratify the integrator-plus-sockets principle above as the standing rule. The LocalMind boundary
is decided: independent product, Wrapper as a customer of its interface. The MVCFN in-or-out
question is reopened by the multi-agent engine, since a native multi-agent capability could
bring simulations in-platform rather than only linking the external sim — decide before the
second simulation. And the publisher-platform experiment's scope, when you choose to run it.

## Recommended critical path for Spring

Build the course scaffolding trio and the dashboard, finish the SAD bank, fix the imprint, and
run the figure-and-consistency tools over the SAD artifacts. That is the whole standalone-Spring
requirement, and it is all Wrapper-native. Then, if there is time and you want the differentiator
in front of students, build the provider seam and surface the course-grounded assistant on top
of it. Everything else waits for its component to bring it.
