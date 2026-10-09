// Integration test: Spec 28 commit 5 — assignment attachments and student submissions on disk.
//
// Driven through the two route handlers, not the library, because the authorisation is the point of
// the commit and it lives in the routes. `uploadPrefix()` and `downloadable()` are unchanged from
// the Vercel Blob version, so what these checks really pin is that replacing the storage did not
// quietly widen who may write where, or who may read what.
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSection, enrolAs } from "@/lib/roster";
import { safeFileName, safeFileKey, MAX_UPLOAD_BYTES } from "@/lib/files";
import { POST as uploadPOST, GET as capGET } from "@/app/api/files/upload/route";
import { GET as downloadGET } from "@/app/api/files/[kind]/[id]/route";

const { users, identities, assignments, assignmentFiles, submissions, submissionFiles } = schema;

// Its own volume, so nothing here can reach a real one.
const VOLUME = mkdtempSync(path.join(tmpdir(), "files-"));
process.env.FILES_DIR = VOLUME;

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const headers: any = await import("./test-support/next-headers.mjs");
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
async function signedInAs(userId: string | null) {
  if (!userId) { headers.state.session = null; return; }
  const id = `sess-${userId}`;
  await db().insert(schema.sessions).values({ id, userId, expiresAt: new Date(Date.now() + 864e5) }).onConflictDoNothing();
  headers.state.session = id;
}

const prof = await account("Pat Professor", "prof@flexee.org");
const other = await account("Other Prof", "other@flexee.org");
const ann = await account("Ann Wright", "ann@wright.edu");
const bo = await account("Bo Chen", "bo@wright.edu");
const cls = await createSection(prof.id, "sad", "MIS 3250-01", "2027 Spring", { teach: true });
const otherCls = await createSection(other.id, "sad", "MIS 3250-02", "2027 Spring", { teach: true });
for (const u of [ann, bo]) await enrolAs(cls.id, u.id, "student");

// Built through createAssignment rather than a raw insert, so the fixture cannot drift from the
// schema: `points` is NOT NULL and the first draft of this file omitted it.
const { createAssignment } = await import("@/lib/assignments");
const mk = async (title: string, publishedNow: boolean) => {
  const r = await createAssignment(prof.id, cls.id, { title, points: 10, published: publishedNow });
  assert.ok(r.ok, r.ok === false ? r.error : "");
  return (await db().select().from(assignments).where(eq(assignments.id, (r as { id: string }).id)))[0];
};
const published = await mk("Essay one", true);
const draft = await mk("Not yet", false);

/** POST a body to the upload route as the signed-in person. */
async function upload(q: Record<string, string>, body: string | Uint8Array) {
  const url = `https://learn.flexee.org/api/files/upload?${new URLSearchParams(q)}`;
  const res = await uploadPOST(new Request(url, { method: "POST", body: body as any, duplex: "half" } as any));
  return { res, body: await res.json().catch(() => ({})) };
}
const onVolume = () => {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
    }
  };
  walk(VOLUME, "");
  return out.sort();
};

await t("a student uploads a submission file, and it lands under their own prefix only", async () => {
  await signedInAs(ann.id);
  const { res, body } = await upload({ purpose: "submission", assignmentId: published.id, name: "essay.pdf" }, "my essay");
  assert.equal(res.status, 200, JSON.stringify(body));
  // The key keeps the shape the blobPath column already held, and the user id in it is the
  // server's, not anything the client sent.
  assert.match(body.blobPath, new RegExp(`^submissions/${published.id}/${ann.id}/essay-[0-9a-f]{8}\\.pdf$`));
  assert.equal(body.fileName, "essay.pdf", "the person's own name is kept for display");
  assert.equal(body.sizeBytes, 8);
  assert.equal(readFileSync(path.join(VOLUME, body.blobPath), "utf8"), "my essay");
});

await t("faculty upload an attachment to their own assignment", async () => {
  await signedInAs(prof.id);
  const { res, body } = await upload({ purpose: "assignment", assignmentId: published.id, name: "brief.docx" }, "the brief");
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(body.blobPath, new RegExp(`^assignments/${published.id}/brief-[0-9a-f]{8}\\.docx$`));
});

await t("signed out, nothing uploads", async () => {
  await signedInAs(null);
  const { res, body } = await upload({ purpose: "submission", assignmentId: published.id, name: "x.txt" }, "x");
  assert.equal(res.status, 401);
  assert.match(body.error, /Sign in/);
});

await t("a student cannot upload an assignment attachment", async () => {
  // The purpose is the client's claim; uploadPrefix is what decides. A student asking for the
  // faculty prefix must be refused, not quietly given a submission path.
  await signedInAs(ann.id);
  const { res, body } = await upload({ purpose: "assignment", assignmentId: published.id, name: "sneaky.pdf" }, "x");
  assert.equal(res.status, 403);
  assert.match(body.error, /cannot upload files here/);
});

await t("a student of another class cannot upload to this assignment", async () => {
  const outsider = await account("Outsider", "outsider@wright.edu");
  await enrolAs(otherCls.id, outsider.id, "student");
  await signedInAs(outsider.id);
  const { res } = await upload({ purpose: "submission", assignmentId: published.id, name: "x.txt" }, "x");
  assert.equal(res.status, 403);
});

await t("nobody can submit to an unpublished assignment", async () => {
  await signedInAs(ann.id);
  assert.equal((await upload({ purpose: "submission", assignmentId: draft.id, name: "early.pdf" }, "x")).res.status, 403);
  // Its own faculty still can, because an attachment is how it gets prepared.
  await signedInAs(prof.id);
  assert.equal((await upload({ purpose: "assignment", assignmentId: draft.id, name: "brief.pdf" }, "x")).res.status, 200);
});

await t("faculty of a different class cannot attach to this one", async () => {
  await signedInAs(other.id);
  const { res } = await upload({ purpose: "assignment", assignmentId: published.id, name: "nope.pdf" }, "x");
  assert.equal(res.status, 403);
});

await t("a missing assignment or name is refused before anything is written", async () => {
  await signedInAs(ann.id);
  const before = onVolume().length;
  for (const q of [{ purpose: "submission", assignmentId: "", name: "x.txt" },
                   { purpose: "submission", assignmentId: published.id, name: "" }]) {
    assert.equal((await upload(q as Record<string, string>, "x")).res.status, 400);
  }
  assert.equal((await upload({ purpose: "submission", assignmentId: "no-such-assignment", name: "x.txt" }, "x")).res.status, 403);
  assert.equal(onVolume().length, before, "nothing reached the volume");
});

await t("a filename cannot escape the prefix, however it is written", async () => {
  // The old route checked the client's pathname against the prefix. This one never takes a path
  // from the client at all: it sanitises the name and builds the key itself, so these are refused
  // by construction rather than by comparison.
  await signedInAs(ann.id);
  for (const name of ["../../escape.txt", "/etc/passwd", "a/b/c.txt", "..\\..\\escape.txt", "....//x.txt"]) {
    const { res, body } = await upload({ purpose: "submission", assignmentId: published.id, name }, "x");
    assert.equal(res.status, 200, `${name} should be accepted after sanitising`);
    assert.ok(body.blobPath.startsWith(`submissions/${published.id}/${ann.id}/`), body.blobPath);
    assert.ok(!body.blobPath.includes(".."), body.blobPath);
    assert.equal(body.blobPath.split("/").length, 4, `no extra path segments: ${body.blobPath}`);
  }
  // And nothing was written outside the volume.
  assert.ok(onVolume().every((p) => !p.includes("..")));
  assert.ok(!existsSync(path.join(path.dirname(VOLUME), "escape.txt")));
});

await t("two uploads of the same name do not overwrite each other", async () => {
  // Vercel Blob was doing this with addRandomSuffix; losing it would have been a quiet regression,
  // because an earlier submission row still points at the earlier file.
  await signedInAs(ann.id);
  const a = await upload({ purpose: "submission", assignmentId: published.id, name: "same.pdf" }, "first");
  const b = await upload({ purpose: "submission", assignmentId: published.id, name: "same.pdf" }, "second");
  assert.notEqual(a.body.blobPath, b.body.blobPath);
  assert.equal(readFileSync(path.join(VOLUME, a.body.blobPath), "utf8"), "first", "the first survives");
  assert.equal(readFileSync(path.join(VOLUME, b.body.blobPath), "utf8"), "second");
});

await t("two students of one assignment never share a directory", async () => {
  await signedInAs(ann.id);
  const a = await upload({ purpose: "submission", assignmentId: published.id, name: "work.pdf" }, "ann's");
  await signedInAs(bo.id);
  const b = await upload({ purpose: "submission", assignmentId: published.id, name: "work.pdf" }, "bo's");
  assert.ok(a.body.blobPath.includes(`/${ann.id}/`));
  assert.ok(b.body.blobPath.includes(`/${bo.id}/`));
  assert.notEqual(path.dirname(a.body.blobPath), path.dirname(b.body.blobPath));
});

await t("an oversized upload is refused while streaming, and leaves no fragment", async () => {
  // The cap is counted from the body, not read from Content-Length: a header is a claim.
  await signedInAs(ann.id);
  const before = onVolume();
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1024);
  const { res, body } = await upload({ purpose: "submission", assignmentId: published.id, name: "huge.bin" }, big);
  assert.equal(res.status, 413);
  assert.match(body.error, /larger than 50 MB/);
  assert.deepEqual(onVolume(), before,
    "a partial file must be deleted: a half-written PDF a reader can download is worse than none");
});

await t("the cap is published, so a client can refuse before uploading for a minute", async () => {
  const res = await capGET();
  assert.equal((await res.json()).maxBytes, MAX_UPLOAD_BYTES);
});

// ---------------------------------------------------------------- downloads

/** Record an uploaded file the way the form's server action does, then ask for it back. */
async function recordAndFetch(kind: "assignment" | "submission", who: string, uploaded: any, enrolmentId?: string) {
  let id: string;
  if (kind === "assignment") {
    const [row] = await db().insert(assignmentFiles)
      .values({ assignmentId: published.id, blobPath: uploaded.blobPath, fileName: uploaded.fileName, sizeBytes: uploaded.sizeBytes }).returning();
    id = row.id;
  } else {
    // One submission row per student per assignment (submissions_assignment_enrolment_uq), with
    // many files hanging off it — so this finds or creates rather than inserting each time, which
    // is also what the real flow does.
    let sub = (await db().select().from(submissions)
      .where(and(eq(submissions.assignmentId, published.id), eq(submissions.enrolmentId, enrolmentId!))))[0];
    if (!sub) {
      [sub] = await db().insert(submissions)
        .values({ assignmentId: published.id, enrolmentId: enrolmentId! }).returning();
    }
    const [row] = await db().insert(submissionFiles)
      .values({ submissionId: sub.id, blobPath: uploaded.blobPath, fileName: uploaded.fileName, sizeBytes: uploaded.sizeBytes }).returning();
    id = row.id;
  }
  await signedInAs(who);
  const res = await downloadGET(new Request("https://learn.flexee.org/x"),
    { params: Promise.resolve({ kind, id }) });
  return { res, id };
}

const annEnrolment = (await db().select().from(schema.enrolments)
  .where(and(eq(schema.enrolments.sectionId, cls.id), eq(schema.enrolments.userId, ann.id))))[0];

await t("a student downloads their own submission file, with their own name on it", async () => {
  await signedInAs(ann.id);
  const up = (await upload({ purpose: "submission", assignmentId: published.id, name: "my work.pdf" }, "the work")).body;
  const { res } = await recordAndFetch("submission", ann.id, up, annEnrolment.id);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "the work");
  assert.match(res.headers.get("content-disposition") ?? "", /filename="my work\.pdf"/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-length"), "8");
});

await t("the storage key never reaches the browser", async () => {
  await signedInAs(ann.id);
  const up = (await upload({ purpose: "submission", assignmentId: published.id, name: "secret.pdf" }, "x")).body;
  const { res } = await recordAndFetch("submission", ann.id, up, annEnrolment.id);
  const all = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  assert.ok(!all.includes(up.blobPath), "the key must not appear in any header");
  assert.ok(!all.includes(VOLUME), "nor the volume's path");
});

await t("another student cannot download someone else's submission", async () => {
  await signedInAs(ann.id);
  const up = (await upload({ purpose: "submission", assignmentId: published.id, name: "private.pdf" }, "ann only")).body;
  const { res } = await recordAndFetch("submission", bo.id, up, annEnrolment.id);
  assert.equal(res.status, 404, "and 404, not 403: Bo learns nothing about whether it exists");
});

await t("the class's faculty can download a student's submission; another class's faculty cannot", async () => {
  await signedInAs(ann.id);
  const up = (await upload({ purpose: "submission", assignmentId: published.id, name: "marked.pdf" }, "to mark")).body;
  assert.equal((await recordAndFetch("submission", prof.id, up, annEnrolment.id)).res.status, 200);
  assert.equal((await recordAndFetch("submission", other.id, up, annEnrolment.id)).res.status, 404);
});

await t("signed out, nothing downloads", async () => {
  await signedInAs(prof.id);
  const up = (await upload({ purpose: "assignment", assignmentId: published.id, name: "brief2.pdf" }, "x")).body;
  const { res } = await recordAndFetch("assignment", null as any, up);
  assert.equal(res.status, 401);
});

await t("a record whose file has gone reads 410, not 404 and not a crash", async () => {
  // The state after a restore that brought back the database but not the volume. 410 says the row
  // is real and the bytes are not, which is the only answer that helps whoever is looking.
  await signedInAs(ann.id);
  const up = (await upload({ purpose: "submission", assignmentId: published.id, name: "gone.pdf" }, "x")).body;
  const { rmSync } = await import("node:fs");
  rmSync(path.join(VOLUME, up.blobPath));
  const { res } = await recordAndFetch("submission", ann.id, up, annEnrolment.id);
  assert.equal(res.status, 410);
});

await t("an unknown kind is not found, before any lookup", async () => {
  await signedInAs(ann.id);
  const res = await downloadGET(new Request("https://learn.flexee.org/x"),
    { params: Promise.resolve({ kind: "nonsense", id: "whatever" }) });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------- the pure helpers

await t("safeFileName keeps a readable name and makes it safe", () => {
  assert.match(safeFileName("Essay One.pdf"), /^Essay One-[0-9a-f]{8}\.pdf$/);
  assert.match(safeFileName("../../etc/passwd"), /^passwd-[0-9a-f]{8}$/);
  assert.match(safeFileName("a/b/c.txt"), /^c-[0-9a-f]{8}\.txt$/);
  assert.match(safeFileName(".hidden"), /^hidden-[0-9a-f]{8}$/, "a leading dot would hide the file");
  assert.match(safeFileName(""), /^file-[0-9a-f]{8}$/);
  assert.ok(!safeFileName("x".repeat(500) + ".pdf").includes("x".repeat(100)), "the stem is capped");
  // Different every time, which is the collision guard.
  assert.notEqual(safeFileName("same.pdf"), safeFileName("same.pdf"));
});

await t("safeFileKey refuses what safeKey and fsOps refuse", () => {
  assert.equal(safeFileKey("submissions/a/b/c.pdf"), "submissions/a/b/c.pdf");
  assert.equal(safeFileKey("./submissions//a/c.pdf"), "submissions/a/c.pdf");
  for (const bad of ["../x", "a/../../x", "a/b\\c", "", ".", "./"]) {
    assert.throws(() => safeFileKey(bad), /unsafe file key/, bad);
  }
  assert.throws(() => safeFileKey("a/\u0000/b"), /unsafe file key/);
});

console.log("\n%d checks passed", passed);
