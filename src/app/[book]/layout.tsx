import { currentUser } from "@/lib/auth";
import { courseContextForBook } from "@/lib/course-context";
import CourseHeader from "@/components/CourseHeader";

// Spec 14: the course header for every page under /[book]/. A page added here later gets it with
// no change to that page. The header renders nothing when there is no course to name (not signed
// in, not enrolled), so the pages' own redirects still decide what happens.
export const dynamic = "force-dynamic";

export default async function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const user = await currentUser();
  const ctx = user ? await courseContextForBook(user.id, book) : null;
  return (
    <>
      <CourseHeader ctx={ctx} />
      {children}
    </>
  );
}
