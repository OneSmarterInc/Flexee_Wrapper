import { recordCompletion } from "@/lib/sims";
import { answer, failure, preflight, readBody } from "@/lib/sim-endpoint";

// RapidSims contract C2: a sim posts { token } here. Same behaviour as the frozen platform's /api/complete.
export const OPTIONS = preflight;
export async function POST(req: Request) {
  try { const b = await readBody(req); return answer(await recordCompletion(b.token)); }
  catch (e) { return failure(e); }
}
