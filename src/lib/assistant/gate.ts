/**
 * Who may ask, and when (Spec 20 §2 and §4).
 *
 * Pure: the endpoint gathers the facts and this decides. That way the evaluation harness can show
 * the refusal without a database, and a test can walk every combination without building a class.
 */

export type GateFacts = {
  /** The global switch and a configured key. */
  aiAvailable: boolean;
  /** The class's own switch. */
  classEnabled: boolean;
  /** The class's book is published to students. */
  bookPublished: boolean;
  /** Exam or quiz attempts this student has open right now. */
  attemptsInProgress: number;
  /** The student is working on an assignment whose faculty turned the assistant off. */
  assignmentOff: boolean;
  /** Requests this student has made today, and the class's per-day allowance. */
  requestsToday: number;
  dailyPerStudent: number;
  /** Tokens this class has spent this month, and its cap. */
  tokensThisMonth: number;
  monthlyTokenCap: number;
};

export type Gate =
  | { allowed: true }
  | { allowed: false; reason: GateReason; message: string };

export type GateReason = "off" | "unpublished" | "attempt" | "assignment" | "daily" | "cap";

/**
 * The messages a student sees. The attempt one says why without being coy: being told "unavailable"
 * during an exam reads like a fault, and a student mid-exam does not need to wonder.
 */
export const GATE_MESSAGES: Record<GateReason, string> = {
  off: "The assistant is not switched on for this class.",
  unpublished: "The assistant becomes available once your instructor opens the book to the class.",
  attempt:
    "The assistant is off while you have an exam or quiz open. Submit it, and the assistant comes " +
    "back. If you are stuck on the exam itself, ask your instructor.",
  assignment: "Your instructor has turned the assistant off for this assignment.",
  daily:
    "You have reached today's limit for the assistant. It resets tomorrow — and you can ask your " +
    "instructor at any time.",
  cap:
    "This class has used its assistant allowance for the month. Ask your instructor; they can see " +
    "the usage and raise it.",
};

const no = (reason: GateReason): Gate => ({ allowed: false, reason, message: GATE_MESSAGES[reason] });

/**
 * Order matters, and it is the order of how much it would mislead a student to say something else
 * first: a class where it is off should never mention exams, and an open attempt outranks a limit
 * because it is the reason that will still be true in a minute.
 */
export function gate(f: GateFacts): Gate {
  if (!f.aiAvailable || !f.classEnabled) return no("off");
  if (!f.bookPublished) return no("unpublished");
  if (f.attemptsInProgress > 0) return no("attempt");
  if (f.assignmentOff) return no("assignment");
  if (f.dailyPerStudent > 0 && f.requestsToday >= f.dailyPerStudent) return no("daily");
  if (f.monthlyTokenCap > 0 && f.tokensThisMonth >= f.monthlyTokenCap) return no("cap");
  return { allowed: true };
}
