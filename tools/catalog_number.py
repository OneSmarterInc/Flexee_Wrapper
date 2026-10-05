"""Spec 22 §3: the register's optional Catalog number, and the id it requires.

Library ids are becoming catalog numbers — ``fz1001`` for SAD, ``fz1003`` for MIS 4950 — because a
course code means nothing outside one university. A book that has been given a catalog number must
be admitted under it, so the check is: if the register names one, the upload id is that number
lower-cased, or the intake stops and says what the id should be.

**The lookup is scoped to the imprint table** (decision 8), not to the first match in the file.
MIS 4950's register carries the row twice: once in the imprint table, and once further down in a
prose row reading ``FZ1003; Wrapper book id `fz1003`. Short title *Managing IT Projects*``. A
first-match-in-file search happens to pick the right one there because of document order, which is
luck rather than design — a register that put its prose row first would feed the whole sentence into
the check. The imprint table is found by content: it is the table that carries the Publisher row.
"""
import re

#: Two letters and four digits, as the Flexee Catalog Standard writes it.
WELL_FORMED = re.compile(r"^[A-Za-z]{2}\d{4}$")

#: A markdown table: consecutive lines beginning with a pipe.
_TABLE = re.compile(r"(?:^\|.*\|[ \t]*$\n?)+", re.M)


def _clean(cell):
    """The Drive text export escapes markdown; the register bolds its values. Strip both."""
    return cell.replace("\\", "").replace("**", "").replace("`", "").strip()


def imprint_table(register_text):
    """The imprint table's own text, found by the Publisher row it carries, or None.

    Content-addressed on purpose. A heading search would depend on the exact wording of a heading
    that each book's register writes slightly differently, and a position search would depend on
    document order, which is the thing decision 8 is about.
    """
    for m in _TABLE.finditer(register_text or ""):
        block = m.group(0)
        if re.search(r"^\|\s*Publisher\s*\|", block, re.M | re.I):
            return block
    return None


def read(register_text):
    """What the register says the catalog number is.

    Returns ``(value, problem)``. ``value`` is the cleaned cell when there is a Catalog number row
    in the imprint table, else None. ``problem`` is a sentence when the row is there but not
    two letters and four digits, else None — a malformed number warns and never stops (§3), because
    the book is fine and it is the register's typing that is wrong.
    """
    table = imprint_table(register_text)
    if table is None:
        return None, None
    m = re.search(r"^\|\s*Catalog(?:ue)? number\s*\|\s*([^|]+?)\s*\|", table, re.M | re.I)
    if not m:
        return None, None
    value = _clean(m.group(1))
    if not value:
        return None, "the register has a Catalog number row with nothing in it"
    if not WELL_FORMED.match(value):
        return None, ("the register's Catalog number is %r, which is not two letters and four "
                      "digits (for example FZ1003); it is ignored" % value)
    return value, None


def check(register_text, book_id):
    """The gate's answer for this upload.

    Returns ``(level, detail, number)`` where level is 'pass', 'warn' or 'stop'.

    * No Catalog number row: pass, and nothing changes — every book admitted before this existed
      behaves exactly as it did.
    * A well-formed number and a matching id: pass, and the number goes into the manifest.
    * A well-formed number and a different id: **stop**, naming the id the book must be admitted
      under. Admitting it under the wrong id would mean renaming it later, which moves every class's
      book_id and every question id with it.
    * A malformed number: warn, and carry on without one.
    """
    number, problem = read(register_text)
    if problem:
        return "warn", problem, None
    if number is None:
        return "pass", "the register names no catalog number", None
    expected = number.lower()
    if book_id != expected:
        return "stop", ("the register's catalog number is %s, so this book must be admitted as "
                        "`%s`, not `%s`" % (number, expected, book_id)), number
    return "pass", "catalog number %s matches the upload id `%s`" % (number, book_id), number
