# Wrapper role portals

One account and one sign-in serve all roles. A system administrator can also be a faculty member or a student in individual classes. A person's display name does not determine access.

| Destination | Who opens it | What it does |
| --- | --- | --- |
| `/admin` | `users.system_role = admin` | Create classes, add faculty and students, and publish books to classes. |
| `/faculty` | Faculty in at least one class, or an administrator | List classes the person teaches; open `/teach/[section]` for records, assignments, exams, and gradebook. An administrator without a teaching assignment sees an empty faculty workspace. |
| `/student` | Any signed-in account | Join a class, open published class books, and see its exams. Faculty can also preview the books of classes they teach. Being an administrator does not publish a book or add the administrator to a class. |

After sign-in or sign-up, the account goes directly to its default workspace: administrators to `/admin`, faculty assigned to a class to `/faculty`, and everyone else to `/student`. A valid explicit `next` URL for a protected page is honored. The `/` entry point applies the same role choice for a returning session. Links in the workspace sidebar let a person with multiple roles switch explicitly. The old `/teach` home redirects to `/faculty`; existing `/teach/[section]` URLs remain the faculty class routes.

The administration dashboard lists every class with its book, faculty, student count, and publication status. The class setup page guides an administrator through assigning faculty, adding students, and publishing the book. Faculty see their assigned classes and open a class workspace with teaching, assessment, book, and roster tasks. Its question bank link shows chapter questions and correct answers only after checking instructor enrolment. The student dashboard lists joined classes, access status, course links, and the join-code form. Joining a class returns to this dashboard even when its book is not yet published.

Access is checked on each destination and operation: `/admin` checks the system role; faculty class pages and actions check instructor enrolment; book pages check class enrolment and publication. The navigation links are only a guide and do not grant access. An account is not faculty merely because its display name says "Faculty".
