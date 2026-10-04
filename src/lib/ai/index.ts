import { anthropicProvider } from "./anthropic";
import { openAiProvider } from "./openai";
import type { AiProvider } from "./types";

export type { AiProvider, AiRequest, AiResult, AiMessage } from "./types";
export { estimateTokens, aiFailure } from "./types";

/**
 * Which provider, and whether there is one at all (Spec 20 §1).
 *
 * `AI_ENABLED` is the global switch and is **false unless it is exactly "true"**. With it false, or
 * with no key, `aiAvailable()` is false: the panel never renders and the endpoint refuses before it
 * reads anything. Two switches have to agree before a question can leave the building — this one,
 * and the class's own.
 */

let override: AiProvider | null = null;
/** Tests and the evaluation harness install the fake here. */
export function setAiProvider(p: AiProvider | null) { override = p; }

export function aiEnabled(env: Record<string, string | undefined> = process.env) {
  return env.AI_ENABLED === "true";
}

export function provider(env: Record<string, string | undefined> = process.env): AiProvider {
  if (override) return override;
  return (env.AI_PROVIDER || "anthropic").toLowerCase() === "openai"
    ? openAiProvider(env)
    : anthropicProvider(env);
}

/** A key is configured, or a self-hosted base URL, or a fake is installed. */
export function aiConfigured(env: Record<string, string | undefined> = process.env) {
  if (override) return true;
  const kind = (env.AI_PROVIDER || "anthropic").toLowerCase();
  if (kind === "openai") return !!(env.OPENAI_API_KEY || env.AI_API_KEY || env.AI_BASE_URL);
  return !!env.ANTHROPIC_API_KEY;
}

/** The one question every caller asks first. */
export function aiAvailable(env: Record<string, string | undefined> = process.env) {
  return aiEnabled(env) && aiConfigured(env);
}

/**
 * Tokens to money, for the usage meter only. A price table in settings, so a provider's price
 * change cannot move a limit: the **cap is enforced in tokens** (decision 4) and this is an
 * estimate shown to faculty. Rates are dollars per million tokens.
 */
export function priceTable(env: Record<string, string | undefined> = process.env) {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return { inPerM: n(env.AI_PRICE_IN_PER_MTOK, 3), outPerM: n(env.AI_PRICE_OUT_PER_MTOK, 15) };
}

/** Micro-dollars (millionths), so a single question is not rounded to zero. */
export function estimateCostMicros(tokensIn: number, tokensOut: number, env = process.env) {
  const { inPerM, outPerM } = priceTable(env);
  return Math.round((tokensIn * inPerM + tokensOut * outPerM));
}

export const formatMicros = (micros: number) =>
  micros >= 1_000_000 ? `$${(micros / 1_000_000).toFixed(2)}` : `$${(micros / 1_000_000).toFixed(4)}`;
