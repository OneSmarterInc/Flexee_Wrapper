import "server-only";
import { aiAvailable, provider } from "@/lib/ai";
import { retrieve } from "./retrieve";
import { ask } from "./ask";
import { gate } from "./gate";
import {
  addMessage, gateFacts, messagesFor, newThread, recordUsage, threadFor, studentEnrolmentForBook,
} from "./store";
import type { Answer } from "./answer";

/**
 * One question, from a signed-in student to a stored answer (Spec 20).
 *
 * The order is the point: entitlement, then the gate, then retrieval, then the provider, then
 * storage. Nothing reaches a provider that has not passed every check before it, and a question
 * that is refused is never stored as though it had been answered.
 */

export type AskResult =
  | { ok: true; threadId: string; answer: Answer }
  | { ok: false; reason: string; message: string };

export async function askAssistant(input: {
  userId: string;
  bookId: string;
  question: string;
  threadId?: string;
  assignmentId?: string;
}): Promise<AskResult> {
  const question = input.question.trim();
  if (!question) return { ok: false, reason: "empty", message: "Type a question first." };
  if (question.length > 1000) {
    return { ok: false, reason: "long", message: "That is too long for one question — try asking it in a sentence or two." };
  }
  if (!aiAvailable()) {
    return { ok: false, reason: "off", message: "The assistant is not switched on for this class." };
  }

  // Entitlement first: a student enrolment in a class that adopts this book. Whether the book is
  // open to them is the gate's business, so it can say which of the two is the reason.
  const enr = await studentEnrolmentForBook(input.userId, input.bookId);
  if (!enr) {
    return { ok: false, reason: "off", message: "The assistant is for students enrolled in the class." };
  }

  const { facts } = await gateFacts(enr.sectionId, enr.id, { assignmentId: input.assignmentId });
  const decision = gate({ aiAvailable: true, ...facts });
  if (!decision.allowed) return { ok: false, reason: decision.reason, message: decision.message };

  // An existing thread must be this student's own.
  let threadId = input.threadId ?? null;
  let history: { role: "student" | "assistant"; body: string }[] = [];
  if (threadId) {
    const t = await threadFor(input.userId, threadId);
    if (!t || t.as !== "student" || t.enrolmentId !== enr.id) {
      return { ok: false, reason: "thread", message: "That conversation is not yours." };
    }
    history = (await messagesFor(threadId))
      .filter((m) => m.role !== "instructor")
      .map((m) => ({ role: m.role as "student" | "assistant", body: m.body }));
  }

  const { corpus, passages, hopeless } = await retrieve(enr.sectionId, input.bookId, question);
  const ai = provider();
  const answer = await ask({
    question, hopeless, history,
    passages: passages.map((p) => p.chunk),
    allowed: { bookId: input.bookId, anchors: corpus.anchors, entryTitles: corpus.entryTitles },
    provider: ai,
  });

  // The thread exists once there is something to put in it, so a refused question leaves no trace.
  if (!threadId) threadId = (await newThread(enr.sectionId, enr.id, question)).id;
  await addMessage(threadId, "student", question);
  await addMessage(threadId, "assistant", answer.text, answer.citations);
  if (answer.tokensIn > 0 || answer.tokensOut > 0) {
    await recordUsage({
      sectionId: enr.sectionId, enrolmentId: enr.id,
      provider: ai.name, model: ai.model, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut,
    });
  }
  return { ok: true, threadId, answer };
}
