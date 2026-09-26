import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loginInit } from "@/lib/lti";
async function handle(params: Record<string, string>, origin: string) {
  const { redirect: to, state } = await loginInit(params, origin);
  // cross-site launch requires SameSite=None; secure (https) in production
  (await cookies()).set("lti_state", state, { httpOnly: true, sameSite: "none", secure: true, path: "/", maxAge: 600 });
  redirect(to);
}
export async function GET(req: Request) {
  const u = new URL(req.url);
  await handle(Object.fromEntries(u.searchParams), u.origin);
}
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  await handle(params, new URL(req.url).origin);
}
