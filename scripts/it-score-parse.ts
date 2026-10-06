// Integration test: Spec 23 rules 1, 4 and the half of 5 that is arithmetic — reading the file.
//
// Pure, so it runs without a database. The CSV splitting is @/lib/d2l's and already has its own
// suite; what is checked here is that this reader uses it and then finds the right columns, reads
// a cell the way a spreadsheet writes one, and converts a percentage correctly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readHeaders, parseScoreFile, readValue, SCORE_HEADERS } from "@/lib/score-import";

let passed = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name); throw e; }
};

const BOM = "﻿";

t("a byte-order mark, CRLF, quotes and extra columns all read", () => {
  const text = BOM + [
    `Name,Email,OrgDefinedId,Score,Comment`,
    `"Alvarez, Maria",maria@wright.edu,W001,8,"good, thorough"`,
    `"O""Brien, Sean",sean@wright.edu,W002,9.5,fine`,
  ].join("\r\n") + "\r\n";

  const f = parseScoreFile(text);
  assert.equal(f.fatal, null);
  assert.equal(f.headers.identifier?.kind, "email");
  assert.equal(f.headers.identifier?.index, 1);
  assert.deepEqual(f.headers.ignored, ["OrgDefinedId"]);
  assert.equal(f.rowCount, 2);
  assert.deepEqual(f.rows, [
    { line: 1, identifier: "maria@wright.edu", raw: "8" },
    { line: 2, identifier: "sean@wright.edu", raw: "9.5" },
  ]);
});

t("a quoted field holding a newline does not split the row", () => {
  const text = `Email,Score,Note\na@wright.edu,7,"line one\nline two"\nb@wright.edu,8,x\n`;
  const f = parseScoreFile(text);
  assert.equal(f.rows.length, 2, f.rows.map((r) => r.identifier).join(" | "));
  assert.deepEqual(f.rows.map((r) => r.raw), ["7", "8"]);
});

t("the identifier is found by header, whatever the case or spacing", () => {
  for (const h of ["Email", "email", " E-Mail ", "E_MAIL"]) {
    const f = parseScoreFile(`${h},Score\na@wright.edu,5\n`);
    assert.equal(f.headers.identifier?.kind, "email", h);
  }
  for (const h of ["UserName", "username", "User Name", "user_name"]) {
    const f = parseScoreFile(`${h},Score\npw0001,5\n`);
    assert.equal(f.headers.identifier?.kind, "username", h);
  }
});

t("Email wins when a file carries both, and the header's own text is kept", () => {
  const f = parseScoreFile(`UserName,Email,Score\npw0001,a@wright.edu,5\n`);
  assert.equal(f.headers.identifier?.kind, "email");
  assert.equal(f.headers.identifier?.header, "Email");
  assert.equal(f.rows[0].identifier, "a@wright.edu");
});

t("the score column is offered in the spec's order, not the file's", () => {
  assert.deepEqual([...SCORE_HEADERS], ["score", "points", "grade"]);
  // Grade comes first in the file; Score is still offered first.
  const f = parseScoreFile(`Email,Grade,Points,Score\na@wright.edu,1,2,3\n`);
  assert.deepEqual(f.headers.scoreColumns.map((c) => c.header), ["Score", "Points", "Grade"]);
  assert.equal(f.rows[0].raw, "3", "it read the Score column");
});

t("a D2L-style score header is recognised, with its item title and declared maximum", () => {
  const h = "Studio session Points Grade <Numeric MaxPoints:10>";
  const f = parseScoreFile(`Username,OrgDefinedId,${JSON.stringify(h)}\npw0001,W001,8\n`);
  assert.equal(f.fatal, null);
  const col = f.headers.scoreColumns[0];
  assert.equal(col.via, "d2l");
  assert.equal(col.itemTitle, "Studio session");
  assert.equal(col.fileMax, 10);
  assert.equal(f.rows[0].raw, "8");
  // and without the <Numeric MaxPoints:N> part, which D2L sometimes omits
  const f2 = parseScoreFile(`Email,"Quiz 1 Points Grade"\na@wright.edu,4\n`);
  assert.equal(f2.headers.scoreColumns[0]?.via, "d2l");
  assert.equal(f2.headers.scoreColumns[0]?.fileMax, null);
  assert.equal(f2.headers.scoreColumns[0]?.itemTitle, "Quiz 1");
});

t("a plainly named column is preferred over a D2L one in the same file", () => {
  const f = parseScoreFile(`Email,"Quiz Points Grade <Numeric MaxPoints:10>",Score\na@wright.edu,4,9\n`);
  assert.equal(f.headers.scoreColumns[0].header, "Score");
  assert.equal(f.rows[0].raw, "9");
});

t("faculty can choose a different score column, by index", () => {
  const text = `Email,Score,Points\na@wright.edu,1,2\n`;
  assert.equal(parseScoreFile(text).rows[0].raw, "1");
  assert.equal(parseScoreFile(text, { scoreIndex: 2 }).rows[0].raw, "2");
  // and a column that is not in the file is refused rather than read as blank
  assert.match(parseScoreFile(text, { scoreIndex: 9 }).fatal ?? "", /not a column/);
});

t("a file with no identifier column, or no score column, says which is missing", () => {
  assert.match(parseScoreFile(`Name,Score\nMaria,8\n`).fatal ?? "", /Email, UserName or Username/);
  assert.match(parseScoreFile(`Email,Comment\na@wright.edu,hi\n`).fatal ?? "", /Score, Points or Grade/);
  assert.match(parseScoreFile("").fatal ?? "", /empty/);
  assert.match(parseScoreFile(BOM + "\r\n").fatal ?? "", /empty/);
});

t("a header row with no data rows reads as a file with no rows, not as an error", () => {
  const f = parseScoreFile(`Email,Score\n`);
  assert.equal(f.fatal, null);
  assert.deepEqual(f.rows, []);
  assert.equal(f.rowCount, 0);
});

// ------------------------------------------------------------------------- one cell at a time

const read = (raw: string, max = 10, percentages = false) =>
  readValue(raw, { maxPoints: max, percentages });

t("a blank cell is a blank, which means no change", () => {
  for (const raw of ["", "   ", "\t"]) assert.deepEqual(read(raw), { kind: "blank" }, JSON.stringify(raw));
});

t("a number reads as points, in the forms a spreadsheet writes them", () => {
  assert.deepEqual(read("8"), { kind: "value", points: 8, rounded: false });
  assert.deepEqual(read("8.5"), { kind: "value", points: 8.5, rounded: false });
  assert.deepEqual(read(".5"), { kind: "value", points: 0.5, rounded: false });
  assert.deepEqual(read("8."), { kind: "value", points: 8, rounded: false });
  assert.deepEqual(read("+8"), { kind: "value", points: 8, rounded: false });
  assert.deepEqual(read(" 8 "), { kind: "value", points: 8, rounded: false });
  assert.deepEqual(read("8 pts"), { kind: "value", points: 8, rounded: false });
  assert.deepEqual(read("1,250", 2000), { kind: "value", points: 1250, rounded: false });
  assert.deepEqual(read("0"), { kind: "value", points: 0, rounded: false });
});

t("a word, a dash or a stray symbol is not a number", () => {
  for (const raw of ["abc", "-", "—", "n/a", "N/A", "8/10", "8-9", "1e3", "--5", "8.5.5", "$8"]) {
    const r = read(raw);
    assert.equal(r.kind, "bad", `${raw} read as ${JSON.stringify(r)}`);
    assert.equal((r as { reason: string }).reason, "not a number", raw);
  }
});

t("a negative score is refused, and says so distinctly", () => {
  for (const raw of ["-1", "-0.5", " -4 "]) {
    const r = read(raw);
    assert.equal(r.kind, "bad", raw);
    assert.equal((r as { reason: string }).reason, "below zero", raw);
  }
});

t("over the maximum is not judged here, because the caller decides", () => {
  // Decision 2: faculty may allow bonus marks, so the reader reports the value and the preview
  // decides whether to keep it.
  assert.deepEqual(read("15"), { kind: "value", points: 15, rounded: false });
  assert.deepEqual(read("150", 10, true), { kind: "value", points: 15, rounded: false });
});

t("the percentage toggle converts against the column's maximum", () => {
  assert.deepEqual(read("80", 10, true), { kind: "value", points: 8, rounded: false });
  assert.deepEqual(read("100", 25, true), { kind: "value", points: 25, rounded: false });
  assert.deepEqual(read("0", 25, true), { kind: "value", points: 0, rounded: false });
  assert.deepEqual(read("85%", 20, true), { kind: "value", points: 17, rounded: false });
  // the same text means two different things under the toggle, which is why it is explicit
  assert.deepEqual(read("80", 10, false), { kind: "value", points: 80, rounded: false });
});

t("a value that needs rounding says so, and one that does not says it does not", () => {
  assert.deepEqual(read("7.129"), { kind: "value", points: 7.13, rounded: true });
  assert.deepEqual(read("33.333", 100, true), { kind: "value", points: 33.33, rounded: true });
  assert.deepEqual(read("7.13"), { kind: "value", points: 7.13, rounded: false });
  // a third of a 30-point column: 10 exactly, so nothing was rounded
  assert.deepEqual(read("33.3333333", 30, true), { kind: "value", points: 10, rounded: true });
  assert.deepEqual(read("50", 30, true), { kind: "value", points: 15, rounded: false });
});

// ------------------------------------------------------- the sample files shipped with the change
//
// Load-bearing rather than decoration: the change note points faculty at these, so they have to
// parse the way it says they do. Every student in them is invented and every address is a reserved
// .invalid one, so no real student data is in the repository.

t("the three sample files parse the way the change note says", () => {
  const read = (name: string) => readFileSync(`scripts/fixtures/${name}`, "utf8");

  const simple = parseScoreFile(read("scores_simple.csv"));
  assert.equal(simple.fatal, null);
  assert.equal(simple.headers.identifier?.kind, "email");
  assert.equal(simple.rows.length, 4);
  assert.deepEqual(simple.rows.map((r) => r.raw), ["8", "9.5", "7", "10"]);

  // The messy one: a byte-order mark, CRLF, a D2L score header, and one of every problem.
  const messy = parseScoreFile(read("scores_d2l_messy.csv"));
  assert.equal(messy.fatal, null, messy.fatal ?? "");
  assert.equal(messy.headers.identifier?.kind, "username");
  assert.deepEqual(messy.headers.ignored, ["OrgDefinedId"]);
  const col = messy.headers.scoreColumns[0];
  assert.equal(col.via, "d2l");
  assert.equal(col.itemTitle, "Studio session");
  assert.equal(col.fileMax, 10);
  assert.equal(messy.rows.length, 9);
  // one of each, read as written — judging them is the preview's work
  const kinds = messy.rows.map((r) => readValue(r.raw, { maxPoints: 10 }).kind);
  assert.equal(kinds.filter((k) => k === "blank").length, 1);
  assert.equal(kinds.filter((k) => k === "bad").length, 2, "abc and -2");
  assert.equal(kinds.filter((k) => k === "value").length, 6);

  const pct = parseScoreFile(read("scores_percentages.csv"));
  assert.equal(pct.rows.length, 3);
  // as percentages of a 10-point column they are 8, 9.5 and 7; as points they are over the maximum
  assert.deepEqual(pct.rows.map((r) => readValue(r.raw, { maxPoints: 10, percentages: true })),
    [{ kind: "value", points: 8, rounded: false },
     { kind: "value", points: 9.5, rounded: false },
     { kind: "value", points: 7, rounded: false }]);
});

t("the sample files really are byte-exact, which is what they exist to test", () => {
  const messy = readFileSync("scripts/fixtures/scores_d2l_messy.csv");
  assert.equal(messy[0], 0xef, "the byte-order mark is gone — check .gitattributes");
  assert.equal(messy[1], 0xbb);
  assert.equal(messy[2], 0xbf);
  assert.ok(messy.toString("utf8").includes("\r\n"), "the CRLF line endings were normalised away");
  const simple = readFileSync("scripts/fixtures/scores_simple.csv").toString("utf8");
  assert.ok(simple.includes("\r\n"), "scores_simple.csv lost its CRLF");
  assert.ok(!simple.startsWith(BOM), "scores_simple.csv is meant to have no BOM");
});

console.log(`\n${passed} checks passed`);
