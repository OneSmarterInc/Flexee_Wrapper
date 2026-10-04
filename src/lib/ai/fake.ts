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
  /** Compose the answer from the request. The default reads the passages and cites the best one. */
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
 * The fake answers from the **first** passage it was given and cites it.
 *
 * That makes the harness's "cites the right chapter" figure equal to retrieval at rank 1, which is
 * a floor and not the assistant's accuracy: a model reads all five. The ceiling — how often the
 * right chapter is among the five — is reported beside it, and the pass bar is set on that.
 *
 * A version that chose by word overlap with the question was tried and **did worse**: 79.5%
 * against 83.7% on SAD's 288 questions, because overlap across a whole passage favours the longest
 * one while BM25's ranking already accounts for length. Being no cleverer than the ranking is
 * therefore the honest default, and it keeps the fake free of anything resembling judgement.
 */
const BLOCK = new RegExp("\\[(\\d+)\\]\\s+(.+?)\\s+\\((/[^\\s)]+)\\)", "");

function defaultAnswer(req: AiRequest): string {
  const prompt = req.messages[req.messages.length - 1]?.content ?? "";
  const first = BLOCK.exec(prompt);
  if (!first) return "The book does not cover that.";
  return `Short answer, drawn from the passage. See [${first[2]}](${first[3]}).`;
}
