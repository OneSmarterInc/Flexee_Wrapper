import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ownedSection } from "@/lib/roster";
import { gradebook } from "@/lib/gradebook";
import { sectionHasLtiLink } from "@/lib/lti";
import { show, DEFAULT_LETTER_BANDS } from "@/lib/grading";
import { isParticipation, d2lKey } from "@/lib/gradebook";
import { formatLocal } from "@/lib/time";
import {
  setWeightsAction, addLineItemAction, setScoreAction, pushGradesAction,
  setCategoriesAction, applyStarterCategoriesAction, setColumnCategoryAction, setLetterBandsAction,
} from "@/app/actions";
import LogoutButton from "@/components/LogoutButton";
import CopyGradingSetup from "@/components/CopyGradingSetup";
import { copyableClasses } from "@/lib/grading-copy";

export const dynamic = "force-dynamic";
const cell = { border: "1px solid var(--rule)", padding: ".4rem .55rem", textAlign: "left", whiteSpace: "nowrap" } as const;
const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
const field = { padding: ".3rem .4rem", border: "1px solid var(--field-border)", borderRadius: "5px", background: "var(--panel)", color: "var(--ink)", font: "inherit", width: "4rem" } as const;

export default async function Gradebook({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ pushed?: string; skipped?: string; withdrawn?: string; push_error?: string; grading_ok?: string; grading_error?: string; show_withdrawn?: string }> }) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/gradebook`)}`);
  const sec = await ownedSection(user!.id, section);
  if (!sec) redirect("/teach");
  const showWithdrawn = (await searchParams).show_withdrawn === "1";
  const { items, students, categories, bands, categorised } = await gradebook(section, { includeWithdrawn: showWithdrawn });
  const [ltiLinked, spx] = await Promise.all([sectionHasLtiLink(section), searchParams]);
  // Spec 17: a row D2L cannot match, flagged where the export is.
  const noD2lKey = students.filter((s) => !d2lKey(s)).length;
  const copyFrom = await copyableClasses(user!.id, section);

  return (
    <main className="catalog" style={{ maxWidth: "min(100%, 70rem)" }}>
      <LogoutButton />
      <p className="ui"><Link href={`/teach/${section}`}>← {sec.name}</Link></p>
      <h1>Gradebook</h1>
      <p className="ui" style={{ color: "var(--muted)" }}>
        {categorised
          ? "Each category is a weighted mean of its columns' percentages; the course grade is a weighted average of the categories that have graded work. Ungraded work is left out."
          : "Weighted total is the average of each column's percentage, weighted per column, over the items a student has been graded on. Exams appear automatically; add manual columns below."}
      </p>

      {items.length === 0 ? <p className="ui" style={{ color: "var(--muted)" }}>No columns yet — create an exam or add a manual column.</p> : (
        <div style={{ overflowX: "auto" }}>
          <form action={setWeightsAction}>
            <input type="hidden" name="sectionId" value={section} />
            <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr>
                  <th style={cell}>Student</th>
                  {items.map((it) => <th key={it.id} style={num}>{it.title}<div style={{ fontWeight: 400, color: "var(--muted)" }}>{isParticipation(it) ? "participation" : `/ ${it.maxPoints} · ${it.kind}`}</div></th>)}
                  {categorised && categories.map((c) => (
                    <th key={c.id} style={{ ...num, background: "var(--mark)" }}>{c.name}<div style={{ fontWeight: 400, color: "var(--muted)" }}>{show(c.weight)}%{c.dropLowest > 0 ? ` · drop ${c.dropLowest}` : ""}</div></th>
                  ))}
                  <th style={num}>{categorised ? "Course %" : "Total %"}</th>
                  {categorised && <th style={num}>Letter</th>}
                </tr>
                <tr>
                  <th style={{ ...cell, color: "var(--muted)", fontWeight: 400 }}>weight →</th>
                  {items.map((it) => <th key={it.id} style={num}>{isParticipation(it)
                    ? <span style={{ color: "var(--muted)" }}>—</span>
                    : <input name={`weight_${it.id}`} defaultValue={it.weight} style={field} type="number" min={0} step="0.5" />}</th>)}
                  {categorised && categories.map((c) => <th key={c.id} style={num} />)}
                  <th style={num}><button type="submit" className="nav-button primary">Save</button></th>
                  {categorised && <th style={num} />}
                </tr>
              </thead>
              <tbody>
                {students.length === 0 && <tr><td style={cell} colSpan={items.length + 2 + (categorised ? categories.length + 1 : 0)}>No students enrolled yet.</td></tr>}
                {students.map((s) => (
                  <tr key={s.enrolmentId}>
                    <td style={cell}>{s.name}{s.isDemo && <span style={demoTag}>Demo</span>}{s.withdrawnAt && <span style={demoTag}>Withdrawn</span>}<div style={{ color: "var(--muted)", fontSize: ".78rem" }}>{s.email}</div></td>
                    {items.map((it) => {
                      const c = s.cells[it.id];
                      if (isParticipation(it)) return (
                        <td key={it.id} style={num}>
                          {c.completedAt
                            ? <span title={formatLocal(c.completedAt)}>Completed<div style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".72rem" }}>{formatLocal(c.completedAt)}</div></span>
                            : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                      );
                      if (it.kind === "manual" || it.kind === "sim") return (
                        <td key={it.id} style={num}>
                          <form action={setScoreAction} style={{ display: "inline-flex", gap: ".2rem" }}>
                            <input type="hidden" name="sectionId" value={section} /><input type="hidden" name="lineItemId" value={it.id} /><input type="hidden" name="enrolmentId" value={s.enrolmentId} />
                            <input name="points" defaultValue={c.points ?? ""} placeholder="—" style={{ ...field, width: "3.2rem" }} />
                          </form>
                        </td>
                      );
                      return <td key={it.id} style={num}>{c.points == null ? <span style={{ color: "var(--muted)" }}>—</span> : c.points}</td>;
                    })}
                    {categorised && s.categories.map((c) => (
                      <td key={c.id} style={{ ...num, background: "var(--mark)" }}>{c.pct == null ? <span style={{ color: "var(--muted)" }}>—</span> : `${show(c.pct)}%`}</td>
                    ))}
                    <td style={{ ...num, fontWeight: 600, color: "var(--navy)" }}>{s.total == null ? "—" : `${show(s.total)}%`}<div style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".72rem" }}>{s.graded}/{items.length}</div></td>
                    {categorised && <td style={{ ...num, fontWeight: 700, color: "var(--navy)" }}>{s.letter ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </form>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>Manual-column cells are editable inline (press Enter to save). Exam columns use each quiz or exam's own retake rule.</p>
        </div>
      )}

      <h2 id="grading-setup" style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Grading setup</h2>
      {spx.grading_ok && <p className="ui" style={{ color: "var(--ok)" }}>{spx.grading_ok}</p>}
      {spx.grading_error && <p className="ui" style={{ color: "var(--danger)" }} role="alert">{spx.grading_error}</p>}

      {!categorised ? (
        <>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
            This class grades by column weight. Set up your syllabus's categories to grade by weighted
            categories instead — quizzes, exams, assignments and simulations. Nothing changes until you do.
          </p>
          <form action={applyStarterCategoriesAction}>
            <input type="hidden" name="sectionId" value={section} />
            <button type="submit" className="nav-button primary">
              Set up grading categories
            </button>
          </form>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>Starts from Quizzes 15 · Exams 35 · Assignments 30 · Simulations 20, which you can edit or delete.</p>
        </>
      ) : (
        <>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
            Weights must total 100% to save. Clearing every name removes the categories and returns the
            class to grading by column weight.
          </p>
          <form action={setCategoriesAction} className="ui">
            <input type="hidden" name="sectionId" value={section} />
            <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem", marginBottom: ".6rem" }}>
              <thead><tr><th style={cell}>Category</th><th style={num}>Weight %</th><th style={num}>Drop lowest</th></tr></thead>
              <tbody>
                {categories.map((c, i) => (
                  <tr key={c.id}>
                    <td style={cell}>
                      <input type="hidden" name={`cat_id_${i}`} value={c.id} />
                      <input name={`cat_name_${i}`} defaultValue={c.name} style={{ ...field, width: "14rem" }} />
                    </td>
                    <td style={num}><input name={`cat_weight_${i}`} type="number" min={0} step="0.5" defaultValue={c.weight} style={field} /></td>
                    <td style={num}><input name={`cat_drop_${i}`} type="number" min={0} defaultValue={c.dropLowest} style={field} /></td>
                  </tr>
                ))}
                <tr>
                  <td style={cell}><input name={`cat_name_${categories.length}`} placeholder="Add a category…" style={{ ...field, width: "14rem" }} /></td>
                  <td style={num}><input name={`cat_weight_${categories.length}`} type="number" min={0} step="0.5" defaultValue={0} style={field} /></td>
                  <td style={num}><input name={`cat_drop_${categories.length}`} type="number" min={0} defaultValue={0} style={field} /></td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th style={{ ...cell, color: "var(--muted)", fontWeight: 400 }}>Running total</th>
                  <th style={{ ...num, color: Math.abs(categories.reduce((t, c) => t + c.weight, 0) - 100) < 0.01 ? "var(--ok)" : "var(--danger)" }}>
                    {show(categories.reduce((t, c) => t + c.weight, 0))}%
                  </th>
                  <th style={num} />
                </tr>
              </tfoot>
            </table>
            <button type="submit" className="nav-button primary">Save categories</button>
          </form>

          {items.length > 0 && (
            <>
              <h3 style={{ color: "var(--navy)", marginTop: "1.2rem", fontSize: "1rem" }}>Which category each column counts in</h3>
              <form action={setColumnCategoryAction} className="ui">
                <input type="hidden" name="sectionId" value={section} />
                <table className="ui" style={{ borderCollapse: "collapse", fontSize: ".85rem", marginBottom: ".6rem" }}>
                  <thead><tr><th style={cell}>Column</th><th style={cell}>Kind</th><th style={cell}>Category</th></tr></thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td style={cell}>{it.title}</td>
                        <td style={{ ...cell, color: "var(--muted)" }}>{it.kind}</td>
                        <td style={cell}>
                          <select name={`column_cat_${it.id}`} defaultValue={it.categoryId ?? ""} style={{ ...field, width: "12rem" }}>
                            <option value="">— none —</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="submit" className="nav-button primary">Save assignments</button>
              </form>
              <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>A column in no category does not count towards the course grade.</p>
            </>
          )}

          <h3 style={{ color: "var(--navy)", marginTop: "1.2rem", fontSize: "1rem" }}>Letter scale</h3>
          <form action={setLetterBandsAction} className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "end" }}>
            <input type="hidden" name="sectionId" value={section} />
            {bands.map((b, i) => (
              <span key={i} style={{ display: "inline-flex", gap: ".2rem", alignItems: "center" }}>
                <input name={`band_letter_${i}`} defaultValue={b.letter} style={{ ...field, width: "3.2rem" }} aria-label="Letter" />
                <span style={{ color: "var(--muted)" }}>≥</span>
                <input name={`band_min_${i}`} type="number" min={0} max={100} step="0.1" defaultValue={b.min} style={{ ...field, width: "4.4rem" }} aria-label="Minimum percentage" />
              </span>
            ))}
            <button type="submit" className="nav-button primary">Save scale</button>
          </form>
          <form action={setLetterBandsAction} style={{ marginTop: ".4rem" }}>
            <input type="hidden" name="sectionId" value={section} />
            <input type="hidden" name="preset" value="plusminus" />
            <button type="submit" className="nav-button ghost">Add +/− bands</button>
          </form>
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".8rem" }}>
            Default is {DEFAULT_LETTER_BANDS.map((b) => `${b.letter} ≥ ${b.min}`).join(" · ")}. Clear every letter to restore it.
          </p>
        </>
      )}

      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Add a manual column</h2>
      <form action={addLineItemAction} className="ui" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "end" }}>
        <input type="hidden" name="sectionId" value={section} />
        <input name="title" placeholder="Column title (e.g. Participation)" required style={{ ...field, width: "16rem" }} />
        <input name="maxPoints" type="number" min={1} defaultValue={100} style={field} title="Max points" />
        <input name="weight" type="number" min={0} step="0.5" defaultValue={1} style={field} title="Weight" />
        <button type="submit" className="nav-button primary">Add</button>
      </form>

      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        <Link href={`/teach/${section}/gradebook${showWithdrawn ? "" : "?show_withdrawn=1"}`}>
          {showWithdrawn ? "Hide withdrawn students" : "Show withdrawn students"}
        </Link>
        {showWithdrawn ? " — withdrawn students are shown here but are left out of every export." : ""}
      </p>
      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Copy a grading setup</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        Take another class&apos;s categories and letter scale. Retake rules belong to individual exams
        and quizzes, so they are not copied. You see exactly what would change before anything does.
      </p>
      <CopyGradingSetup sectionId={section} choices={copyFrom} />


      <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Export</h2>
      <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
        Download a CSV to import into your LMS. Confirm the exact shape against your institution's importer.
      </p>
      {noD2lKey > 0 && (
        <p className="ui" style={{ color: "var(--danger)", fontSize: ".85rem" }}>
          {noD2lKey} student{noD2lKey === 1 ? "" : "s"} {noD2lKey === 1 ? "has" : "have"} neither a D2L username nor an
          email address, so the Username cell in the Brightspace/D2L export is blank for {noD2lKey === 1 ? "that row" : "those rows"} and
          D2L will not match {noD2lKey === 1 ? "it" : "them"}. Importing this class&apos;s list from D2L fills the username in.
        </p>
      )}
      <div className="ui" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {["generic", "canvas", "d2l", "blackboard", "moodle"].map((f) => (
          <a key={f} href={`/api/gradebook/export?section=${section}&format=${f}`}>{f === "d2l" ? "Brightspace/D2L" : f[0].toUpperCase() + f.slice(1)} CSV</a>
        ))}
      </div>

      {ltiLinked && (
        <>
          <h2 style={{ color: "var(--navy)", marginTop: "1.6rem" }}>Push grades to the LMS</h2>
          {spx.pushed && <p className="ui" style={{ color: "var(--ok)" }}>Pushed {spx.pushed} score(s){spx.skipped && Number(spx.skipped) > 0 ? `, skipped ${spx.skipped} (no score or no LMS user)` : ""}{spx.withdrawn && Number(spx.withdrawn) > 0 ? `, and ${spx.withdrawn} withdrawn student(s) were left out` : ""}.</p>}
          {spx.push_error && <p className="ui" style={{ color: "var(--danger)" }}>{spx.push_error}</p>}
          <p className="ui" style={{ color: "var(--muted)", fontSize: ".85rem" }}>This section is linked to an LMS via LTI. Push creates a line item per column and sends each student's points.</p>
          <form action={pushGradesAction}><input type="hidden" name="sectionId" value={section} /><button type="submit" className="nav-button primary">Push grades to LMS</button></form>
        </>
      )}
    </main>
  );
}
const demoTag = { marginLeft: ".4rem", padding: ".05rem .35rem", border: "1px solid var(--rule)", borderRadius: "4px", fontSize: ".7rem", color: "var(--muted)" } as const;
