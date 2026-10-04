import "server-only";
import { aiAvailable } from "@/lib/ai";
import { gate } from "./gate";
import { gateFacts, studentEnrolmentForBook } from "./store";
import { NOTICE } from "./answer";

/**
 * Should this student see the panel, in this class, right now? (Spec 20 §6.)
 *
 * The panel does not appear for a class where the assistant is off, nor while the student has an
 * exam or quiz open — and because this asks the same `gate` the endpoint asks, the two can never
 * disagree about why.
 */
export async function panelFor(userId: string, bookId: string) {
  if (!aiAvailable()) return null;
  const enr = await studentEnrolmentForBook(userId, bookId);
  if (!enr) return null;
  const { facts } = await gateFacts(enr.sectionId, enr.id);
  const decision = gate({ aiAvailable: true, ...facts });
  if (!decision.allowed) {
    // Off, or not published: say nothing at all. Otherwise the reason is worth showing, because a
    // student who had it a minute ago will wonder where it went.
    return decision.reason === "off" || decision.reason === "unpublished"
      ? null
      : { show: false as const, message: decision.message };
  }
  return { show: true as const, notice: NOTICE };
}
