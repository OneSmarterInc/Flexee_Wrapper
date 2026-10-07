"""Integration test: a section heading's own number, and the title that survives it.

The intake takes a chapter's `###` headings as its sections and strips the heading's number. The
old rule stripped `^\\d+\\.` and no more, so MIS 4950's "### 4.1 Why Scope Comes First" became the
section title "1 Why Scope Comes First" — it took the "4." and left the "1" behind. SAD was
unaffected, because its headings read "### 1. From Requirements to Models", which is why this
survived until a second book used the other form.

The same number is stripped in src/lib/render.ts, where norm() matches a heading to the id the
manifest gave it. If the two disagree the id lands on the wrong heading or on none, so a case here
asserts the two regexes are written the same way.

The last two cases read SAD's and MIS 4950's real packages (read-only) and check the titles the
intake would now produce. They skip with a message when Drive is not available.
"""
import importlib.util, os, re, sys, zipfile
from pathlib import Path

HERE = Path(__file__).parent
REPO = HERE.parent
spec = importlib.util.spec_from_file_location("flexee_intake", REPO / "tools" / "flexee_intake.py")
fi = importlib.util.module_from_spec(spec)
sys.modules["flexee_intake"] = fi
spec.loader.exec_module(fi)

results = []
def case(name, fn):
    try:
        fn(); results.append((name, True)); print("PASS " + name)
    except AssertionError as e:
        results.append((name, False)); print("FAIL " + name); print("     " + str(e)[:500])
    except Exception as e:
        results.append((name, False)); print("FAIL " + name); print(f"     {type(e).__name__}: {str(e)[:500]}")

# ---------------------------------------------------------------- the forms the books use
CASES = [
    # heading,                       expected title
    ("1. Title",                     "Title"),            # SAD
    ("4.1 Title",                    "Title"),            # MIS 4950
    ("12.3. Title",                  "Title"),            # both, with a trailing stop
    ("2024 Trends",                  "2024 Trends"),      # a bare number is not a section number
    ("Title",                        "Title"),            # no number at all
    ("1) Title",                      "Title"),           # the parenthesised form
    ("1.5x Faster Builds",           "1.5x Faster Builds"),  # no space: a measurement, not a number
    ("3.14159 and Other Constants",  "and Other Constants"), # a number and a space: stripped
    ("  7. Spaced  ",                "Spaced"),           # leading and trailing space
    # Three levels is not one of the agreed forms ("N.", "N.M", "N.M."), and a heading that opens
    # with a dotted triple is far more likely to be an address or a version than a section number,
    # so it is left whole rather than half-eaten the way "4.1" used to be.
    ("10.20.30 Addresses",           "10.20.30 Addresses"),
]
for heading, want in CASES:
    def run(h=heading, w=want):
        got = fi.section_title(h)
        assert got == w, f"section_title({h!r}) == {got!r}, expected {w!r}"
    case(f"section_title: {heading!r} -> {want!r}", run)

def not_a_section_number():
    # The old rule's exact failure, named so a regression is obvious.
    assert fi.section_title("4.1 Why Scope Comes First") == "Why Scope Comes First", \
        "the MIS 4950 form must not leave its minor number behind"
    assert fi.section_title("4.1 Why Scope Comes First") != "1 Why Scope Comes First"
case("the MIS 4950 form keeps nothing of its number", not_a_section_number)

# ---------------------------------------------------------------- the two definitions agree
def regexes_agree():
    ts = (REPO / "src" / "lib" / "render.ts").read_text(encoding="utf-8")
    m = re.search(r"const SECTION_NUMBER = /(.+?)/;", ts)
    assert m, "src/lib/render.ts no longer declares SECTION_NUMBER"
    in_ts = m.group(1)
    in_py = fi.SECTION_NUMBER.pattern
    assert in_ts == in_py, f"the two strippers differ:\n  render.ts: {in_ts}\n  intake:    {in_py}"
case("render.ts and the intake strip the same number", regexes_agree)

def render_ts_matches_in_practice():
    """What norm() would do, in Python, to the headings the intake now writes titles for."""
    def norm(s):
        s = s.lower().replace("\u2018", "'").replace("\u2019", "'")
        s = fi.SECTION_NUMBER.sub("", s)
        s = re.sub(r"\s+", " ", s)
        return re.sub(r"[.,:;\u2014\u2013-]+$", "", s).strip()
    for heading in ["1. From Requirements to Models", "4.1 Why Scope Comes First", "12.3. A Third Form"]:
        assert norm(heading) == norm(fi.section_title(heading)), \
            f"a heading and its manifest title must normalize alike: {heading!r}"
case("a heading still matches the title the intake derives from it", render_ts_matches_in_practice)

# ---------------------------------------------------------------- the real books
def headings_of(pkg):
    with zipfile.ZipFile(pkg) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".md") and not n.startswith("__MACOSX")]
        assert len(names) == 1, f"{pkg.name}: expected one markdown file, found {len(names)}"
        text = z.read(names[0]).decode("utf-8")
    return re.findall(r"^### (.+)$", text, re.M)

def real_book(label, root_env, default, want_sample):
    root = os.environ.get(root_env) or default
    if not Path(root).exists():
        print(f"SKIP {label}: set {root_env} to the book's CURRENT folder to check the real packages")
        return
    def run():
        pkgs = sorted(Path(root, "04_Chapters").glob("Chapter_*_Package_*.zip"))
        assert pkgs, f"no chapter packages under {root}/04_Chapters"
        titles = []
        for p in pkgs:
            for h in headings_of(p):
                titles.append((h, fi.section_title(h)))
        assert titles, "no ### headings found"
        # Nothing may keep a leading number-and-space, and nothing may lose its first word.
        for h, t in titles:
            assert t, f"{h!r} produced an empty title"
            assert not re.match(r"^\d+(\.\d+)?\s", t), f"{h!r} still carries its number: {t!r}"
            assert not re.match(r"^\d+\s", t), f"{h!r} kept part of its number: {t!r}"
        found = dict(titles)
        for heading, want in want_sample:
            assert heading in found, f"{heading!r} is not in {label}'s packages any more"
            assert found[heading] == want, f"{heading!r} -> {found[heading]!r}, expected {want!r}"
        print(f"     {label}: {len(titles)} section headings, every title clean of its number")
    case(f"{label}'s real packages produce the right titles", run)

real_book("SAD", "SAD_PACKAGES", r"G:/My Drive/Flexee/Flexee-SAD/FZ1001_v2_CURRENT",
          [("1. From Requirements to Models", "From Requirements to Models")])
real_book("MIS 4950", "MIS4950_PACKAGES_ROOT", r"G:/My Drive/Flexee/FiveZero-4950/MIS4950_v1_CURRENT",
          [("4.1 Why Scope Comes First", "Why Scope Comes First")])

print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
