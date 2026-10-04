/**
 * The provider seam (Spec 20 §1).
 *
 * One interface, one call. The assistant imports **only this file** and `provider()` from
 * ./index — never an adapter, and never a provider's SDK. That is what makes the provider a
 * decision Vikram can change after reading two sets of business terms, rather than a decision
 * baked into the thing that uses it.
 *
 * No `server-only` here: these are types and one pure helper, and the evaluation harness runs
 * outside Next.
 */

export type AiRole = "user" | "assistant";

/** One turn. The system prompt is passed separately, because providers disagree about where it goes. */
export type AiMessage = { role: AiRole; content: string };

export type AiRequest = {
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /** 0 for the assistant: it is reading a passage back, not writing prose. */
  temperature?: number;
};

export type AiResult =
  | { ok: true; text: string; tokensIn: number; tokensOut: number; model: string }
  | { ok: false; error: string; status?: number; tokensIn: 0; tokensOut: 0; model: string };

export type AiProvider = {
  /** For the usage record, and for the faculty meter. */
  readonly name: string;
  readonly model: string;
  complete(req: AiRequest): Promise<AiResult>;
};

/**
 * Never throws, by contract — like the mail adapter. A provider that is down must not lose a
 * student's question or a usage record, so a failure is data.
 */
export const aiFailure = (model: string, error: string, status?: number): AiResult =>
  ({ ok: false, error, status, tokensIn: 0, tokensOut: 0, model });

/**
 * A rough token count, for the cap and for sizing a prompt before it is sent. Four characters per
 * token is the usual English estimate; the figure that goes into a usage record is the provider's
 * own count, never this one.
 */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
