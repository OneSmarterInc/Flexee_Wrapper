# Flexee Wrapper — Spring 2027 per-course component plan

The Wrapper holds each course together — one roster, one dashboard, one gradebook — and the
components deliver the parts. This maps the two Spring courses to components from your
decisions, separates the must-work core from the enhancements, and names what has to be ready
and who owns it.

## How the grades come together

The Wrapper's gradebook already does weighted columns, so a course grade can be composed from
several sources at any split. For Spring the reliable path is that each external component's
grade enters the Wrapper gradebook as a weighted manual column — the manual line item already
exists — and a socket that posts those scores automatically is a later build. That keeps Spring
free of integration risk while honoring the integrator design: the Wrapper composes the grade,
the components produce the parts.

## MIS 3000 — 50% Excel, 50% book

Half the grade is the Excel worksheet work, delivered by the Excel MIS component with its
worksheet-per-question assessment. Half is the book, delivered by the Wrapper reader and
assessed by the 338-question exam bank. The Wrapper is what makes it one course: a single
dashboard and roster, and a gradebook with the Excel column weighted 50 percent and the book
and exam columns weighted 50 percent. You wanted the course-grounded AI tutor as an opt-in
study aid and the per-course newsroom, and both fit MIS 3000 well since it is an AI-and-technology
course where a current feed helps. The honest cost until the socket exists is that students touch
two systems for this one course — the Wrapper for the book, the Excel platform for the Excel half
— and the later socket collapses that into one. What has to be ready by Spring is the Excel
component deployed and class-ready, and its grade carried into the Wrapper gradebook, which for
Spring is a manual weighted column rather than a build.

## SAD / MIS 3250 — book on Tuesday, MVCFN simulation on Thursday

The Tuesday book is delivered by the Wrapper reader, with the SAD bank still to be written. The
Thursday MVCFN simulation is the graded assessment, delivered by the external MVCFN application,
now confirmed as the Spring sim. The AI tutor applies here too, book-grounded and opt-in; the
newsroom is lower value here because the systems-analysis material is timeless rather than
current. What has to be ready is MVCFN deployed and run for the term, and its five indices plus
your instructor share carried into the Wrapper gradebook as manual weighted columns for Spring.
The one thing I still need from you is SAD's grade split between the book side and the simulation,
so the gradebook weights are set correctly.

## The must-work Spring core — no experiment in the graded path

The Wrapper-native pieces are the scaffolding trio and dashboard, the SAD bank, the imprint fix,
and the figure and consistency tools. The grade bridges are manual weighted columns for the Excel
component in MIS 3000 and for MVCFN in SAD, which are zero-build because the gradebook already
supports them. The external deploys are the Excel platform and MVCFN, stood up and reliable. That
set runs both courses end to end with nothing experimental load-bearing.

## The enhancement layer — land if ready, never graded-critical

The AI tutor and the MIS 3000 newsroom are both wanted for Spring, and both should be built so
that if they slip, the graded core is untouched. The tutor is the riskiest, since it needs the
provider seam plus a component mature enough to trust, so for Spring it is an opt-in study aid,
not a graded element. The newsroom reuses the Cyberbrief pattern as a current feed for MIS 3000.

## Open questions and owners

SAD's grade split between the book and the simulation, which sets the gradebook weights. Who
deploys and runs, by Spring, the Excel platform, MVCFN, and, if pursued, the tutor and the
newsroom. And a confirmation that the tutor is opt-in only for Spring, which is the
recommendation.

## Recommended order

Build the Wrapper-native core first — scaffolding, dashboard, SAD bank, imprint — then set up each
course's weighted gradebook with its component columns, confirm the external deploys of the Excel
platform and MVCFN, and build the enhancement layer of the seam-plus-tutor and the newsroom as
time before the term allows.
