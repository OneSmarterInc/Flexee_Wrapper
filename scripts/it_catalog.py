#!/usr/bin/env python3
"""Spec 22 §3 and rule 3 — the register's Catalog number, on the intake's side.

The three real registers are read read-only from Drive, because the point of decision 8 is a thing
only a real register has: MIS 4950's carries the Catalog number row twice, once in the imprint table
and once further down in prose. A synthetic fixture would not catch a first-match-in-file lookup.
"""
import io, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import catalog_number as cn

passed = 0
def t(name):
    def deco(fn):
        global passed
        try:
            fn(); passed += 1; print("  \u2713", name)
        except Exception:
            print("  \u2717", name); raise
    return deco

REGISTERS = {
    "fz1003": r"G:\My Drive\Flexee\FiveZero-4950\FZ1003_v1_CURRENT\STATE_OF_RECORD.md",
    "sad": r"G:\My Drive\Flexee\Flexee-SAD\FZ1001_v2_CURRENT\STATE_OF_RECORD.md",
    "mis3000": r"G:\My Drive\Flexee\Flexee-3000\MIS3000_v1_CURRENT\STATE_OF_RECORD.md",
}
HAVE = {k: io.open(v, encoding="utf-8").read() for k, v in REGISTERS.items() if os.path.exists(v)}
missing = [k for k in REGISTERS if k not in HAVE]
if missing:
    print("SKIP the real registers for %s — set them under G:\\My Drive\\Flexee" % ", ".join(missing))
print("\n%d real registers read, read-only" % len(HAVE))


@t("the well-formed shape is two letters and four digits, and nothing else")
def _():
    for good in ("FZ1003", "fz1003", "Fz1003", "AB0001"):
        assert cn.WELL_FORMED.match(good), good
    for bad in ("FZ103", "FZ10033", "F1003", "FZZ1003", "FZ-1003", "1003FZ", "", "FZ 1003"):
        assert not cn.WELL_FORMED.match(bad), bad


@t("the imprint table is found by the Publisher row, not by position or heading")
def _():
    text = """# A book

### Some other table first

| | |
|---|---|
| Catalog number | NOT-THE-ONE; prose about something |

### The imprint

| | |
|---|---|
| Publisher | **Flexee Publishing** |
| Catalog number | **FZ9001** |
"""
    # A first-match-in-file lookup would read the prose row above. Scoping to the table that
    # carries Publisher reads the right one whatever the order.
    assert cn.read(text) == ("FZ9001", None), cn.read(text)
    assert "Publisher" in (cn.imprint_table(text) or "")
    assert "NOT-THE-ONE" not in (cn.imprint_table(text) or "")


@t("a register with no imprint table, or no row, reports no number and no problem")
def _():
    assert cn.read("# A book\n\nNo tables at all.\n") == (None, None)
    assert cn.read("| | |\n|---|---|\n| Publisher | X |\n") == (None, None)
    assert cn.imprint_table("| | |\n|---|---|\n| Title | X |\n") is None


@t("a malformed number warns and is ignored; it never stops")
def _():
    for value, inside in (("FZ103", "FZ103"), ("FiveZero 1003", "FiveZero 1003"), ("", "nothing in it")):
        text = "| | |\n|---|---|\n| Publisher | X |\n| Catalog number | %s |\n" % value
        number, problem = cn.read(text)
        assert number is None, (value, number)
        assert problem and inside in problem, (value, problem)
        level, detail, got = cn.check(text, "anything")
        assert level == "warn", (value, level)
        assert got is None


@t("MIS 4950's real register: the imprint row wins over its own prose row")
def _():
    if "fz1003" not in HAVE:
        print("      (skipped — register not present)"); return
    text = HAVE["fz1003"]
    # The register really does carry the row twice.
    rows = [l for l in text.split("\n") if l.lower().lstrip().startswith("| catalog number")]
    assert len(rows) >= 2, "expected the prose row as well; found %d row(s)" % len(rows)
    assert any("Wrapper book id" in r for r in rows), rows
    number, problem = cn.read(text)
    assert (number, problem) == ("FZ1003", None), (number, problem)
    print("      %d Catalog number rows in the register; read %r" % (len(rows), number))


@t("a matching upload id passes, and the number is handed back for the manifest")
def _():
    if "fz1003" not in HAVE:
        print("      (skipped)"); return
    level, detail, number = cn.check(HAVE["fz1003"], "fz1003")
    assert level == "pass", (level, detail)
    assert number == "FZ1003"
    assert "matches the upload id" in detail, detail


@t("a mismatch stops, and names the id the book must be admitted under")
def _():
    if "fz1003" not in HAVE:
        print("      (skipped)"); return
    for wrong in ("mis4950", "fz1001", "sad"):
        level, detail, number = cn.check(HAVE["fz1003"], wrong)
        assert level == "stop", (wrong, level)
        assert "`fz1003`" in detail and "FZ1003" in detail, detail
        assert "`%s`" % wrong in detail, detail
        # the number is still returned, so a report can name it
        assert number == "FZ1003"


@t("a register with no catalog row behaves exactly as before")
def _():
    # MIS 3000 is the only one left without the row. SAD gained it on 7 October — register v6.21
    # re-keyed the book to its catalog number — which is why it has moved to the check below.
    book = "mis3000"
    if book not in HAVE:
        print("      (skipped %s)" % book); return
    level, detail, number = cn.check(HAVE[book], book)
    assert level == "pass", (book, level, detail)
    assert number is None
    assert detail == "the register names no catalog number", detail
    # and an id that is not the book's own is equally fine, because nothing requires one
    assert cn.check(HAVE[book], "whatever")[0] == "pass"


@t("SAD's re-keyed register demands fz1001, which is the gate doing its job")
def _():
    # Added 7 October, when SAD's register gained | Catalog number | **FZ1001** | and its question
    # bank was re-keyed from sad to fz1001. A second real register with the row, so the gate is
    # pinned against two books rather than one — and the stop is the thing that would have caught
    # an upload under the old id.
    if "sad" not in HAVE:
        print("      (skipped — SAD's register not present)"); return
    number, problem = cn.read(HAVE["sad"])
    assert (number, problem) == ("FZ1001", None), (number, problem)

    level, detail, got = cn.check(HAVE["sad"], "fz1001")
    assert level == "pass", (level, detail)
    assert got == "FZ1001"

    level, detail, got = cn.check(HAVE["sad"], "sad")
    assert level == "stop", (level, detail)
    assert "`fz1001`" in detail and "`sad`" in detail, detail
    print("      SAD now reads %r; an upload as `sad` stops" % number)


@t("a catalogue-spelled row is read too, since the gate's own word list calls it British")
def _():
    text = "| | |\n|---|---|\n| Publisher | X |\n| Catalogue number | **FZ1002** |\n"
    assert cn.read(text) == ("FZ1002", None), cn.read(text)


print("\n%d checks passed" % passed)
