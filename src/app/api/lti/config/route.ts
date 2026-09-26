import { toolConfig } from "@/lib/lti";
export async function GET(req: Request) {
  return Response.json(toolConfig(new URL(req.url).origin));
}
