/**
 * Spec 23: reading a file of scores.
 *
 * No `server-only` and no database: this half is pure, so the preview component can parse the file
 * in the browser and a test can hold the rules without a class. The CSV splitting itself is reused
 * from `@/lib/d2l` — byte-order mark, CRLF or LF, quoted fields containing commas and newlines,
 * `""` for a literal quote — rather than written again here.
 */
import { splitCsv } from "@/lib/d2l";

/** A header, normalised for comparison: lower-case, no spaces, underscores or hyphens. */
const key = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, "");

/** The columns that can identify a student, in the order the spec names them. */
export const ID_HEADERS = ["email", "username"] as const;

/**
 * The score column's candidates, in preference order (decision 5). Faculty can override the choice
 * in the preview, so this only decides which one is offered first.
 */
export const SCORE_HEADERS = ["score", "points", "grade"] as const;

/** Read and never stored, as the class import treats it. */
export const IGNORED_HEADERS = ["orgdefinedid"] as const;

/**
 * A D2L gradebook export names its score column after the item:
 * `Studio session Points Grade <Numeric MaxPoints:10>`. The suffix is the signature (decision 5);
 * the part in front is the item's own title, which is worth showing but is not the column's name.
 */
const D2L_SCORE = /^(.*?)\s*points\s*grade\s*(?:<\s*numeric\s*maxpoints\s*:\s*([\d.]+)\s*>)?$/i;

export type ScoreColumn = {
  index: number;
  header: string;
  /** Why it was offered: the plain name, or a D2L export's own column. */
  via: "named" | "d2l";
  /** The maximum the file itself declares, when it declares one. Never trusted over the column's. */
  fileMax?: number | null;
  /** The item title a D2L header carries in front of its suffix. */
  itemTitle?: string | null;
};

export type Headers = {
  all: string[];
  /** Where the identifier is, and which header it came from. */
  identifier: { index: number; header: string; kind: "email" | "username" } | null;
  /** Every column that could hold a score, best first. */
  scoreColumns: ScoreColumn[];
  ignored: string[];
};

/** What the file's first row offers. */
export function readHeaders(text: string): Headers {
  const rows = splitCsv(text);
  const all = (rows[0] ?? []).map((h) => h.trim());
  let identifier: Headers["identifier"] = null;
  const scoreColumns: ScoreColumn[] = [];
  const ignored: string[] = [];

  all.forEach((h, index) => {
    const k = key(h);
    // Email wins over UserName when a file has both, because it is the one a Wrapper account
    // always has; the matcher still tries the D2L username first on each row.
    if (k === "email" && (identifier == null || identifier.kind !== "email")) {
      identifier = { index, header: h, kind: "email" };
    } else if (k === "username" && identifier == null) {
      identifier = { index, header: h, kind: "username" };
    }
    if ((IGNORED_HEADERS as readonly string[]).includes(k)) ignored.push(h);
  });

  // Offered in the spec's order rather than the file's, so "Score" wins over an earlier "Grade".
  for (const want of SCORE_HEADERS) {
    all.forEach((h, index) => {
      if (key(h) === want) scoreColumns.push({ index, header: h, via: "named" });
    });
  }
  all.forEach((h, index) => {
    const m = D2L_SCORE.exec(h.trim());
    if (!m) return;
    if (scoreColumns.some((c) => c.index === index)) return;
    const max = m[2] ? Number(m[2]) : null;
    scoreColumns.push({
      index, header: h, via: "d2l",
      fileMax: max != null && Number.isFinite(max) ? max : null,
      itemTitle: m[1].trim() || null,
    });
  });

  return { all, identifier, scoreColumns, ignored };
}

export type RawRow = {
  /** 1-based data row, for naming a problem the way the class import does. */
  line: number;
  /** The identifier exactly as the file had it, for naming an unmatched row back to faculty. */
  identifier: string;
  /** The score cell as written, before any reading of it. */
  raw: string;
};

export type ParsedFile = {
  headers: Headers;
  rows: RawRow[];
  /** Data rows read, before anything was dropped. */
  rowCount: number;
  /** What the file cannot be read at all for. */
  fatal: string | null;
};

/**
 * Split the file into identifier-and-value pairs. Nothing is judged here — a blank, a word, a
 * negative number all come through as written, because the preview has to be able to say what was
 * in the file rather than what survived reading it.
 */
export function parseScoreFile(text: string, opts: { scoreIndex?: number } = {}): ParsedFile {
  const headers = readHeaders(text);
  const rows = splitCsv(text);
  const out: ParsedFile = { headers, rows: [], rowCount: Math.max(0, rows.length - 1), fatal: null };

  if (!rows.length) { out.fatal = "That file is empty."; return out; }
  if (!headers.identifier) {
    out.fatal = "No column to identify students by. The file needs a header called Email, UserName or Username.";
    return out;
  }
  const scoreIndex = opts.scoreIndex ?? headers.scoreColumns[0]?.index;
  if (scoreIndex == null) {
    out.fatal = "No column of scores. The file needs a header called Score, Points or Grade.";
    return out;
  }
  if (scoreIndex < 0 || scoreIndex >= headers.all.length) {
    out.fatal = "That is not a column in this file.";
    return out;
  }

  const idIndex = headers.identifier.index;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    out.rows.push({
      line: i,
      identifier: (r[idIndex] ?? "").trim(),
      raw: (r[scoreIndex] ?? "").trim(),
    });
  }
  return out;
}

// ------------------------------------------------------------------------- reading one score cell

export type ValueReading =
  | { kind: "blank" }
  | { kind: "value"; points: number; rounded: boolean }
  | { kind: "bad"; reason: string };

/**
 * One cell's value, under the percentage toggle and the column's maximum.
 *
 * Over-maximum is *not* judged here — whether to keep it is the caller's decision, because faculty
 * can allow bonus marks (decision 2). What is judged is whether the text is a number at all, and
 * whether it is negative.
 */
export function readValue(
  raw: string, opts: { maxPoints: number; percentages?: boolean },
): ValueReading {
  const text = raw.trim();
  if (text === "") return { kind: "blank" };

  // A percentage sign, a trailing "pts", and thousands separators are what a spreadsheet leaves
  // behind; none of them changes what the number is.
  const cleaned = text.replace(/[%\s]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(/pts?$/i, "");
  if (cleaned === "" || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return { kind: "bad", reason: "not a number" };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { kind: "bad", reason: "not a number" };
  if (n < 0) return { kind: "bad", reason: "below zero" };

  const points = opts.percentages ? (n / 100) * opts.maxPoints : n;
  const two = Math.round(points * 100) / 100;
  // Rounded only when the value actually moved — a percentage of a round maximum usually does not.
  return { kind: "value", points: two, rounded: Math.abs(two - points) > 1e-9 };
}
