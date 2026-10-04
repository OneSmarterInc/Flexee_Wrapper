import { estimateTokens, type AiProvider, type AiRequest, type AiResult } from "./types";

/**
 * The provider every test uses (Spec 20 rule 1), and the one `eval:assistant` uses offline.
 *
 * It keeps every request it was given, which is how a test can assert what was *not* sent: no
 * name, no email, no D2L username, no id, no grade, and no text from the question bank. Nothing
 * else in the system can see a provider request, so this is the only place that evidence exists.
 */

export type Captured = AiRequest & { at: Date };

export type FakeOptions = {
  /** Compose the answer from the request. The default cites the first passage it was given. */
  answer?: (req: AiRequest) => string;
  /** Fail instead of answering, to prove a provider failure never loses anything. */
  fail?: string;
};

export function fakeProvider(opts: FakeOptions = {}) {
  const captured: Captured[] = [];
  const provider: AiProvider = {
    name: "fake",
    model: "fake-1",
    async complete(req: AiRequest): Promise<AiResult> {
      captured.push({ ...req, at: new Date() });
      if (opts.fail) {
        return { ok: false, error: opts.fail, tokensIn: 0, tokensOut: 0, model: "fake-1" };
      }
      const text = (opts.answer ?? defaultAnswer)(req);
      return {
        ok: true, text,
        tokensIn: estimateTokens(req.system + req.messages.map((m) => m.content).join("")),
        tokensOut: estimateTokens(text),
        model: "fake-1",
      };
    },
  };
  return {
    provider,
    captured,
    last: () => captured[captured.length - 1],
    reset: () => { captured.length = 0; },
  };
}

/**
 * What a well-behaved model does: answer from the passages and cite the first one. The passages
 * arrive in the prompt as `[1] <title> (/book/entry#anchor)`, so this reads the first citation
 * back out — which means a test that supplies no passages gets an answer with no citation, and the
 * structural check downstream has something real to catch.
 */
function defaultAnswer(req: AiRequest): string {
  const prompt = req.messages.map((m) => m.content).join("\n");
  const m = prompt.match(/\[(\d+)\]\s+(.+?)\s+\((\/[^\s)]+)\)/);
  if (!m) return "The book does not cover that.";
  return `Short answer, drawn from the passage. See [${m[2]}](${m[3]}).`;
}
