"""Table captions, as the Chapter Writing Standard v1.1 defines them.

A port of `Flexee_Standards/Tools/check_tables.py`, which the Books coordinator owns. Ported rather
than shelled out to because the intake already holds each chapter's markdown in memory, and because
it needs the findings as separate warnings rather than as a printed report and an exit code.

Ported, not pinned, means the definitions can drift from the tool. Two things guard against that:
`scripts/it_tables.py` runs the tool's own 27 self-test cases against this copy, so a change to the
standard makes this copy fail its own tests; and an optional parity run checks this copy's counts
against the real tool over the MIS 4950 packages.

A table is a markdown pipe table: a header row, then a separator of at least three dashes per
column. A row of empty cells is not a separator, and pipes inside a code block are not a table.

A caption is the paragraph one blank line after the table, in one of exactly two forms:

    *Table N.M. Title*        the recommended italic form
    : Table N.M. Title        pandoc's colon form

where N is the chapter number and M runs 1, 2, 3 in order of appearance. A bold or underscore
wrapper is not a caption.
"""
import re

ITALIC = re.compile(r"^\*Table (\d+)\.(\d+)\. (\S.*?)\*$")
COLON = re.compile(r"^: Table (\d+)\.(\d+)\. (\S.*)$")
SEPARATOR = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
MALFORMED_ITALIC = re.compile(r"^\*Table\b")
MALFORMED_COLON = re.compile(r"^:\s*Table\b")
# a wrapper the standard does not accept, so the paragraph is text and worth saying so
OTHER_WRAPPER = re.compile(r"^(?:\*\*|_)Table (\d+)\.(\d+)\.")


def fenced(lines):
    """Indexes of lines inside, or on, a ``` or ~~~ fence."""
    inside, fence = set(), None
    for n, line in enumerate(lines):
        s = line.strip()
        if fence is None and (s.startswith("```") or s.startswith("~~~")):
            fence = s[:3]; inside.add(n)
        elif fence is not None:
            inside.add(n)
            if s.startswith(fence):
                fence = None
    return inside


def caption_at(lines, k):
    if k >= len(lines):
        return None
    return ITALIC.match(lines[k]) or COLON.match(lines[k])


def chapter_number(lines):
    m = next((re.match(r"^# CHAPTER (\d+):", l) for l in lines if l.startswith("# CHAPTER")), None)
    return int(m.group(1)) if m else None


def scan(text):
    """Every table in the text, and what is wrong with its caption.

    Returns (tables, problems) where `tables` is a list of dicts — position (1-based, in order of
    appearance), line, header (the first words of the header row), number (N.M, when captioned
    correctly), colon_form — and `problems` is a list of {kind, line, position, message}.

    `kind` is one of: no_heading, missing, malformed, wrong_number, out_of_sequence, duplicate,
    orphan, empty_header, other_wrapper. The intake turns these into warnings; nothing here stops.
    """
    lines = text.split("\n")
    problems, tables, claimed = [], [], set()
    seen_numbers = {}
    chapter = chapter_number(lines)
    if chapter is None:
        # one warning for the chapter, not one per table (Spec 16 decision 5)
        return [], [{"kind": "no_heading", "line": None, "position": None,
                     "message": "cannot check captions: no '# CHAPTER N: Title' heading"}]
    code = fenced(lines)

    i = 0
    while i < len(lines):
        line = lines[i]
        if (i in code or "|" not in line or re.match(r"^( {4,}|\t)", line) or i + 1 >= len(lines)
                or not (SEPARATOR.match(lines[i + 1]) and "|" in lines[i + 1])):
            i += 1
            continue
        position = len(tables) + 1
        start = i + 1                                    # 1-based line of the header row
        cells = re.split(r"(?<!\\)\|", re.sub(r"^\s*\||\|\s*$", "", line))
        header = " | ".join(c.strip() for c in cells if c.strip())[:60]
        blank = [n + 1 for n, c in enumerate(cells) if not c.strip()]
        if blank:
            problems.append({"kind": "empty_header", "line": start, "position": position,
                             "message": f"table {position} ({header}) has an empty header cell in column "
                                        f"{', '.join(map(str, blank))}"})
        j = i + 2
        while j < len(lines) and "|" in lines[j] and lines[j].strip():
            j += 1
        entry = {"position": position, "line": start, "header": header, "number": None, "colon_form": False}
        want = f"{chapter}.{position}"
        cap = caption_at(lines, j + 1) if j < len(lines) and lines[j] == "" else None
        after = lines[j + 1] if j + 1 < len(lines) and j < len(lines) and lines[j] == "" else ""
        if cap:
            claimed.add(j + 1)
            n, k = int(cap.group(1)), int(cap.group(2))
            num = f"{n}.{k}"
            entry["colon_form"] = bool(COLON.match(lines[j + 1]))
            if n != chapter:
                problems.append({"kind": "wrong_number", "line": j + 2, "position": position,
                                 "message": f"table {position} ({header}) is captioned Table {num}; "
                                            f"chapter {chapter} must use Table {want}"})
            elif k != position:
                problems.append({"kind": "out_of_sequence", "line": j + 2, "position": position,
                                 "message": f"table {position} ({header}) is captioned Table {num}; "
                                            f"numbers must run in order, so this must be Table {want}"})
            elif num in seen_numbers:
                problems.append({"kind": "duplicate", "line": j + 2, "position": position,
                                 "message": f"table {position} ({header}) reuses Table {num}, "
                                            f"already used by table {seen_numbers[num]}"})
            else:
                entry["number"] = num
                seen_numbers[num] = position
        else:
            if after.strip().startswith("Table") or MALFORMED_ITALIC.match(after) or MALFORMED_COLON.match(after):
                problems.append({"kind": "malformed", "line": j + 2, "position": position,
                                 "message": f"table {position} ({header}) is followed by a paragraph beginning "
                                            f"\"Table\" that is not a caption; write *Table {want}. Title* "
                                            f"or : Table {want}. Title"})
                claimed.add(j + 1)
            elif OTHER_WRAPPER.match(after.strip()):
                problems.append({"kind": "other_wrapper", "line": j + 2, "position": position,
                                 "message": f"table {position} ({header}) is followed by a bold or underscore "
                                            f"caption; only *Table {want}. Title* and : Table {want}. Title "
                                            f"are captions"})
                claimed.add(j + 1)
            else:
                problems.append({"kind": "missing", "line": start, "position": position,
                                 "message": f"table {position} ({header}) has no caption directly after it; "
                                            f"expected *Table {want}. Title* after one blank line"})
        tables.append(entry)
        i = j

    for idx, line in enumerate(lines):
        if idx in claimed or idx in code:
            continue
        if ITALIC.match(line) or COLON.match(line):
            problems.append({"kind": "orphan", "line": idx + 1, "position": None,
                             "message": "a caption with no table directly before it"})
    return tables, problems


def counts(text):
    """(tables, captioned, colon_form) — the same three numbers check_tables.py prints."""
    tables, _ = scan(text)
    return (len(tables), sum(1 for t in tables if t["number"]),
            sum(1 for t in tables if t["colon_form"]))


def standard_version(built_to):
    """The Chapter Writing Standard version a register's `Built to` line names, as a tuple."""
    m = re.search(r"Chapter Writing Standard v(\d+(?:\.\d+)*)", built_to or "")
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def applies(built_to, minimum=(1, 1)):
    """True when the book is built to the Chapter Writing Standard at `minimum` or later.

    Compared numerically, so v1.10 is later than v1.9 and v1.0 is earlier than v1.1.
    """
    v = standard_version(built_to)
    return v is not None and v >= minimum
