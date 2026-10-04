import { aiFailure, type AiProvider, type AiRequest, type AiResult } from "./types";

/**
 * Anthropic's Messages API. The only Anthropic-specific code in the repository.
 *
 * Nothing here logs a prompt, an answer or an identifier — a status code is the most it will say,
 * because the body of a provider error can quote the request back.
 */
export function anthropicProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const model = env.AI_MODEL || "claude-sonnet-5-5";
  return {
    name: "anthropic",
    model,
    async complete(req: AiRequest): Promise<AiResult> {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) return aiFailure(model, "not configured");
      try {
        const res = await fetch(`${env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": env.ANTHROPIC_VERSION || "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: req.maxTokens,
            temperature: req.temperature ?? 0,
            system: req.system,
            messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        if (!res.ok) {
          console.warn(`[ai] provider refused a request: HTTP ${res.status}`);
          return aiFailure(model, `provider error ${res.status}`, res.status);
        }
        const body = await res.json() as {
          content?: { type: string; text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
          model?: string;
        };
        const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        return {
          ok: true, text,
          tokensIn: body.usage?.input_tokens ?? 0,
          tokensOut: body.usage?.output_tokens ?? 0,
          model: body.model || model,
        };
      } catch {
        console.warn("[ai] could not reach the provider");
        return aiFailure(model, "could not reach the provider");
      }
    },
  };
}
