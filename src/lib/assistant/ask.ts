import type { AiProvider } from "@/lib/ai/types";
import type { Chunk } from "./chunk";
import {
  buildPrompt, notInBook, validateCitations, NO_REVIEW_QUESTIONS,
  type Answer,
} from "./answer";

/**
 * One question, one answer (Spec 20 §2) — the three refusal layers in the order they fire.
 *
 * No database and no environment: the endpoint gathers the facts and the evaluation harness
 * supplies its own, so both get the same answer from the same code.
 */

/** Decision 2: the review questions are not indexed, so a student asking about them is told why. */
const ASKS_ABOUT_REVIEW = /\breview question|\bexercises?\b|\bend[- ]of[- ]chapter\b/i;

export type AskInput = {
  question: string;
  /** From retrieve(): the top passages, and whether it is worth asking a provider at all. */
  passages: Chunk[];
  hopeless: boolean;
  allowed: { bookId: string; anchors: Map<string, Set<string>>; entryTitles: Map<string, string> };
  history?: { role: "student" | "assistant"; body: string }[];
  provider: AiProvider;
};

export async function ask(input: AskInput): Promise<Answer> {
  // Layer 1a: the review questions, which are not in the index by decision. No provider call.
  if (ASKS_ABOUT_REVIEW.test(input.question)) {
    return { text: NO_REVIEW_QUESTIONS, citations: [], offerInstructor: true, reason: "no-passage", tokensIn: 0, tokensOut: 0 };
  }
  // Layer 1b: nothing in the book matched at all. No provider call.
  if (input.hopeless || input.passages.length === 0) return notInBook("no-passage");

  const req = buildPrompt({ question: input.question, passages: input.passages, history: input.history });
  const res = await input.provider.complete(req);
  if (!res.ok) {
    return {
      text: "The assistant is not answering just now. Try again in a minute, or ask your instructor.",
      citations: [], offerInstructor: true, reason: "provider-error", tokensIn: 0, tokensOut: 0,
    };
  }

  // Layer 3: an answer that cites nothing in this book is not an answer from this book.
  const { text, citations } = validateCitations(res.text, input.allowed);
  if (citations.length === 0 || !text) {
    return { ...notInBook("no-passage"), tokensIn: res.tokensIn, tokensOut: res.tokensOut };
  }
  return { text, citations, offerInstructor: false, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
}
