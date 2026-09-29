// Integration test: publishing a class's book (lib/publish) and who may open it (lib/enrolment).
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setAdminByEmail, parsePeople } from "@/lib/admin";
import { createSection, commitRoster } from "@/lib/roster";
import { enrolmentForBook, userClasses } from "@/lib/enrolment";
import { canManageClass, classBookState, chooseClassBook, publishClassBook, unpublishClassBook } from "@/lib/publish";

const { users, identities, sections } = schema;
let passed = 0; const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};
async function account(name: string, email: string) {
  const [u] = await db().insert(users).values({ displayName: name }).returning();
  await db().insert(identities).values({ userId: u.id, provider: "password", subject: email, passwordHash: "x" });
  return u;
}
const admin = await account("Admin", "admin@flexee.org"); await setAdminByEmail("admin@flexee.org");
const prof = await account("Prof", "prof@flexee.org");
const other = await account("Other Prof", "other@flexee.org");
const stu = await account("Stu", "stu@wright.edu");

// Admin sets up a class for Prof; Stu is a student in it.
const cls = await createSection(admin.id, "sad", "MIS 3250-01", "2027 Spring", { teach: false });
await commitRoster(cls.id, parsePeople("prof@flexee.org"), "instructor");
await commitRoster(cls.id, parsePeople("stu@wright.edu"), "student");
const otherCls = await createSection(other.id, "mis3000", "MIS 3000-02", "2027 Spring", { teach: true });

console.log("A new class starts unpublished");
await t("the book is hidden from the class's students", async () => {
  assert.equal((await classBookState(cls.id))!.published, false);
  assert.equal(await enrolmentForBook(stu.id, "sad"), null);
});
await t("…but the class's faculty can open it to prepare", async () => {
  assert.equal((await enrolmentForBook(prof.id, "sad"))?.role, "instructor");
});
await t("the student's home page shows the class, marked not yet open", async () => {
  const c = (await userClasses(stu.id)).find((x) => x.sectionId === cls.id)!;
  assert.equal(c.published, false); assert.equal(c.canOpen, false);
  const p = (await userClasses(prof.id)).find((x) => x.sectionId === cls.id)!;
  assert.equal(p.canOpen, true); assert.equal(p.role, "instructor");
});

console.log("Who may manage the class's book");
await t("the class's faculty and any admin may; other faculty and students may not", async () => {
  assert.equal(await canManageClass(prof.id, cls.id), true);
  assert.equal(await canManageClass(admin.id, cls.id), true);
  assert.equal(await canManageClass(other.id, cls.id), false);
  assert.equal(await canManageClass(stu.id, cls.id), false);
  const r = await publishClassBook(other.id, cls.id);
  assert.equal(r.ok, false);
  assert.equal((await classBookState(cls.id))!.published, false, "refused publish changed nothing");
  assert.equal((await chooseClassBook(stu.id, cls.id, "mis3000")).ok, false);
});

console.log("Choosing a book");
await t("faculty can switch the class to another library book while unpublished", async () => {
  assert.deepEqual(await chooseClassBook(prof.id, cls.id, "mis3000"), { ok: true });
  assert.equal((await classBookState(cls.id))!.bookId, "mis3000");
  assert.deepEqual(await chooseClassBook(prof.id, cls.id, "sad"), { ok: true });
  assert.equal((await classBookState(cls.id))!.bookId, "sad");
});
await t("a book not in the library is refused", async () => {
  const r = await chooseClassBook(prof.id, cls.id, "no-such-book");
  assert.equal(r.ok, false); assert.equal((await classBookState(cls.id))!.bookId, "sad");
});

console.log("Publishing");
await t("once published, the class's students can open the book", async () => {
  assert.deepEqual(await publishClassBook(prof.id, cls.id), { ok: true });
  const s = await classBookState(cls.id); assert.equal(s!.published, true); assert.ok(s!.publishedAt);
  const e = await enrolmentForBook(stu.id, "sad");
  assert.equal(e?.role, "student"); assert.equal(e?.sectionId, cls.id);
});
await t("publishing again keeps the original publication date", async () => {
  const first = (await classBookState(cls.id))!.publishedAt!.getTime();
  await publishClassBook(admin.id, cls.id);
  assert.equal((await classBookState(cls.id))!.publishedAt!.getTime(), first);
});
await t("the book cannot be switched while students can see it", async () => {
  const r = await chooseClassBook(prof.id, cls.id, "mis3000");
  assert.equal(r.ok, false); assert.match((r as any).error, /Unpublish/);
  assert.equal((await classBookState(cls.id))!.bookId, "sad");
});
await t("unpublishing hides it from students again; faculty keep access", async () => {
  assert.deepEqual(await unpublishClassBook(admin.id, cls.id), { ok: true });
  assert.equal(await enrolmentForBook(stu.id, "sad"), null);
  assert.equal((await enrolmentForBook(prof.id, "sad"))?.role, "instructor");
});

console.log("Publishing is per class");
await t("a student in two classes of the same book can open it through the published one", async () => {
  const cls2 = await createSection(admin.id, "sad", "MIS 3250-02", "2027 Spring", { teach: false });
  await commitRoster(cls2.id, parsePeople("stu@wright.edu"), "student");
  assert.equal(await enrolmentForBook(stu.id, "sad"), null, "neither class published yet");
  await publishClassBook(admin.id, cls2.id);
  assert.equal((await enrolmentForBook(stu.id, "sad"))?.sectionId, cls2.id);
});
await t("publishing one class does not publish another class of the same book", async () => {
  assert.equal((await classBookState(cls.id))!.published, false);
});
await t("classes that existed before publishing (migration 0012) stay open", async () => {
  // a class row with a publication date, as the migration leaves existing classes
  const [legacy] = await db().insert(sections).values({ bookId: "mis3000", name: "Legacy", joinCode: "LEG001",
    createdBy: admin.id, bookPublishedAt: new Date("2026-09-01") }).returning();
  await commitRoster(legacy.id, parsePeople("stu@wright.edu"), "student");
  assert.equal((await enrolmentForBook(stu.id, "mis3000"))?.sectionId, legacy.id);
  await db().delete(sections).where(eq(sections.id, legacy.id));
});
await t("another instructor's class is unaffected by all of this", async () => {
  assert.equal((await classBookState(otherCls.id))!.published, false);
  assert.equal((await enrolmentForBook(other.id, "mis3000"))?.role, "instructor");
});

console.log(`\n${passed} passed`);
