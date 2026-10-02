import Link from "next/link";
import type { CourseContext } from "@/lib/course-context";

/**
 * Spec 14: one compact line saying where you are — the book, the class and term, and your role.
 *
 * Rendered by the course layouts, so every page inside a course gets it without being changed, and
 * a page added later gets it too. Pages keep their own headings; this only says where you are.
 *
 * The full title is in `title` on the line and in the tooltip, so a phone can truncate the visible
 * text (CSS) while the whole title stays reachable on tap and on hover.
 */
export default function CourseHeader({ ctx }: { ctx: CourseContext | null }) {
  if (!ctx) return null;
  const full = ctx.subtitle ? `${ctx.title} · ${ctx.subtitle}` : ctx.title;
  const where = ctx.term ? `${ctx.className} · ${ctx.term}` : ctx.className;
  // a <header> rather than a <div>: it is a banner landmark, so its content is inside a landmark
  // and a screen reader can jump to it or skip it
  return (
    <header className="course-header ui" aria-label="Course" data-testid="course-header">
      <Link className="course-header-book" href={ctx.homeHref} title={full} aria-label={`Course home: ${full}`}>
        <span className="course-header-title">{ctx.title}</span>
        {ctx.subtitle && <span className="course-header-sub">{ctx.subtitle}</span>}
      </Link>
      <span className="course-header-sep" aria-hidden="true">·</span>
      <span className="course-header-class" title={where}>{where}</span>
      <span className="course-header-sep" aria-hidden="true">·</span>
      <span className="course-header-role">{ctx.role}</span>
    </header>
  );
}
