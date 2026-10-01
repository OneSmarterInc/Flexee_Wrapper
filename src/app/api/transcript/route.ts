import { recordTranscript } from "@/lib/sims";
import { answer, failure, preflight, readBody } from "@/lib/sim-endpoint";

// RapidSims contract C2: a sim posts { token } here with { envelope }. Same behaviour as the frozen platform's /api/transcript.
export const OPTIONS = preflight;
export async function POST(req: Request) {
  try { const b = await readBody(req); return answer(await recordTranscript(b.token, b.envelope)); }
  catch (e) { return failure(e); }
}
