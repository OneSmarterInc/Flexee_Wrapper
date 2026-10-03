"""Integration test: Spec 16 — the ported table and caption definitions.

The point of this suite is drift. `tools/table_captions.py` is a port of the Books coordinator's
`check_tables.py`, so it must agree with the tool on what a table is and what a caption is. The
tool's own 27 self-test cases are reproduced here and run against the port: if the standard changes,
this fails rather than the two quietly disagreeing.

A parity run against the real tool over the MIS 4950 packages is optional, behind
MIS4950_PACKAGES, and skips with a message when that is unset.
"""
import importlib.util, os, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("table_captions", HERE.parent / "tools" / "table_captions.py")
tc = importlib.util.module_from_spec(spec); spec.loader.exec_module(tc)

results = []
def case(name, fn):
    try:
        fn(); results.append((name, True)); print("PASS " + name)
    except AssertionError as e:
        results.append((name, False)); print("FAIL " + name); print("     " + str(e)[:600])
    except Exception as e:
        results.append((name, False)); print("FAIL " + name); print(f"     {type(e).__name__}: {str(e)[:600]}")

# ---------------------------------------------------------------- the tool's own 27 cases
T = "| Year | Net benefit |\n|---|---|\n| 1 | $180,000 |"
H = "# CHAPTER 3: Test"
D = lambda *b: "\n\n".join(b) + "\n"
TOOL_CASES = [  # name, text, tables expected, should have no problems
    ("two captioned tables", D(H, T, "*Table 3.1. First*", "Text.", T, "*Table 3.2. Second*"), 2, True),
    ("pandoc colon form is accepted", D(H, T, ": Table 3.1. Colon form"), 1, True),
    ("italic and colon forms mixed", D(H, T, "*Table 3.1. One*", T, ": Table 3.2. Two"), 2, True),
    ("lead-in sentence beginning with Table", D(H, "Table 3.1 shows the years:", T, "*Table 3.1. Years*"), 1, True),
    ("empty cell in a body row is allowed", D(H, "| Year | Net benefit |\n|---|---|\n| 1 | |", "*Table 3.1. Gaps*"), 1, True),
    ("empty row inside a table is not a second table", D(H, T + "\n|   |   |", "*Table 3.1. Spacer row*"), 1, True),
    ("escaped pipe in a header cell", D(H, "| Year \\| Period | Net benefit |\n|---|---|\n| 1 | $1 |", "*Table 3.1. Pipe*"), 1, True),
    ("table without outer pipes", D(H, "Year | Net benefit\n---|---\n1 | $1", "*Table 3.1. Bare*"), 1, True),
    ("a row of empty cells is not a separator", D(H, "| Year | Net benefit |\n|   |   |\n| 1 | $180,000 |"), 0, True),
    ("a rule of dashes is not a separator", D(H, "Above", "---", "Below"), 0, True),
    ("pipes in a fenced code block are not a table", D(H, "```\n" + T + "\n```"), 0, True),
    ("pipes in a tilde-fenced block are not a table", D(H, "~~~\n" + T + "\n~~~"), 0, True),
    ("pipes in an indented code block are not a table", D(H, "    " + T.replace("\n", "\n    ")), 0, True),
    ("a caption shown inside a code block is not an orphan", D(H, "```\n*Table 3.1. Example*\n```"), 0, True),
    ("no tables at all", D(H, "Text."), 0, True),
    ("missing caption", D(H, T, "No caption."), 1, False),
    ("caption names the wrong chapter", D(H, T, "*Table 4.1. Wrong*"), 1, False),
    ("caption out of sequence", D(H, T, "*Table 3.2. Skipped one*"), 1, False),
    ("caption with no table", D(H, "Text.", "*Table 3.1. Orphan*"), 0, False),
    ("caption before the table, not after", D(H, "*Table 3.1. Early*", T), 1, False),
    ("no blank line before the caption", H + "\n\n" + T + "\n*Table 3.1. Tight*\n", 1, False),
    ("italic caption missing its period", D(H, T, "*Table 3.1 No period*"), 1, False),
    ("colon caption missing its period", D(H, T, ": Table 3.1 No period"), 1, False),
    ("empty first header cell", D(H, "| | Net benefit |\n|---|---|\n| 1 | $1 |", "*Table 3.1. A*"), 1, False),
    ("empty last header cell", D(H, "| Year | |\n|---|---|\n| 1 | $1 |", "*Table 3.1. B*"), 1, False),
    ("every header cell empty", D(H, "|   |   |\n|---|---|\n| 1 | $1 |", "*Table 3.1. C*"), 1, False),
    ("no chapter heading", T + "\n\n*Table 3.1. Headless*\n", 0, False),
]

def tool_case(name, text, want_tables, want_clean):
    def run():
        tables, problems = tc.scan(text)
        assert len(tables) == want_tables, \
            f"tables: expected {want_tables}, got {len(tables)} ({[t['header'] for t in tables]})"
        clean = not problems
        assert clean == want_clean, \
            f"expected {'no problems' if want_clean else 'a problem'}, got {[p['kind'] for p in problems]}"
    case(f"check_tables case — {name}", run)

for name, text, want_tables, want_clean in TOOL_CASES:
    tool_case(name, text, want_tables, want_clean)

# ---------------------------------------------------------------- the warnings the intake needs

def kinds(text):
    return sorted({p["kind"] for p in tc.scan(text)[1]})

case("a table with no caption warns 'missing'",
     lambda: (lambda k: (_ for _ in ()).throw(AssertionError(k)) if k != ["missing"] else None)(kinds(D(H, T, "Text."))))
case("a 'Table' paragraph that is not a caption warns 'malformed'",
     lambda: (lambda k: (_ for _ in ()).throw(AssertionError(k)) if k != ["malformed"] else None)(kinds(D(H, T, "*Table 3.1 No period*"))))
case("a bold or underscore caption warns 'other_wrapper'",
     lambda: (lambda k: (_ for _ in ()).throw(AssertionError(k)) if k != ["other_wrapper"] else None)(kinds(D(H, T, "**Table 3.1. Bold**"))))

def wrong_chapter():
    ks = kinds(D(H, T, "*Table 4.1. Wrong*"))
    assert ks == ["wrong_number"], ks
case("N that is not the chapter's number warns 'wrong_number'", wrong_chapter)

def out_of_order():
    ks = kinds(D(H, T, "*Table 3.2. Skipped*"))
    assert ks == ["out_of_sequence"], ks
case("M out of order warns 'out_of_sequence'", out_of_order)

def duplicate():
    ks = kinds(D(H, T, "*Table 3.1. One*", T, "*Table 3.1. Again*"))
    assert "out_of_sequence" in ks or "duplicate" in ks, ks
case("a number used twice is caught", duplicate)

def no_heading_once():
    text = D("No heading here", T, "*Table 3.1. One*", T, "*Table 3.2. Two*")
    tables, problems = tc.scan(text)
    assert [p["kind"] for p in problems] == ["no_heading"], [p["kind"] for p in problems]
    assert len(problems) == 1, "one warning for the chapter, not one per table"
    assert tables == [], "nothing is numbered without a chapter heading"
case("no chapter heading warns once for the chapter, not per table", no_heading_once)

def warning_detail():
    _, problems = tc.scan(D(H, T, "Text."))
    p = problems[0]
    assert p["position"] == 1, p
    assert "Year" in p["message"], "the warning names the first words of the header row"
    assert p["line"], "and the line"
case("a warning names the chapter's table, its position and its header", warning_detail)

# ---------------------------------------------------------------- the version gate

def version_gate():
    assert tc.applies("Chapter Writing Standard v1.1") is True
    assert tc.applies("Flexee Book Folder Standard v1.3; Chapter Writing Standard v1.1; Deck Standard v1.3") is True
    assert tc.applies("Chapter Writing Standard v1.0") is False, "v1.0 is earlier than v1.1"
    assert tc.applies("Flexee Book Standard v1.1") is False, "the Chapter Writing Standard is not named"
    assert tc.applies(None) is False
    assert tc.applies("") is False
    # numeric, not lexical: v1.10 and v1.9 are both later than v1.1
    assert tc.applies("Chapter Writing Standard v1.10") is True
    assert tc.applies("Chapter Writing Standard v1.9") is True
    assert tc.standard_version("Chapter Writing Standard v1.10") > tc.standard_version("Chapter Writing Standard v1.9"), \
        "v1.10 must be later than v1.9"
    assert tc.applies("Chapter Writing Standard v2") is True
case("the standard version is compared numerically", version_gate)

def rule7_real_books():
    """The three live books, by the Built to line each register carries today.

    Only MIS 4950 is built to the Chapter Writing Standard at v1.1, so only it gets table warnings.
    These strings are copied from the registers, so if a coordinator changes one the test still
    describes what the Wrapper will do with it.
    """
    books = {
        "MIS 4950": "Flexee Book Folder Standard v1.3; Chapter Writing Standard v1.1; Question Bank Schema v1.1",
        "MIS 3000": "Flexee Book Folder Standard v1.1; Chapter Writing Standard v1.0; Question Bank Schema v1.1",
        "SAD": "Flexee Book Standard v1.1",
    }
    assert tc.applies(books["MIS 4950"]) is True, "MIS 4950 is built to v1.1 and is checked"
    assert tc.applies(books["MIS 3000"]) is False, "MIS 3000 names v1.0, so it is not checked"
    assert tc.applies(books["SAD"]) is False, "SAD does not name the Chapter Writing Standard"
case("rule 7 — only MIS 4950's register asks for table checks", rule7_real_books)

# ---------------------------------------------------------------- parity with the real tool

TOOL = os.environ.get("CHECK_TABLES") or r"G:/My Drive/Flexee/Flexee_Standards/Tools/check_tables.py"
PKGS = os.environ.get("MIS4950_PACKAGES")

def parity():
    pkgs = sorted(Path(PKGS).glob("Chapter_*_Package_*.zip"))
    assert pkgs, f"no chapter packages under {PKGS}"
    import zipfile
    total_t = total_c = 0
    for p in pkgs:
        with zipfile.ZipFile(p) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".md") and not n.startswith("__MACOSX")]
            assert len(names) == 1, f"{p.name}: expected one markdown file, found {len(names)}"
            text = z.read(names[0]).decode("utf-8")
        mine = tc.counts(text)
        r = subprocess.run([sys.executable, TOOL, str(p)], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        m = re.search(r"(\d+) table\(s\), (\d+) correctly captioned", r.stdout)
        assert m, f"{p.name}: could not read the tool's output: {r.stdout[:200]}{r.stderr[:200]}"
        theirs = (int(m.group(1)), int(m.group(2)))
        assert mine[:2] == theirs, f"{p.name}: port says {mine[:2]}, the tool says {theirs}"
        assert (r.returncode == 0) == (not tc.scan(text)[1]), \
            f"{p.name}: exit {r.returncode} but the port found {[x['kind'] for x in tc.scan(text)[1]]}"
        total_t += theirs[0]; total_c += theirs[1]
    print(f"     parity over {len(pkgs)} packages: {total_t} tables, {total_c} captioned — the port agrees with the tool")
    assert total_t == total_c, "every MIS 4950 table should be captioned"

if not PKGS:
    print("SKIP parity with the real check_tables.py — set MIS4950_PACKAGES to the folder holding")
    print("     MIS 4950's Chapter_*_Package_*.zip files to run it, for example:")
    print('       MIS4950_PACKAGES="G:/My Drive/Flexee/FiveZero-4950/MIS4950_v1_CURRENT/04_Chapters" npm run test:tables')
elif not Path(TOOL).exists():
    print(f"SKIP parity — check_tables.py not found at {TOOL}; set CHECK_TABLES to point at it")
else:
    case("parity: the port agrees with the real check_tables.py on MIS 4950", parity)

print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
