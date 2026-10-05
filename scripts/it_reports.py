#!/usr/bin/env python3
"""Spec 22 §4 and rules 5 and 6 — the intake report's rough edges.

The nested-folder case is run against a real shelf rather than a toy one, because the bug is in how
`list_lane` keys a recursive listing and a fixture with one invented lane would not exercise it. The
shelf is copied to a temp tree first; nothing on Drive is written.
"""
import io, os, re, shutil, subprocess, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import flexee_intake as fi

passed = 0
def t(name):
    def deco(fn):
        global passed
        try:
            fn(); passed += 1; print("  \u2713", name)
        except Exception:
            print("  \u2717", name); raise
    return deco


# ---------------------------------------------------------------- the pure parts

@t("a short list of warnings is shown in full")
def _():
    assert fi.summarise_detail(["ch1: a", "ch2: b"]) == "ch1: a; ch2: b"
    assert fi.summarise_detail([]) == ""
    assert fi.summarise_detail("a plain string") == "a plain string"
    assert fi.summarise_detail(["one line"]) == "one line"


@t("repeated categories are collapsed to a count and the first few")
def _():
    got = fi.summarise_detail(["ch1: a", "ch1: b", "ch1: c", "ch1: d", "ch2: e", "ch2: f", "ch3: g"])
    assert "4 in ch1" in got, got
    assert "and 1 more" in got, got
    assert "2 in ch2" in got, got
    assert "ch3: g" in got, got           # a category with one line is not dressed up as a group
    # the collapsed form is shorter than the full one, which is the whole point
    assert len(got) < len("; ".join(["ch1: a", "ch1: b", "ch1: c", "ch1: d", "ch2: e", "ch2: f", "ch3: g"])) + 40


@t("a long list of distinct categories is not collapsed into nonsense")
def _():
    lines = ["ch%d: only one here" % i for i in range(1, 9)]
    got = fi.summarise_detail(lines)
    for l in lines:
        assert l in got, l
    assert " in ch" not in got, got


@t("every report ends with what happens next")
def _():
    stopped = fi.next_step({"stop": True, "gates": []})
    assert stopped.startswith("**Stopped:"), stopped
    assert "upload again" in stopped and "Nothing was admitted" in stopped

    clean = fi.next_step({"stop": False, "gates": [{"gate": "X", "ok": True}]})
    assert clean == "**Ready to add: click Add to library.**", clean

    warned = fi.next_step({"stop": False, "gates": [
        {"gate": "Figure alt text", "ok": False}, {"gate": "Table header cells", "ok": False}]})
    assert "Ready to add" in warned, warned
    assert "2 warnings" in warned and "none of which blocks the book" in warned, warned
    assert "Figure alt text, Table header cells" in warned, warned


# ---------------------------------------------------------------- the nested folder, for real

SHELF = os.environ.get("SAD_PACKAGES") or r"G:\My Drive\Flexee\Flexee-SAD\MIS3250_v2_CURRENT"
if not os.path.isdir(os.path.join(SHELF, "00_Front_Matter")):
    print("\nSKIP the nested-folder checks — set SAD_PACKAGES to a shelf with the real lanes, e.g.")
    print('       SAD_PACKAGES="G:/My Drive/Flexee/Flexee-SAD/MIS3250_v2_CURRENT" npm run test:reports')
    print("\n%d checks passed" % passed)
    raise SystemExit(0)

tmp = tempfile.mkdtemp(prefix="s22-reports-")
fixture = os.path.join(tmp, "shelf")
shutil.copytree(SHELF, fixture)
# What Drive for Desktop does: a folder inside the lane, with the lane's name, holding a copy.
for lane, how_many in (("00_Front_Matter", 1), ("04_Chapters", None)):
    d = os.path.join(fixture, lane)
    nested = os.path.join(d, lane)
    os.makedirs(nested, exist_ok=True)
    files = [f for f in sorted(os.listdir(d)) if os.path.isfile(os.path.join(d, f))]
    for f in (files[:how_many] if how_many else files):
        shutil.copy2(os.path.join(d, f), os.path.join(nested, f))

out = os.path.join(tmp, "out")
report = subprocess.run(
    [sys.executable, "tools/flexee_intake.py", "--book-id", "sad", "--local", fixture,
     "--out", out, "--validator", "tools/build_questions.py"],
    capture_output=True, text=True, encoding="utf-8", errors="replace",
    env={**os.environ, "PYTHONIOENCODING": "utf-8"}).stdout
row = next((l for l in report.split("\n") if l.startswith("| Register ↔ Drive")), "")
print("\nthe nested-folder fixture's gate row:\n   %s" % row[:200])


@t("a duplicated lane folder is one message naming the folder and the lane")
def _():
    assert "a folder named `00_Front_Matter` sits inside the lane `00_Front_Matter`" in row, row
    assert "a folder named `04_Chapters` sits inside the lane `04_Chapters`" in row, row
    assert "remove or move it" in row, row


@t("and its files are not listed one by one as unregistered")
def _():
    # This is the regression. Before, each file inside the duplicate produced its own line:
    # "04_Chapters: `04_Chapters/Chapter_01_Package_v1.3.zip` is in Drive but not in the register".
    for bad in re.findall(r"`(?:00_Front_Matter|04_Chapters)/[^`]+`", row):
        raise AssertionError("a file inside the duplicate is still listed: %s" % bad)
    assert "is in Drive but not in the register" not in row, row
    # it still says how many are in there, so the size of the mistake is visible
    assert re.search(r"\(\d+ files? inside it\)", row), row


@t("it still stops, and the report says what to do")
def _():
    assert "**Status: STOPPED" in report, report[:400]
    assert "**Stopped: fix the lines marked STOP above and upload again.**" in report


@t("a clean shelf is unaffected and gets the ready line")
def _():
    clean_out = os.path.join(tmp, "clean")
    r = subprocess.run(
        [sys.executable, "tools/flexee_intake.py", "--book-id", "sad", "--local", SHELF,
         "--out", clean_out, "--validator", "tools/build_questions.py"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"}).stdout
    assert "**Status: READY TO APPROVE**" in r, r[:400]
    assert "**Ready to add: click Add to library.**" in r, r[-400:]
    assert "sits inside the lane" not in r, "a clean shelf reported a nested folder"
    # SAD warns about its seven table header cells, so the closing line names that gate
    assert "none of which blocks the book" in r, r[-400:]
    assert "Table header cells" in r, r[-400:]


shutil.rmtree(tmp, ignore_errors=True)
print("\n%d checks passed" % passed)
