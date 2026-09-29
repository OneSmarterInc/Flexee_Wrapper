import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userClasses } from "@/lib/enrolment";
import { landingPortal } from "@/lib/portal";

export const dynamic = "force-dynamic";

// The root is an entry point, not a student page. A person can have several
// class roles, so explicit portal links remain available after this redirect.
export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; need?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.error) params.set("error", sp.error);
  if (sp.need) params.set("need", sp.need);
  if (params.size) redirect(`/student?${params.toString()}`);

  const classes = user.systemRole === "admin" ? [] : await userClasses(user.id);
  redirect(`/${landingPortal(user.systemRole, classes.some((c) => c.role === "instructor"))}`);
}
