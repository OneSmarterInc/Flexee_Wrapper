"""Integration test: Spec 15 — book titles from the register.

The register is the only source of a book's title. These run the real intake over a real shelf and
read the manifest it stages, so what is asserted is what a reader would see.
"""
import subprocess, sys, json, shutil, re, tempfile, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "fixtures"))
from make_sad_shelf import build, SAD_PACKAGES_HELP, SRC
TOOL = Path(__file__).parent.parent / "tools" / "flexee_intake.py"
VAL = os.environ.get("VALIDATOR") or str(Path(__file__).parent.parent / "tools" / "build_questions.py")
if not Path(VAL).exists():
    raise SystemExit(f"Validator not found: {VAL}\nSet VALIDATOR to a copy of build_questions.py.")
if not SRC.exists():
    raise SystemExit(f"SAD source folder not found: {SRC}\n\n{SAD_PACKAGES_HELP}")
try:
    import PIL  # noqa: F401
except ModuleNotFoundError:
    raise SystemExit(f"Pillow is not installed for {sys.executable}.\nInstall it with:\n  "
                     f'"{sys.executable}" -m pip install Pillow')

TMP = Path(tempfile.mkdtemp(prefix="flexee_titles_it_"))
results = []
FM_TITLE = "Analysis and Design of Information Systems"   # the H1 of the real SAD front matter


def intake(shelf, out, extra=()):
    """Run the real intake and return (exit code, output)."""
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, str(TOOL), "--book-id", "sad", "--local", str(shelf),
                        "--out", str(out), "--validator", VAL, *extra],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    return r.returncode, r.stdout + r.stderr


def staged_manifest(out):
    """The manifest the intake staged. Read from <out>/_staging/<book>/, which is where the intake
    writes it, rather than by searching: a leftover manifest elsewhere under out/ would mislead."""
    p = Path(out) / "_staging" / "sad" / "book.manifest.json"
    assert p.exists(), f"no staged manifest at {p}"
    return json.loads(p.read_text(encoding="utf-8"))


def with_subtitle_on_page(sub):
    """Put a subtitle on the shelf's own front matter copy, as a real title page would carry it.
    The shelf is a temp build; nothing in Drive or in the repository is touched."""
    def mutate(root):
        fm = next((root / "00_Front_Matter").glob("Book_Front_Matter_v*.md"))
        lines = fm.read_text(encoding="utf-8").splitlines()
        lines.insert(1, "")
        lines.insert(2, "## " + sub)          # under the title's H1, where a subtitle sits
        fm.write_text("\n".join(lines), encoding="utf-8")
    return mutate


def case(name, fn):
    try:
        fn()
        results.append((name, True)); print("PASS " + name)
    except AssertionError as e:
        results.append((name, False)); print("FAIL " + name); print("     " + str(e)[:900])
    except Exception as e:                                     # a crash is a failure, not an error
        results.append((name, False)); print("FAIL " + name); print(f"     {type(e).__name__}: {str(e)[:900]}")


def run(label, imprint_rows=None, layout="artifact-version", escaped=False, mutate=None, extra=()):
    shelf = TMP / "shelf" / re.sub(r"\W+", "_", label)
    out = TMP / "out" / re.sub(r"\W+", "_", label)
    shutil.rmtree(shelf, ignore_errors=True); shutil.rmtree(out, ignore_errors=True)
    b = build(shelf, layout=layout, escaped=escaped, imprint_rows=imprint_rows)
    if mutate: mutate(b)
    code, txt = intake(b, out, extra)
    return code, txt, out


# ---------------------------------------------------------------- rule 1

def rule1():
    code, txt, out = run("rows produce a manifest", imprint_rows={
        "Title": "Analysis and Design of Information Systems",
        "Subtitle": "A Practical Course",
        "Series": "Five Zero Books"}, mutate=with_subtitle_on_page("A Practical Course"))
    assert code == 0, f"intake stopped:\n{txt[-1200:]}"
    bm = staged_manifest(out)
    assert bm["title"] == "Analysis and Design of Information Systems", bm
    assert bm["subtitle"] == "A Practical Course", bm
    assert bm["series"] == "Five Zero Books", bm
    assert bm["id"] == "sad", bm
    assert "Title recorded in the register" in txt
case("rule 1 — Title, Subtitle and Series rows become exactly those manifest values", rule1)


# ---------------------------------------------------------------- rule 2

def rule2():
    """A previous manifest at the output path must not survive the register."""
    out = TMP / "out" / "replaces_previous"
    shutil.rmtree(out, ignore_errors=True)
    (out / "sad").mkdir(parents=True)
    (out / "sad" / "book.manifest.json").write_text(json.dumps({
        "schemaVersion": 2, "id": "sad", "title": "A STALE TITLE FROM A PREVIOUS INTAKE",
        "subtitle": "stale subtitle", "spine": []}), encoding="utf-8")

    shelf = TMP / "shelf" / "replaces_previous"
    shutil.rmtree(shelf, ignore_errors=True)
    b = build(shelf, imprint_rows={"Title": FM_TITLE, "Series": "Five Zero Books"})
    code, txt = intake(b, out)
    assert code == 0, f"intake stopped:\n{txt[-1200:]}"
    bm = staged_manifest(out)
    assert bm["title"] == FM_TITLE, f"the stale title survived: {bm['title']}"
    assert bm["subtitle"] is None, f"the stale subtitle survived: {bm['subtitle']}"
    # the planted manifest is still where it was; the intake simply no longer reads it
    planted = json.loads((out / "sad" / "book.manifest.json").read_text(encoding="utf-8"))
    assert planted["title"] == "A STALE TITLE FROM A PREVIOUS INTAKE"
case("rule 2 — the register's Title replaces a previous manifest's title", rule2)


# ---------------------------------------------------------------- rule 3

def rule3():
    code, txt, out = run("no title row")                       # no imprint_rows at all
    assert code == 0, f"a missing Title must not stop the intake:\n{txt[-1200:]}"
    assert "no Title row" in txt, txt[-900:]
    assert "the book will show its id" in txt
    bm = staged_manifest(out)
    assert bm["title"] == "SAD", bm
    assert bm["subtitle"] is None, bm
    assert bm["series"] is None, bm
    # and it is a warning, not a stop
    assert "STOPPED" not in txt, txt[-900:]
case("rule 3 — no Title row warns, falls back to the id, and never stops", rule3)


# ---------------------------------------------------------------- rule 4

def rule4_stops():
    code, txt, out = run("title not on the page",
                         imprint_rows={"Title": "A Title The Front Matter Does Not Carry"})
    assert code != 0, "a title absent from the title page must stop the intake"
    assert "is not on the title page" in txt, txt[-900:]
    assert "STOPPED" in txt
case("rule 4 — a Title absent from the title page stops the intake", rule4_stops)


def rule4_folds():
    """The same title, written differently: emphasis, case and spacing must not matter."""
    for label, title in [
        ("different case", "ANALYSIS and DESIGN of INFORMATION SYSTEMS"),
        ("extra spacing", "Analysis  and   Design of Information Systems"),
        ("emphasis marks", "_Analysis and Design of Information Systems_"),
    ]:
        code, txt, out = run(f"folded {label}", imprint_rows={"Title": title})
        assert code == 0, f"{label} should pass:\n{txt[-1000:]}"
        assert staged_manifest(out)["title"] == title, "the register's own wording is kept verbatim"
case("rule 4 — the same title with different case, spacing or emphasis passes", rule4_folds)


def rule4_subtitle_checked():
    """A Subtitle is checked too, and the real front matter carries no subtitle."""
    code, txt, out = run("subtitle not on page",
                         imprint_rows={"Title": FM_TITLE, "Subtitle": "A Subtitle Not On The Page"})
    assert code != 0, "a subtitle absent from the title page must stop the intake"
    assert "Subtitle" in txt and "is not on the title page" in txt, txt[-900:]
case("rule 4 — a Subtitle absent from the title page also stops", rule4_subtitle_checked)


# ---------------------------------------------------------------- rule 5

def rule5():
    code, txt, out = run("no subtitle", imprint_rows={"Title": FM_TITLE, "Series": "Five Zero Books"})
    assert code == 0, txt[-1200:]
    bm = staged_manifest(out)
    assert bm["title"] == FM_TITLE, bm
    assert bm["subtitle"] is None, f"expected no subtitle, got {bm['subtitle']!r}"
    assert bm["series"] == "Five Zero Books", bm
case("rule 5 — Subtitle is optional and absent means null", rule5)


# ---------------------------------------------------------------- rule 7

def rule7():
    """Both artifact-table layouts and the Drive-escaped form read the rows."""
    rows = {"Title": FM_TITLE, "Subtitle": None, "Series": "Five Zero Books"}
    rows = {k: v for k, v in rows.items() if v}

    # the Lane | File | Bytes | Status layout already carries Title and Series of its own
    code, txt, out = run("file-bytes layout", layout="file-bytes")
    assert code == 0, txt[-1200:]
    bm = staged_manifest(out)
    assert bm["title"] == FM_TITLE, bm
    assert bm["series"] == "Five Zero Books", bm

    # the artifact-version layout, with rows given
    code, txt, out = run("artifact-version layout", imprint_rows=rows)
    assert code == 0, txt[-1200:]
    assert staged_manifest(out)["title"] == FM_TITLE

    # the form Drive's text export produces, where every markdown mark is backslash-escaped
    code, txt, out = run("drive escaped", imprint_rows=rows, escaped=True)
    assert code == 0, txt[-1200:]
    bm = staged_manifest(out)
    assert bm["title"] == FM_TITLE, f"the escaped register's title did not read: {bm['title']!r}"
    assert bm["series"] == "Five Zero Books", bm
case("rule 7 — both layouts and the Drive-escaped form read the rows", rule7)


# ---------------------------------------------------------------- the fold itself

def fold_unit():
    import importlib.util
    spec = importlib.util.spec_from_file_location("fi", TOOL)
    m = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = ["flexee_intake.py"]
    try: spec.loader.exec_module(m)
    finally: sys.argv = argv
    fold = m.fold
    same = fold("Technology and the Organization")
    for variant in ["**Technology and the Organization**", "_Technology and the Organization_",
                    "TECHNOLOGY AND THE ORGANIZATION", "Technology  and the\tOrganization",
                    "\\*\\*Technology and the Organization\\*\\*", "  Technology and the Organization  "]:
        assert fold(variant) == same, f"{variant!r} folded to {fold(variant)!r}"
    # curly quotes fold to straight
    assert fold("‘Smart’ Systems") == fold("'Smart' Systems")
    assert fold("“Smart” Systems") == fold('"Smart" Systems')
    # and it does not fold away a real difference
    assert fold("Technology and the Organization") != fold("Technology and Organizations")
    assert fold("Managing IT Projects") != fold("Managing IT Project")
    assert fold(None) == "" and fold("") == ""
case("fold() ignores case, spacing, emphasis and curly quotes, and nothing else", fold_unit)


print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
