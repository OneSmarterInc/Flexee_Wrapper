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

# SAD was re-keyed to its catalog number on 7 October: register v6.21 carries
# | Catalog number | **FZ1001** |, so Spec 22's gate stops an upload under any other id — including
# the "sad" this fixture used until that day. The intake is run as fz1001 here for that reason, and
# test:catalog is what pins the gate itself.
SHELF = os.environ.get("SAD_PACKAGES") or r"G:\My Drive\Flexee\Flexee-SAD\FZ1001_v2_CURRENT"
if not os.path.isdir(os.path.join(SHELF, "00_Front_Matter")):
    print("\nSKIP the nested-folder checks — set SAD_PACKAGES to a shelf with the real lanes, e.g.")
    print('       SAD_PACKAGES="G:/My Drive/Flexee/Flexee-SAD/FZ1001_v2_CURRENT" npm run test:reports')
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
    [sys.executable, "tools/flexee_intake.py", "--book-id", "fz1001", "--local", fixture,
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


def intake(shelf, out_name):
    """One read-only intake run against a shelf, returning the report."""
    return subprocess.run(
        [sys.executable, "tools/flexee_intake.py", "--book-id", "fz1001", "--local", shelf,
         "--out", os.path.join(tmp, out_name), "--validator", "tools/build_questions.py"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"}).stdout


def stops_in(report):
    return [l.split("|")[1].strip() for l in report.split("\n") if "**STOP**" in l]


# The clean-shelf check needs a shelf with no STOP in it, and the real one is a working folder. On
# the morning of 7 October it was clean; by the evening 05_Compiled held v1.9 files while register
# v6.22 still listed v1.8, so the register-to-Drive gate stopped it — correctly. A suite whose
# result depends on whether somebody is mid-edit on Drive is a bad suite, so the clean shelf is
# *derived* from the real one, and the derivation is checked rather than assumed.
def derive_clean(src):
    """A copy of the shelf, reconciled with its own register until the gate has nothing to stop on.

    Two kinds of complaint are answered, both quoting the gate's own message back at it: a file the
    register lists that is not there, and one whose size does not match what the register records.
    A placeholder of exactly the recorded size satisfies both, because that gate compares a name
    and a byte count and nothing else — the first pass of this helper created empty files and was
    caught by the size check, which is the reason that is written down here.

    This is only safe in a lane the intake does not read for content, and 05_Compiled is one: it
    holds the compiled reader and book, which the register tracks but the intake never opens.
    Nothing on Drive is written.
    """
    out = os.path.join(tmp, "derived")
    shutil.copytree(src, out)
    report = intake(out, "derive-probe-0")
    for attempt in range(1, 5):            # a few passes: the size check only speaks once a file exists
        if "**STOP**" not in report:
            return out, report
        wanted = {}                        # (lane, name) -> bytes the register records
        for lane, name in re.findall(r"(\w+): register lists `([^`]+)`, not in Drive", report):
            wanted[(lane, name)] = 0
        for lane, name, size in re.findall(
                r"(\w+): `([^`]+)` is [\d,]+ bytes in Drive; the register says ([\d,]+)", report):
            wanted[(lane, name)] = int(size.replace(",", ""))
        made = 0
        for (lane, name), size in wanted.items():
            d = os.path.join(out, lane)
            if not os.path.isdir(d):
                continue                   # a missing lane is a different fault; leave it to stop
            with io.open(os.path.join(d, name), "wb") as fh:
                if size:
                    fh.truncate(size)      # sparse where the filesystem allows it; never read
            made += 1
        if not made:
            return out, report             # a STOP this cannot reconcile; the caller reports it
        report = intake(out, "derive-probe-%d" % attempt)
    return out, report


@t("a clean shelf is unaffected and gets the ready line")
def _():
    _fixture, r = derive_clean(SHELF)
    # If the derivation could not produce a clean shelf, name the gate rather than asserting READY
    # and printing four hundred characters of report at whoever reads the failure.
    if "**STOP**" in r:
        raise AssertionError("the derived shelf still stops on: %s" % ", ".join(stops_in(r)))
    assert "**Status: READY TO APPROVE**" in r, r[:400]
    assert "**Ready to add: click Add to library.**" in r, r[-400:]
    assert "sits inside the lane" not in r, "a clean shelf reported a nested folder"

    # The closing line's warnings clause has to match whatever warnings the report actually holds,
    # rather than a list fixed when this was written. Until 7 October SAD warned about seven empty
    # table header cells and this asserted the clause named that gate; the revision fixed them, and
    # a test that demanded the book stay broken would have had to be weakened rather than corrected.
    warned = [l.split("|")[1].strip() for l in r.split("\n")
              if l.startswith("|") and "| warning |" in l]
    tail = r.rsplit("**Ready to add", 1)[-1]
    if warned:
        assert "none of which blocks the book" in r, r[-400:]
        for gate_name in warned:
            assert gate_name in tail, (gate_name, r[-400:])
    else:
        assert "none of which blocks the book" not in r, \
            "the closing line claimed warnings on a report that has none"
        assert r.rstrip().endswith("**Ready to add: click Add to library.**"), r[-200:]
    print("      the clean shelf reported %d warning gate(s): %s"
          % (len(warned), ", ".join(warned) or "none"))


@t("and the real shelf's own report agrees with itself, whatever state it is in")
def _():
    # What the derived copy cannot check: that the status line, the gate rows and the closing line
    # agree with each other on the shelf as it actually stands. This is the half that keeps working
    # while the Books coordinator is mid-edit, and it is where a real STOP is reported to a reader
    # instead of failing the suite.
    r = intake(SHELF, "asis")
    stops = stops_in(r)
    if stops:
        assert "**Status: STOPPED" in r, r[:300]
        assert "**Stopped: fix the lines marked STOP above and upload again.**" in r, r[-300:]
        assert "Ready to add" not in r, "a stopped report still offered the Add button"
        print("      the real shelf STOPS on: %s" % ", ".join(stops))
        print("      ^ for the Books coordinator. Not a test failure: the gate is working.")
    else:
        assert "**Status: READY TO APPROVE**" in r, r[:300]
        assert "**Ready to add: click Add to library.**" in r, r[-300:]
        print("      the real shelf is clean today")


shutil.rmtree(tmp, ignore_errors=True)
print("\n%d checks passed" % passed)
