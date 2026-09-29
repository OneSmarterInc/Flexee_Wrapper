# Wrapper role portals

One account and one sign-in serve all roles. A system administrator can also be a faculty member or a student in individual classes. A person's display name does not determine access.

| Destination | Who opens it | What it does |
| --- | --- | --- |
| `/admin` | `users.system_role = admin` | Create classes, add faculty and students, and publish books to classes. |
| `/faculty` | Faculty in at least one class, or an administrator | List classes the person teaches; open `/teach/[section]` for records, assignments, exams, and gradebook. An administrator without a teaching assignment sees an empty faculty workspace. |
| `/student` | Any signed-in account | Join a class, open published class books, and see its exams. Faculty can also preview the books of classes they teach. Being an administrator does not publish a book or add the administrator to a class. |

After sign-in, `/` sends an administrator to `/admin`, a faculty member to `/faculty`, and everyone else to `/student`. Links on each portal allow someone with multiple roles to switch explicitly. The old `/teach` home redirects to `/faculty`; existing `/teach/[section]` URLs remain the faculty record routes.

Access is checked on each destination and operation: `/admin` checks the system role; faculty class pages and actions check instructor enrolment; book pages check class enrolment and publication. The navigation links are only a guide and do not grant access. An account is not faculty merely because its display name says "Faculty".
