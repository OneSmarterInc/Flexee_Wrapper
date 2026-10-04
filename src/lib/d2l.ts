/**
 * Reading a D2L (Brightspace) class list (Spec 17 §2).
 *
 * Pure: no database, no `server-only`. The faculty import component parses the file in the
 * browser and sends the rows it derived, so the file itself is never uploaded, and the same code
 * is what the tests hammer.
 *
 * The real export has five columns — Name (quoted, "Last, First"), UserName, OrgDefinedId, Role,
 * LastAccessed — and **no email column**. Every Wright State address is the UserName plus the
 * institution's domain, which is a setting rather than a constant because the next institution's
 * will differ.
 */

export const DEFAULT_EMAIL_DOMAIN = "wright.edu";

/** The four columns we read. LastAccessed and anything else is ignored. */
const COLUMNS = ["name", "username", "orgdefinedid", "role"] as const;
type Column = (typeof COLUMNS)[number];
const REQUIRED: Column[] = ["name", "username", "role"];

/**
 * D2L ships every class with a built-in "Demo Student" so faculty can see what students see.
 * Spec 17 skipped it, because only the exact role "Student" counted. It is a student here, and
 * flagged: never emailed, never in a class statistic, still in the grade export.
 */
const DEMO_ROLE = "demo student";

export type ParsedRow = {
  line: number;          // 1-based data row, for naming a problem in the preview
  name: string;          // "First Last", or the name as written when it has no comma
  rawName: string;       // as the file had it
  userName: string;      // lower-cased
  orgDefinedId: string;  // read and shown as ignored — never stored
  role: string;          // as written, so the preview can say which role was skipped
  email: string;
  demo: boolean;         // D2L's built-in "Demo Student": a student, flagged, never emailed
  note?: string;         // something about this row faculty should see
};

export type Problem = { line: number; reason: string; detail?: string };

export type ClassList = {
  headers: string[];
  missing: string[];        // required headers the file does not have
  students: ParsedRow[];    // role "Student" or "Demo Student", usable
  others: ParsedRow[];      // another role: listed with it, and ignored
  problems: Problem[];
  rowCount: number;         // data rows read, before anything was dropped
};

/**
 * Split CSV text into cells. Handles the byte-order mark, CRLF or LF, quoted fields containing
 * commas and newlines, and "" for a literal quote. Wholly blank lines are dropped.
 */
export function splitCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false; // this row has at least one cell
  const endCell = () => { row.push(cell); cell = ""; started = true; };
  const endRow = () => {
    if (started) { row.push(cell); cell = ""; }
    if (row.length && row.some((c) => c.trim() !== "")) rows.push(row);
    row = []; started = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; started = true; continue; }
    if (c === ",") { endCell(); continue; }
    if (c === "\r") { if (s[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    cell += c; started = true;
  }
  endRow();
  return rows;
}

/** "Last, First" becomes "First Last". A name with no comma is used as it is. */
export function personName(raw: string): string {
  const n = raw.trim().replace(/\s+/g, " ");
  const comma = n.indexOf(",");
  if (comma < 0) return n;
  const last = n.slice(0, comma).trim();
  const first = n.slice(comma + 1).trim();
  if (!first) return last;
  if (!last) return first;
  return `${first} ${last}`;
}

/** A UserName that is already an address is used as it is; otherwise the domain is appended. */
export function emailFor(userName: string, domain = DEFAULT_EMAIL_DOMAIN): string {
  const u = userName.trim().toLowerCase();
  if (!u) return "";
  if (u.includes("@")) return u;
  return `${u}@${domain.trim().toLowerCase().replace(/^@/, "")}`;
}

const key = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, "");

export function parseClassList(text: string, opts: { domain?: string } = {}): ClassList {
  const domain = opts.domain?.trim() || DEFAULT_EMAIL_DOMAIN;
  const rows = splitCsv(text);
  if (!rows.length) {
    return { headers: [], missing: [...REQUIRED], students: [], others: [], problems: [], rowCount: 0 };
  }
  const headers = rows[0].map((h) => h.trim());
  const at: Partial<Record<Column, number>> = {};
  headers.forEach((h, i) => {
    const k = key(h) as Column;
    if ((COLUMNS as readonly string[]).includes(k) && at[k] === undefined) at[k] = i;
  });
  const missing = REQUIRED.filter((c) => at[c] === undefined);
  const out: ClassList = { headers, missing, students: [], others: [], problems: [], rowCount: rows.length - 1 };
  if (missing.length) return out;

  const cell = (r: string[], c: Column) => {
    const i = at[c];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };
  const seen = new Map<string, number>(); // lower-cased username -> the line that first had it

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i;
    const rawName = cell(r, "name");
    const userName = cell(r, "username").toLowerCase();
    const role = cell(r, "role");
    const orgDefinedId = cell(r, "orgdefinedid");

    if (!userName) {
      out.problems.push({ line, reason: "blank username", detail: personName(rawName) || undefined });
      continue;
    }
    const first = seen.get(userName);
    if (first !== undefined) {
      out.problems.push({ line, reason: "duplicate username", detail: `same as row ${first}` });
      continue;
    }
    seen.set(userName, line);
    const name = personName(rawName);
    if (!name) out.problems.push({ line, reason: "unreadable name", detail: userName });

    const roleKey = role.trim().toLowerCase();
    const row: ParsedRow = {
      line, name: name || userName, rawName, userName, orgDefinedId, role,
      email: emailFor(userName, domain),
      demo: roleKey === DEMO_ROLE,
      ...(userName.includes("@") ? { note: "UserName is already an address — used as the email, with no domain added" } : {}),
    };
    if (roleKey === "student" || roleKey === DEMO_ROLE) out.students.push(row);
    else out.others.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- the confirm step (Spec 18 §2)
//
// The wording and the enabling live here, with the parser, because they are decisions rather than
// markup: the first live import offered a dark "Create accounts and email invitations" button for
// a file whose only importable row was D2L's demo student. These are pure, so a test can hold them
// to it, and this module carries no `server-only` so the faculty component can use them too.

export type ImportPlanCounts = { willCreate: number; toEnrol: number };

/** Nothing would be written, so there is nothing to confirm. */
export const nothingToWrite = (c: ImportPlanCounts) => c.willCreate === 0 && c.toEnrol === 0;

/** What the confirm button says. It names what it will do, and never mentions email. */
export function confirmLabel(c: ImportPlanCounts) {
  if (nothingToWrite(c)) return "Nothing to create";
  const parts = [];
  if (c.willCreate) parts.push(`Create ${c.willCreate} account${c.willCreate === 1 ? "" : "s"}`);
  if (c.toEnrol) parts.push(`enrol ${c.toEnrol}`);
  return parts.join(" and ");
}

/** What the second step says before anyone presses it: how many, and where. */
export function emailSentence(count: number, domain: string) {
  if (count === 0) return "Nobody is waiting for an invitation.";
  return `This will email ${count} student${count === 1 ? "" : "s"} at ${domain}.`;
}
