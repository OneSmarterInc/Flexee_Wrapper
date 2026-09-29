import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Keep links from earlier deployments working. Class records remain at
// /teach/[section] while the faculty entry point is /faculty.
export default async function LegacyTeachingHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  redirect(error ? `/faculty?error=${encodeURIComponent(error)}` : "/faculty");
}
