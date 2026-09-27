import { redirect } from "next/navigation";
import { verifyEmail } from "@/lib/recovery";
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  const ok = await verifyEmail(token);
  redirect(ok ? "/account?verified=1" : "/login?verify_error=1");
}
