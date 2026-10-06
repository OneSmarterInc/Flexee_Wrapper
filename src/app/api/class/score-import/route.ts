import { currentUser } from "@/lib/auth";
import { previewScoreImport, previewForNewColumn, applyScoreImport, createColumnFromFile,
         replaceLabel, nothingToApply, type Options } from "@/lib/score-preview";
import { canGradeSection } from "@/lib/roster";

/**
 * Spec 23: POST previews, PUT applies. Both carry the file's text in the body — it is processed in
 * memory and never written anywhere, which is why there is no upload route and no blob path.
 *
 * A preview is a POST rather than a GET because the file goes in the body; nothing about it writes.
 */
const MAX_BYTES = 2_000_000;      // a class of 30 scores is a few kilobytes; this is generous

function readOptions(body: Record<string, unknown>): Options & { confirmReplace?: boolean } {
  return {
    scoreIndex: typeof body.scoreIndex === "number" ? body.scoreIndex : undefined,
    percentages: body.percentages === true,
    clearBlanks: body.clearBlanks === true,
    allowOverMaximum: body.allowOverMaximum === true,
    confirmReplace: body.confirmReplace === true,
  };
}

async function common(req: Request) {
  const user = await currentUser();
  if (!user) return { error: new Response("Unauthorized", { status: 401 }) };
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return { error: new Response("Bad request", { status: 400 }) };
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!sectionId || !text) return { error: new Response("Bad request", { status: 400 }) };
  if (text.length > MAX_BYTES) {
    return { error: Response.json({ ok: false, error: "That file is too large to read here." }) };
  }
  // Checked here as well as in the library, so a request for a class the person does not teach is
  // refused before any of it is read.
  if (!(await canGradeSection(user.id, sectionId))) {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  return { user, body, sectionId, text };
}

export async function POST(req: Request) {
  const c = await common(req);
  if ("error" in c) return c.error;
  // Either a column that exists, or the column a form is about to create (rule 9). A new one has
  // no scores, so nothing can be replaced on that path and the tick is never owed.
  const newColumn = c.body.newColumn as { title?: unknown; maxPoints?: unknown } | undefined;
  const lineItemId = typeof c.body.lineItemId === "string" ? c.body.lineItemId : "";
  if (!lineItemId && !(newColumn && typeof newColumn.title === "string")) {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const preview = newColumn && !lineItemId
      ? await previewForNewColumn(c.sectionId,
          { title: String(newColumn.title), maxPoints: Number(newColumn.maxPoints) },
          c.text, readOptions(c.body))
      : await previewScoreImport(c.sectionId, lineItemId, c.text, readOptions(c.body));
    return Response.json({
      ok: true, preview,
      replaceLabel: replaceLabel(preview),
      nothingToApply: nothingToApply(preview),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "That file could not be read." });
  }
}

export async function PUT(req: Request) {
  const c = await common(req);
  if ("error" in c) return c.error;
  const opts = readOptions(c.body);

  // Creating a column from the file, or filling one that exists.
  const newColumn = c.body.newColumn as { title?: unknown; maxPoints?: unknown; categoryId?: unknown } | undefined;
  if (newColumn && typeof newColumn.title === "string") {
    const r = await createColumnFromFile(c.user.id, c.sectionId, {
      title: newColumn.title,
      maxPoints: Number(newColumn.maxPoints),
      categoryId: typeof newColumn.categoryId === "string" && newColumn.categoryId ? newColumn.categoryId : null,
    }, c.text, opts);
    return Response.json(r);
  }

  const lineItemId = typeof c.body.lineItemId === "string" ? c.body.lineItemId : "";
  if (!lineItemId) return new Response("Bad request", { status: 400 });
  const r = await applyScoreImport(c.user.id, c.sectionId, lineItemId, c.text, opts);
  return Response.json(r);
}
