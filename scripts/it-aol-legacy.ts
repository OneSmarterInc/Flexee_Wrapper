import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as S from "../src/db/schema.ts";
import { attemptForTaking, submitAttempt, attemptResult } from "@/lib/assessment";
const d = db();
await d.insert(S.questions).values({ id: "old-c01-001", bookId: "old", chapter: 1, objective: "x", difficulty: "apply", stem: "Legacy stem",
  optionsJson: JSON.stringify([{ id: "a", text: "yes", correct: true, rationale: "r" }, { id: "b", text: "no", correct: false, rationale: "w" }]), points: 1, shuffleOptions: false, contentHash: "h" });
const [sec] = await d.insert(S.sections).values({ bookId: "old", name: "L", joinCode: "LEG1" }).returning();
const [u] = await d.insert(S.users).values({ displayName: "x" }).returning();
const [e] = await d.insert(S.enrolments).values({ sectionId: sec.id, userId: u.id, role: "student" }).returning();
const [ex] = await d.insert(S.exams).values({ sectionId: sec.id, title: "Old", blueprintJson: "{}", feedback: "immediate", attemptLimit: 1, status: "open" }).returning();
const [a] = await d.insert(S.examAttempts).values({ examId: ex.id, enrolmentId: e.id, servedJson: JSON.stringify([{ questionId: "old-c01-001", optionOrder: ["a", "b"] }]), maxPoints: 1 }).returning();
const t = await attemptForTaking(a.id); const s = await submitAttempt(a.id, { "old-c01-001": "a" }); const r = await attemptResult(a.id);
console.log(t!.items[0].stem === "Legacy stem" && s.score === 1 && r!.items[0].correct ? "PASS  pre-snapshot attempt still opens, scores and reviews from the bank" : "*** FAIL ***");
