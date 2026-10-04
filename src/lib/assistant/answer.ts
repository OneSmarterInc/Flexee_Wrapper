import type { AiMessage, AiRequest } from "@/lib/ai/types";
import { estimateTokens } from "@/lib/ai/types";
import type { Chunk } from "./chunk";

/**
 * Turning passages into a prompt, and a model's reply into something safe to show (Spec 20 §2).
 *
 * Pure, and free of the database and the provider, so the evaluation harness and the tests build
 * the same prompt the server does and can read it back.
 */

/** The student-facing notice, exactly as decided. Shown wherever the panel is. */
export const NOTICE =
  "AI assistant. It answers from your course book, and it can be wrong. Your instructor can see " +
  "these questions. Only your question and the matching passages from the book are sent to the AI " +
  "service, never your name, email or grades. Please don't type personal details.";

export const NOT_IN_BOOK =
  "I could not find this in your course book, so I would rather not guess. Ask your instructor — " +
  "they will see your question and this conversation.";

/** Decision 2: the review questions are not in the index, and a student is told why. */
export const NO_REVIEW_QUESTIONS =
  "I do not discuss the chapters' review questions or exercises — those are for you and your " +
  "instructor. Ask me about anything else in the book.";

export const HISTORY_TURNS = 6;      // three exchanges
export const HISTORY_TOKEN_CAP = 1500;
export const MAX_OUTPUT_TOKENS = 700;

export const SYSTEM = [
  "You are a reading assistant inside a university course. You answer only from the numbered",
  "passages given to you, which come from the student's own course book.",
  "",
  "Rules you must follow:",
  "- Use only the passages. Do not use anything else you know, however confident you are.",
  "- If the passages do not answer the question, say so in one sentence and stop. Do not guess.",
  "- Cite every claim with a link exactly as the passage gives it, for example [Actors, Goals, and",
  "  the System Boundary](/sad/ch03#c3s2). Never invent a link or change one.",
  "- Be brief: a few sentences, or a short list. You are helping someone read, not writing an essay.",
  "- Never give an answer to an exam or quiz question, and never write a student's assignment.",
  "- Plain text and markdown links only. No HTML, no images, no code fences unless the passage has code.",
].join("\n");

export type Citation = { entryId: string; anchor: string | null; label: string; href: string };

/** How a passage appears in the prompt. The address is the one the reader's page carries. */
export function passageBlock(c: Chunk, n: number) {
  const href = `/${c.bookId}/${c.entryId}${c.anchor ? `#${c.anchor}` : ""}`;
  const where = c.chapter != null ? `Chapter ${c.chapter}, ${c.entryTitle}` : c.entryTitle;
  return `[${n}] ${c.heading} (${href})\nFrom ${where}.\n\n${c.text}`;
}

export function buildPrompt(opts: {
  question: string;
  passages: Chunk[];
  history?: { role: "student" | "assistant"; body: string }[];
}): AiRequest {
  const blocks = opts.passages.map((c, i) => passageBlock(c, i + 1)).join("\n\n---\n\n");
  const history: AiMessage[] = [];
  // The most recent turns, oldest first, and only as many as the cap allows.
  const recent = (opts.history ?? []).slice(-HISTORY_TURNS);
  let budget = HISTORY_TOKEN_CAP;
  for (const m of [...recent].reverse()) {
    const cost = estimateTokens(m.body);
    if (cost > budget) break;
    budget -= cost;
    history.unshift({ role: m.role === "student" ? "user" : "assistant", content: m.body });
  }
  return {
    system: SYSTEM,
    messages: [
      ...history,
      { role: "user", content: `Passages from the book:\n\n${blocks}\n\n---\n\nQuestion: ${opts.question}` },
    ],
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
  };
}

const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const BARE_URL = /\bhttps?:\/\/\S+/gi;

/**
 * Layer 3 of the refusal, and rule 6 in one pass.
 *
 * A model's reply is never rendered as HTML and never trusted to link anywhere. Every link is
 * checked against the addresses this class's book actually has — the entry must be one of the
 * entries the passages came from, and the fragment must be one of that entry's section, figure or
 * table ids. A link that passes becomes a citation; a link that does not is reduced to its own
 * text, so the sentence still reads. Bare URLs are removed outright.
 *
 * The text that comes back carries no markup at all: the panel renders it as paragraphs and the
 * citations as a list of links beside it.
 */
export function validateCitations(
  raw: string,
  allowed: { bookId: string; anchors: Map<string, Set<string>>; entryTitles: Map<string, string> },
) {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let stripped = 0;

  const text = raw.replace(LINK, (_m, label: string, href: string) => {
    const ok = /^\/([^/#\s]+)\/([^/#\s]+)(?:#([^\s]+))?$/.exec(href);
    const entryId = ok?.[2];
    const anchor = ok?.[3] ?? null;
    const sameBook = ok?.[1] === allowed.bookId;
    const knownEntry = !!entryId && allowed.anchors.has(entryId);
    const knownAnchor = anchor == null || (knownEntry && allowed.anchors.get(entryId!)!.has(anchor));
    if (sameBook && knownEntry && knownAnchor) {
      const href2 = `/${allowed.bookId}/${entryId}${anchor ? `#${anchor}` : ""}`;
      if (!seen.has(href2)) {
        seen.add(href2);
        citations.push({
          entryId: entryId!, anchor,
          label: label.trim() || allowed.entryTitles.get(entryId!) || entryId!,
          href: href2,
        });
      }
      return label.trim() || allowed.entryTitles.get(entryId!) || entryId!;
    }
    stripped++;
    return label.trim();
  }).replace(BARE_URL, () => { stripped++; return ""; });

  return { text: text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), citations, stripped };
}

/** What the student is shown. `offerInstructor` drives the Ask your instructor button. */
export type Answer = {
  text: string;
  citations: Citation[];
  offerInstructor: boolean;
  /** Why, when it did not go to a provider at all. */
  reason?: "no-passage" | "limit" | "attempt" | "off" | "provider-error";
  tokensIn: number;
  tokensOut: number;
};

export const notInBook = (reason: Answer["reason"] = "no-passage"): Answer =>
  ({ text: NOT_IN_BOOK, citations: [], offerInstructor: true, reason, tokensIn: 0, tokensOut: 0 });
