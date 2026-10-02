import { currentUser } from "@/lib/auth";
import { courseContextForSection } from "@/lib/course-context";
import CourseHeader from "@/components/CourseHeader";

// Spec 14: the course header for every page under /teach/[section]/, including the 13 that do not
// use the workspace shell. A page added here later gets it with no change to that page.
export const dynamic = "force-dynamic";

export default async function TeachSectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const user = await currentUser();
  const ctx = user ? await courseContextForSection(user.id, section) : null;
  return (
    <>
      <CourseHeader ctx={ctx} />
      {children}
    </>
  );
}
