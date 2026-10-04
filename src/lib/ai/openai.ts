import { aiFailure, type AiProvider, type AiRequest, type AiResult } from "./types";

/**
 * Any OpenAI-compatible chat-completions endpoint. One adapter covers OpenAI itself, the
 * compatible endpoints several hosts offer, and a self-hosted server later (LocalMind's local
 * model among them) — the shape is the same, only `AI_BASE_URL` changes.
 *
 * The system prompt goes in as the first message here, which is the one real difference from the
 * Anthropic adapter and the reason the interface keeps `system` separate.
 */
export function openAiProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const model = env.AI_MODEL || "gpt-4.1-mini";
  return {
    name: "openai",
    model,
    async complete(req: AiRequest): Promise<AiResult> {
      const key = env.OPENAI_API_KEY || env.AI_API_KEY;
      const base = env.AI_BASE_URL || "https://api.openai.com/v1";
      // A self-hosted server often needs no key; a hosted one always does.
      if (!key && !env.AI_BASE_URL) return aiFailure(model, "not configured");
      try {
        const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            model,
            max_tokens: req.maxTokens,
            temperature: req.temperature ?? 0,
            // Not stored by the provider where the option exists; harmless where it does not.
            store: false,
            messages: [{ role: "system", content: req.system }, ...req.messages],
          }),
        });
        if (!res.ok) {
          console.warn(`[ai] provider refused a request: HTTP ${res.status}`);
          return aiFailure(model, `provider error ${res.status}`, res.status);
        }
        const body = await res.json() as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
        };
        return {
          ok: true,
          text: body.choices?.[0]?.message?.content ?? "",
          tokensIn: body.usage?.prompt_tokens ?? 0,
          tokensOut: body.usage?.completion_tokens ?? 0,
          model: body.model || model,
        };
      } catch {
        console.warn("[ai] could not reach the provider");
        return aiFailure(model, "could not reach the provider");
      }
    },
  };
}
