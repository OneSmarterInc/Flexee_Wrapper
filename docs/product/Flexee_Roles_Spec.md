# Flexee Wrapper — roles: what each can see and do

The roles below sit on one underlying model. Admin is platform-level; faculty — in owner,
co-instructor, and assistant levels — student, and guest are section-level. The rule under all
of it is least privilege: a role sees and does only what its job needs, everything is scoped to
what the person owns or is enrolled in, and the Wrapper enforces it per request rather than
trusting the screen. One person can hold more than one role — you are both an admin and a
faculty member — because admin is platform-wide while faculty and student attach to a section. Underneath the named roles, an enrolment is four things — a person, a section, a capability level, and an optional expiry — and the named roles are points on that surface, which is what lets the model express a co-teacher, a teaching assistant, or a visitor admitted for a bounded time who then falls away on their own.

A line that sits above all three: no role authors or edits course content inside the Wrapper.
Writing the book, the objectives, and the question bank happens in the book-build chat to the
standard. The Wrapper hosts what is authored; a correction is made there and re-pulled.

## Admin — the platform operator

Admin is the operator role, the human end of the intake contract. Today that is you; later a
colleague or a publisher's operator.

What admin sees: the catalog of published bundles and their versions; every section and course
on the platform; verification reports for bundles being brought in; which components are
connected through the sockets (the AI provider, a simulation, the Excel system, a newsroom);
the platform's users and their roles; and system health. Admin sees across the platform, not
into the daily grading of a class.

What admin does: import a bundle and run it through the verification gate, then accept it into
the catalog with a version or reject it with the reasons; publish content upgrades and mark
errata at the catalog level; register and configure the components that plug in; create
sections and assign faculty; manage users and roles; and run the operational syncs that today
live at the command line. Admin verifies and admits content; admin never edits it.

What admin does not do: author or change course content; and, by default, admin does not browse
a class's student grades or personal results as a matter of course. Any support or oversight
read of that data is a deliberate, logged capability rather than open access, because it is
student education-record data and least privilege applies to the operator too.

## Faculty — the instructor of their own sections

Faculty is the teaching role, scoped strictly to the sections they own.

What faculty sees: their own sections, shown as cards by term on a dashboard; the catalog of
published courses available to adopt; within a section, the roster, the reader with whatever
chapter versions the section is pinned to and any upgrades waiting to be reviewed, the exams and
their item analysis, mastery by class and by student with the section's syllabus-outcome
mapping, and the gradebook. Faculty sees their own sections only, never another instructor's.

What faculty does: adopt a published course into a section; manage the roster with a join code,
a CSV import, removals, and in-person password resets; build, open, and close exams drawn from
the question bank; review a content upgrade's diff and publish it to their section; set gradebook
weights, add manual columns, enter or override scores, and export grades; define the section's
own syllabus outcomes and map them onto the book's objectives; and use the faculty AI assistant
to draft an announcement, assemble a quiz, or read where the class is weak. Faculty assembles
and assesses; faculty does not write the book or the bank, and does not import or verify bundles
into the platform — that is admin's job. Faculty adopts what has been published.

## Co-faculty — sharing a section

A section is not always one instructor. A co-teacher, a teaching assistant, or a coordinator
who drops in to help all teach the same section, so the teaching side is not one role but a
small ladder within a section, every level scoped to that section. The owning instructor is the
one who adopted the course and holds the section; there is exactly one, and only the owner can
restructure the course, hand off ownership, or remove other instructors. A co-instructor teaches
as a peer — roster, exams, content pinning, gradebook, mastery, the AI assistant — everything the
owner can do except those ownership-level acts. An assistant, a teaching assistant, sees the
roster and the student work and can grade and answer escalations, but cannot build or restructure
exams, change what content is pinned, or manage enrolment. Each is a level on the same teaching
enrolment, so adding a co-teacher or a TA is inviting a person into the section at a stated level,
not creating a new kind of account.

## Student — the learner in their own enrolments

Student is the learning role, scoped to the courses they are enrolled in.

What student sees: the courses they belong to; the reader at the version their section is pinned
to; the announcements, syllabus, and what-is-due schedule for the course; their own open exams;
their own results and the explanations, released on the schedule the instructor set; their own
mastery and progress; and their own grades. A student sees only their own work — never another
student's, never the answer key, never feedback before it is released.

What student does: enrol in a course with its join code; read, bookmark, and resume; take exams
within the allowed attempts; ask the course tutor, which answers from the course and escalates
what it should not answer to the faculty inbox; and manage their own email and password. A
student reaches no instructor or admin surface.

## Guest — a bounded, read-mostly visitor

A guest needs to see into a course briefly and then lose access on their own: a visiting
lecturer, an accreditation reviewer, a colleague evaluating the book for adoption, a dean
sitting in. Two properties make a guest a guest, and they are exactly what Pilot never gave you.
The access expires by itself on a date set when the invitation is made, so nobody has to remember
to revoke it. And it is read-mostly and scoped, so the invitation carries a visibility that says
what this visitor may see — an accreditation reviewer gets the syllabus, the objectives, the
mastery reporting, and sample assessments but not student names or grades; a prospective adopter
reads the book and sees how the course is structured but not the roster; a guest lecturer gets
the reader and the schedule. A guest never teaches, never grades, and never sees another person's
work beyond what the scope allows.

The expiry is the general idea, not a guest-only trick. It lives on the enrolment, so any role
can carry one — a co-instructor brought in to cover three weeks of medical leave is a teaching
enrolment with an expiry, another case Pilot handles poorly. Admission for a bounded time is a
property of the enrolment available to every role, rather than a special kind of user.

## Cross-cutting rules

Scoping is enforced server-side, which the Wrapper already does for attempts and results, so a
tampered request cannot reach another person's data. Time-bounded access is first-class: an enrolment can carry an expiry and the Wrapper drops the access when it lapses rather than relying on anyone to revoke it, which is what makes guests and any fixed-stay role safe. A program-level assessment-of-learning
roll-up across many sections — the accreditation view rather than one class's — is an admin or
program-coordinator view, not a faculty one, and is worth naming as its own capability when we
build it. And the whole model is what the security and FERPA review keys on, so writing it down
now is also the first page of that later conversation.

## Capability matrix

| Capability | Admin | Faculty | Student |
|---|---|---|---|
| Author / edit course content | no (book-build chat) | no | no |
| Import & verify a bundle into the platform | yes | no | no |
| Publish/version content, mark errata (catalog) | yes | no | no |
| Register & configure components (sockets) | yes | no | no |
| Browse catalog of published courses | yes | yes | no |
| Adopt a course into a section | via assignment | yes | no |
| Create sections / assign faculty | yes | own sections | no |
| Manage roster (join code, CSV, remove, reset pw) | any (operational) | own sections | no |
| Enrol by join code | — | — | yes |
| Read the book | preview any | own courses | own courses (pinned) |
| Review diff & pin a content version to a section | — | yes | no |
| Build / open / close exams | — | yes | no |
| Take exams | — | — | yes |
| Item analysis & per-question results | — | own sections | own results only |
| Gradebook: weights, manual columns, scores, export | — | own sections | view own grades |
| Section syllabus outcomes ↔ objective mapping | — | own sections | no |
| Program-level assurance-of-learning roll-up | yes | no | no |
| Faculty AI assistant | — | yes | no |
| Course AI tutor (opt-in) | — | — | yes |
| Change own email / password | yes | yes | yes |

### Teaching levels within a section

| Teaching capability | Owner | Co-instructor | Assistant (TA) |
|---|---|---|---|
| Read roster & student work | yes | yes | yes |
| Grade / enter scores | yes | yes | yes |
| Build / open / close exams | yes | yes | no |
| Pin content versions | yes | yes | no |
| Manage enrolment (add / remove) | yes | yes | no |
| Remove instructors / hand off ownership | yes | no | no |

A guest is not on this ladder. A guest holds an expiry and a visibility scope — for a reviewer,
the syllabus, objectives, mastery, and sample assessments; for an adopter, the reader and the
course structure — reads within it, and is removed automatically when the invitation lapses.

## Build note

Faculty and student are largely built already — the instructor console, enrolment, exams,
gradebook, mastery, tutor seam, and account recovery exist, with per-user scoping enforced. The
net-new piece is the admin role and its console: the verification gate, the import-and-version
flow, component registration, and the platform-wide views. That is the same core Wrapper work as
the socket layer, and it is where the command-line intake finds its home. Co-faculty and guests need no new machinery either: both are the same enrolment carrying a level and an optional expiry, plus an invitation flow. Neither is Spring-critical for two courses you own, so both are design-now and build-with-the-roles-work — cheap to include when the roles surface goes in, expensive to retrofit if the model hardens into instructor-or-student first.
