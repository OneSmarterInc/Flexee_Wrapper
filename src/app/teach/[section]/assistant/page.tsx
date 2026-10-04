import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { classById } from "@/lib/admin";
import { canManageClass } from "@/lib/publish";
import { aiAvailable, formatMicros, priceTable } from "@/lib/ai";
import { settingsFor, classUsage, inboxFor, threadsForClass } from "@/lib/assistant/store";
import { NOTICE } from "@/lib/assistant/answer";
import { setAssistantSettingsAction, replyToQuestionAction } from "@/app/actions";
import { formatLocal } from "@/lib/time";
import WorkspaceShell from "@/components/WorkspaceShell";

export const dynamic = "force-dynamic";
const cell = { borderBottom: "1px solid var(--rule)", padding: ".6rem .7rem", textAlign: "left" } as const;
const field = { padding: ".4rem .5rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit", width: "9rem" } as const;

/** Spec 20 §6: the class's switch, its usage against the cap, the inbox, and its threads. */
export default async function ClassAssistant({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { section } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/teach/${section}/assistant`)}`);
  if (!(await canManageClass(user!.id, section))) redirect("/faculty");
  const cls = await classById(section);
  if (!cls) redirect("/faculty");
  const [settings, usage, open, answered, threads, sp] = await Promise.all([
    settingsFor(section), classUsage(section), inboxFor(section, "open"),
    inboxFor(section, "answered"), threadsForClass(section), searchParams,
  ]);
  const { inPerM, outPerM } = priceTable();

  return (
    <WorkspaceShell active="faculty" isAdmin={user!.systemRole === "admin"} canTeach displayName={user!.displayName}
      links={[{ href: `/teach/${section}`, label: "Class" }, { href: "#switch", label: "Switch" }, { href: "#usage", label: "Usage" }, { href: "#inbox", label: "Questions" }, { href: "#threads", label: "Conversations" }]}>
      <header className="workspace-heading"><div>
        <Link className="ui" href={`/teach/${section}`}>← {cls.name}</Link>
        <div className="page-kicker ui" style={{ marginTop: ".8rem" }}>Course assistant</div>
        <h1>Assistant</h1>
        <p className="ui">It answers only from this class&apos;s published book, at the versions this class reads.</p>
      </div></header>
      {sp.ok && <p className="workspace-alert ui" role="status">{sp.ok}</p>}
      {sp.error && <p className="workspace-alert error ui" role="alert">{sp.error}</p>}

      {!aiAvailable() && (
        <section className="workspace-panel ui">
          <h2>Not available yet</h2>
          <p>
            The assistant is switched off for the whole Wrapper until an administrator sets
            <code> AI_ENABLED</code> and a provider key. You can set this class&apos;s switch now; nothing
            will appear for students until both are in place.
          </p>
        </section>
      )}

      <section className="workspace-panel ui" id="switch" aria-labelledby="switch-heading">
        <h2 id="switch-heading">This class</h2>
        <p>
          {settings.enabled
            ? "Students in this class can ask the assistant about the book."
            : "Off. Students see nothing, and the endpoint refuses."}
        </p>
        <p style={{ color: "var(--muted)" }}>
          It is off during any exam or quiz a student has open, and you can turn it off for a single
          assignment from that assignment&apos;s page — useful for an exam you run outside the Wrapper.
        </p>
        <form action={setAssistantSettingsAction} style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="sectionId" value={section} />
          <input type="hidden" name="enabled" value={settings.enabled ? "0" : "1"} />
          <label style={{ display: "grid", gap: ".2rem", fontSize: ".82rem", color: "var(--muted)" }}>
            Questions per student per day
            <input name="dailyPerStudent" type="number" min={0} defaultValue={settings.dailyPerStudent} style={field} />
          </label>
          <label style={{ display: "grid", gap: ".2rem", fontSize: ".82rem", color: "var(--muted)" }}>
            Tokens per month for the class
            <input name="monthlyTokenCap" type="number" min={0} step={10000} defaultValue={settings.monthlyTokenCap} style={field} />
          </label>
          <button type="submit" className="nav-button primary">
            {settings.enabled ? "Turn the assistant off" : "Turn the assistant on"}
          </button>
        </form>
        <p style={{ color: "var(--muted)", fontSize: ".82rem", marginTop: ".8rem" }}>
          Saving the limits also applies the switch shown on the button. 0 in either box means no limit.
        </p>
        <details style={{ marginTop: "1rem" }}>
          <summary className="ui" style={{ cursor: "pointer" }}>What students are told</summary>
          <p style={{ marginTop: ".6rem" }}>{NOTICE}</p>
        </details>
      </section>

      <section className="workspace-panel ui" id="usage" aria-labelledby="usage-heading">
        <h2 id="usage-heading">Usage this month</h2>
        <div className="workspace-stats ui" aria-label="Assistant usage">
          <div className="workspace-stat"><strong>{usage.requests}</strong><span>Questions answered</span></div>
          <div className="workspace-stat"><strong>{usage.tokens.toLocaleString()}</strong><span>Tokens of {usage.cap.toLocaleString()}</span></div>
          <div className="workspace-stat"><strong>{usage.sharePct}%</strong><span>Of the monthly cap</span></div>
          <div className="workspace-stat"><strong>{formatMicros(usage.costMicros)}</strong><span>Estimated cost</span></div>
        </div>
        <p style={{ color: "var(--muted)", fontSize: ".82rem" }}>
          The cap is counted in tokens, so a change in a provider&apos;s prices cannot move it. The cost is
          an estimate at ${inPerM} and ${outPerM} per million tokens in and out, and it is the only
          figure here that is not measured.
        </p>
      </section>

      <section className="workspace-panel ui" id="inbox" aria-labelledby="inbox-heading">
        <h2 id="inbox-heading">Questions for you ({open.length})</h2>
        {open.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Nothing waiting. A student who cannot get an answer from the book can send you their conversation.</p>
        ) : open.map((q) => (
          <div key={q.id} className="workspace-action" style={{ marginBottom: ".8rem" }}>
            <strong>{q.student}</strong>
            <span>{q.title}</span>
            <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>Asked {formatLocal(q.askedAt)}</span>
            <p style={{ margin: ".5rem 0" }}><Link href={`/assistant/${q.threadId}`}>Read the conversation →</Link></p>
            <form action={replyToQuestionAction} style={{ display: "grid", gap: ".5rem" }}>
              <input type="hidden" name="sectionId" value={section} />
              <input type="hidden" name="questionId" value={q.id} />
              <label htmlFor={`reply-${q.id}`} style={{ fontSize: ".82rem", color: "var(--muted)" }}>Your reply</label>
              <textarea id={`reply-${q.id}`} name="body" rows={3} required
                style={{ padding: ".5rem", border: "1px solid var(--rule)", borderRadius: "6px", background: "var(--panel)", color: "var(--ink)", font: "inherit" }} />
              <button type="submit" className="nav-button secondary" style={{ width: "fit-content" }}>Send the reply</button>
            </form>
          </div>
        ))}
        {answered.length > 0 && (
          <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>{answered.length} answered earlier.</p>
        )}
      </section>

      <section className="workspace-panel ui" id="threads" aria-labelledby="threads-heading">
        <h2 id="threads-heading">Conversations ({threads.length})</h2>
        {threads.length === 0 ? <p style={{ color: "var(--muted)" }}>No questions yet.</p> : (
          <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <caption style={{ captionSide: "top", textAlign: "left", padding: ".3rem 0", color: "var(--muted)" }}>
              Every conversation in this class. Students see only their own.
            </caption>
            <thead><tr><th style={cell}>Student</th><th style={cell}>Opened with</th><th style={cell}>Last message</th><th style={cell}></th></tr></thead>
            <tbody>
              {threads.map((t) => (
                <tr key={t.id}>
                  <td style={cell}>{t.student}</td>
                  <td style={cell}>{t.title}</td>
                  <td style={cell}>{formatLocal(t.lastMessageAt)}</td>
                  <td style={cell}><Link href={`/assistant/${t.id}`}>Read →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </WorkspaceShell>
  );
}
