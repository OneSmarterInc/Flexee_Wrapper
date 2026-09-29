import { toLocalInput, APP_TZ } from "@/lib/time";

const field = { padding: ".5rem .65rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" } as const;

// The fields of an assignment, shared by the create and edit forms.
export default function AssignmentFields({ a }: { a?: { title: string; kind: string; instructions: string; dueAt: Date | null; points: number; allowLate: boolean; published: boolean } }) {
  return (
    <>
      <input name="title" placeholder="Title" defaultValue={a?.title} required style={field} />
      <select name="kind" defaultValue={a?.kind ?? "assignment"} style={field}>
        <option value="assignment">Assignment</option>
        <option value="case_study">Case study</option>
      </select>
      <textarea name="instructions" placeholder="Instructions for students" defaultValue={a?.instructions} rows={6} style={field} />
      <label>Due <input type="datetime-local" name="due" defaultValue={toLocalInput(a?.dueAt ?? null)} style={field} />
        <span style={{ color: "var(--muted)", marginLeft: ".4rem" }}>({APP_TZ.replace("_", " ")} time)</span></label>
      <label>Points <input type="number" name="points" min={1} max={1000} defaultValue={a?.points ?? 10} required style={{ ...field, width: "6rem" }} /></label>
      <label><input type="checkbox" name="allowLate" defaultChecked={a?.allowLate ?? true} /> Accept late submissions (marked late)</label>
      <label><input type="checkbox" name="published" defaultChecked={a?.published ?? false} /> Published — students can see it</label>
    </>
  );
}
