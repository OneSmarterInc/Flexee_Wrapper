"""Integration test: the intake against a shelf that mirrors Drive, including the failures found by hand on 26 Sep."""
import subprocess, sys, json, shutil, re, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "fixtures"))
from make_sad_shelf import build, SAD_PACKAGES_HELP, SRC
TOOL = Path(__file__).parent.parent / "tools" / "flexee_intake.py"
import os
# The validator ships in this repository. VALIDATOR still overrides it, for running against another
# copy of Flexee_Standards/Tools/build_questions.py.
VAL = os.environ.get("VALIDATOR") or str(Path(__file__).parent.parent / "tools" / "build_questions.py")
if not Path(VAL).exists():
    raise SystemExit(f"Validator not found: {VAL}\nSet VALIDATOR to a copy of build_questions.py.")
if not SRC.exists():
    raise SystemExit(f"SAD source folder not found: {SRC}\n\n{SAD_PACKAGES_HELP}")
# The intake resizes chapter figures, so Pillow is a prerequisite (as in both CI workflows and
# docs/runbooks/Book_Intake_Runbook_for_Developer.md). Said once, up front, rather than as a
# ModuleNotFoundError buried in six separate case failures.
try:
    import PIL  # noqa: F401
except ModuleNotFoundError:
    raise SystemExit(f"Pillow is not installed for {sys.executable}.\nInstall it with:\n  "
                     f'"{sys.executable}" -m pip install Pillow')
# the system temp folder, so this runs on Windows as well as in a container
TMP = Path(tempfile.mkdtemp(prefix="flexee_intake_it_"))
results = []
def run(name, shelf, expect_ok, must_contain=(), must_not=()):
    out = TMP / "out" / re.sub(r"\W+", "_", name); shutil.rmtree(out, ignore_errors=True)
    # PYTHONIOENCODING: the tool prints arrows and dashes, which a Windows console's cp1252
    # stdout cannot encode — it would die on its own output rather than on anything under test.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, str(TOOL), "--book-id", "sad", "--local", str(shelf), "--out", str(out), "--validator", VAL],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    txt = r.stdout + r.stderr
    ok = (r.returncode == 0) == expect_ok and all(s in txt for s in must_contain) and not any(s in txt for s in must_not)
    results.append((name, ok)); print(("PASS " if ok else "FAIL ") + name)
    if not ok: print(txt[-2500:])
S = TMP / "shelf"

# 1. corrected register, shelf as Drive holds it now
run("clean shelf admits", build(S), True, ["READY TO APPROVE", "all 74 files", "60 objectives vs register 60"])

# 2. the escaped text Drive's export produces reads the same
run("Drive-escaped register reads", build(S, escaped=True), True, ["READY TO APPROVE", "register v6.17"])

# 3. register v6.16 as it actually stood: section 0 behind Drive
b = build(S, {"reg": "6.16", "compiled": "1.6", "objectives": "5",
              "ch_rows": "| `04_Chapters` | Chapters 1, 2, 3, 5, 6 | **v1.2** | CURRENT |\n| `04_Chapters` | Chapters 4, 7–12 | **v1.1** | CURRENT |"})
run("stale section 0 stops, naming every gap", b, False,
    ["register lists `Chapter_01_Package_v1.2.zip`, not in Drive", "`Chapter_01_Package_v1.3.zip` is in Drive but not in the register",
     "register lists `MIS3250_Reader_v1.6.html`, not in Drive", "STOPPED"])

# 4. a file recorded as saved that never reached Drive (front matter v1.6, chapter 2 v1.2)
b = build(S); (b / "04_Chapters" / "Chapter_02_Package_v1.2.zip").rename(b / "04_Chapters" / "Chapter_02_Package_v1.1.zip")
run("recorded-but-never-saved chapter stops", b, False, ["register lists `Chapter_02_Package_v1.2.zip`, not in Drive"])

# 5. a stray bundle left in the chapters lane (All.zip)
b = build(S); (b / "04_Chapters" / "All.zip").write_text("x")
run("stray file in an intake lane stops", b, False, ["`All.zip` is in Drive but not in the register"])

# 6. deck names behind the register (the seven renames)
b = build(S); (b / "02_Lecture_Decks" / "MIS3250_Week03_Lecture_v1.2.pptx").rename(b / "02_Lecture_Decks" / "MIS3250_Week03_Lecture_v1.1.pptx")
run("deck named behind the register stops", b, False, ["register lists `MIS3250_Week03_Lecture_v1.2.pptx`, not in Drive"])

# 7. an unregistered file outside the intake lanes only warns
b = build(S); (b / "06_Tooling" / "notes.md").write_text("x"); (b / "05_Compiled" / "old_draft.html").write_text("x")
run("extra file outside intake lanes warns, still admits", b, True, ["`old_draft.html` is in Drive but not in the register", "READY TO APPROVE"])

# 8. a question that fails the shared validator
b = build(S); f = b / "07_Question_Banks" / "questions" / "ch03.json"; qs = json.loads(f.read_text()); qs[0]["options"][1]["rationale"] = ""
f.write_text(json.dumps(qs)); run("invalid question stops", b, False, ["option 'b' is missing a rationale", "STOPPED"])

# 9. drafts load but are reported
b = build(S); f = b / "07_Question_Banks" / "questions" / "ch05.json"; qs = json.loads(f.read_text()); qs[0]["review"] = {"status": "draft"}
f.write_text(json.dumps(qs)); run("draft questions warn, still admits", b, True, ["47 approved, 1 still draft", "READY TO APPROVE"])

# 10. not declared ready
run("IN PROGRESS stops before anything else", build(S, {"status": "IN PROGRESS"}), False, ["intake status is 'IN PROGRESS'"], ["Register ↔ Drive"])

# 11. the register gives one chapter two versions
b = build(S, {"ch_rows": "| `04_Chapters` | Chapters 1, 2 | **v1.3** | CURRENT |\n| `04_Chapters` | Chapters 2, 3, 5, 6 | **v1.2** | CURRENT |\n| `04_Chapters` | Chapters 4, 7–12 | **v1.1** | CURRENT |"})
run("chapter listed at two versions stops", b, False, ["gives chapter 2 two versions"])

# 12. synthetic fixture for SAD v6.18's Lane | File | Bytes | Status layout, including optional Title/Series rows
run("File | Bytes layout admits, sizes checked", build(S, layout="file-bytes"), True,
    ["READY TO APPROVE", "files the register lists are in Drive"])

# 13. a file whose size differs from the register's Bytes column stops the intake
b = build(S, layout="file-bytes"); pkg = b / "04_Chapters" / "Chapter_05_Package_v1.2.zip"
with open(pkg, "ab") as fh: fh.write(b"\0")          # same name, one byte longer: a different file
run("a file whose size differs from the register stops", b, False,
    ["Chapter_05_Package_v1.2.zip` is", "the register says", "STOPPED"])

print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
