import { toolJwks, ensureKey } from "@/lib/lti";
export async function GET() {
  await ensureKey();
  return Response.json(await toolJwks());
}
