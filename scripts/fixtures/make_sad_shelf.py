"""Build a test shelf mirroring MIS3250_v2_CURRENT in Drive: real chapter packages, every lane's file
names as they stand in Drive, a question bank, and a register whose section-0 table matches it."""
import json, shutil, sys, re
from pathlib import Path
import os
SRC = Path(os.environ.get("SAD_PACKAGES", "/home/claude/sad_in"))  # folder of SAD chapter packages + front matter
def build(root, register_overrides=None, escaped=False, layout="artifact-version"):
    root = Path(root); shutil.rmtree(root, ignore_errors=True)
    L = {k: root / k for k in ["00_Front_Matter", "01_Speaker_Notes", "02_Lecture_Decks", "03_Studio_Packs",
                               "04_Chapters", "05_Compiled", "06_Tooling", "07_Question_Banks"]}
    for d in L.values(): d.mkdir(parents=True)
    # 00 and 04 — real content, at the versions Drive now holds
    (L["00_Front_Matter"] / "Book_Front_Matter_v1.6.md").write_bytes((SRC / "Book_Front_Matter_v1.5.md").read_bytes())
    vers = {1: "1.3", 2: "1.2", 3: "1.2", 5: "1.2", 6: "1.2"}
    for f in sorted(SRC.glob("Chapter_*_Package_*.zip")):
        n = int(re.search(r"Chapter_(\d+)", f.name).group(1))
        shutil.copy(f, L["04_Chapters"] / f"Chapter_{n:02d}_Package_v{vers.get(n, '1.1')}.zip")
    # 01, 02, 03, 05, 06 — the names in Drive (content is irrelevant to intake)
    touch = lambda d, n: (L[d] / n).write_text("x")
    for w in (9, 11, 12, 13, 14): touch("01_Speaker_Notes", f"MIS3250_Week{w:02d}_Notes_v2.2.md")
    touch("01_Speaker_Notes", "MIS3250_Week10_Notes_v2.1.md"); touch("01_Speaker_Notes", "MIS3250_Week09_Studio_Notes_v2.0.md")
    for w, v in {1: "1.0", 2: "1.0", 7: "1.0", 3: "1.2", 5: "1.2", 6: "1.1", 4: "1.2", 9: "2.2", 11: "2.2",
                 12: "2.2", 13: "2.2", 14: "2.2", 10: "2.1"}.items():
        touch("02_Lecture_Decks", f"MIS3250_Week{w:02d}_Lecture_v{v}.pptx")
    (L["02_Lecture_Decks"] / "Archive_pre_editorial").mkdir(); (L["02_Lecture_Decks"] / "Archive_pre_editorial" / "old.pptx").write_text("x")
    for w in (1, 2, 3, 4, 5, 6, 7, 11): touch("03_Studio_Packs", f"MIS3250_Week{w:02d}_Studio_v1.0.pptx")
    for w in (10, 12, 13, 14): touch("03_Studio_Packs", f"MIS3250_Week{w:02d}_Studio_v1.1.pptx")
    touch("03_Studio_Packs", "MIS3250_Week09_Studio_v2.0.pptx")
    for n in ("MIS3250_Book_Complete_v1.7.html", "MIS3250_Book_Complete_v1.7.docx", "MIS3250_Reader_v1.7.html"): touch("05_Compiled", n)
    touch("06_Tooling", "TA_Work_Order_v1.0.md")
    # 07 — a small, valid bank: 5 objectives and 4 approved questions per chapter
    qb = L["07_Question_Banks"]; (qb / "questions").mkdir(); (qb / "review").mkdir()
    objs, meta = [], {"use": "quiz", "style": "scenario", "context": "university", "source": "ai-drafted-edited",
                      "review": {"status": "approved", "reviewer": "VS", "date": "2026-09-26"}}
    for c in range(1, 13):
        objs += [{"id": f"sad-c{c:02d}-o{o}", "book": "sad", "chapter": c, "code": f"C{c}.{o}", "label": f"Objective {o}"} for o in range(1, 6)]
        qs = []
        for i in range(1, 5):
            qs.append({"id": f"sad-c{c:02d}-{i:03d}", "book": "sad", "chapter": c, "objective": "x", "objectiveId": f"sad-c{c:02d}-o{i}",
                       "difficulty": "apply", "stem": f"Stem {c}.{i}", "points": 1, **json.loads(json.dumps(meta)),
                       "options": [{"id": k, "text": f"Option {k}", "correct": k == "abcd"[i % 4], "rationale": "r"} for k in "abcd"]})
        (qb / "questions" / f"ch{c:02d}.json").write_text("[\n" + ",\n".join(json.dumps(q) for q in qs) + "\n]\n")
        (qb / "review" / f"ch{c:02d}_review.md").write_text("x")
    (qb / "objectives.json").write_text(json.dumps(objs, indent=2))
    # register — section-0 table as the corrected v6.17 will state it
    o = {"reg": "6.17", "status": "READY FOR INTAKE", "ch_rows": "| `04_Chapters` | Chapter 1 | **v1.3** | CURRENT |\n| `04_Chapters` | Chapters 2, 3, 5, 6 | **v1.2** | CURRENT |\n| `04_Chapters` | Chapters 4, 7–12 | **v1.1** | CURRENT |",
         "compiled": "1.7", "objectives": "60", "fm": "1.6"}
    o.update(register_overrides or {})
    reg = f"""# MIS 3250 — State of Record

**Register version:** {o['reg']}
**Built to:** Flexee Book Standard v1.1 (`Flexee/Flexee_Standards/Book_Folder_Standard_v1.1.md`)
**Intake status:** {o['status']}

## 0. What the Wrapper checks

### The imprint, exactly as it must appear

| | |
|---|---|
| Publisher | **Flexee Publishing** |
| Author | **Vikram Sethi** |
| Editor | **Chuck Nemer** |
| Edition | **First edition, 2027** |

### Totals

| | |
|---|---|
| Chapters | **12** |
| Figures | **48** |
| Book version | **v1.7** |

### Current version of every artifact

| Lane | Artifact | Version | Status |
|---|---|---|---|
| `00_Front_Matter` | `Book_Front_Matter_v{o['fm']}.md` | **v{o['fm']}** | CURRENT |
| `01_Speaker_Notes` | `MIS3250_WeekNN_Notes` — Weeks 9, 11, 12, 13, 14 | **v2.2** | CURRENT |
| `01_Speaker_Notes` | `MIS3250_Week10_Notes` | **v2.1** | CURRENT — needed no change |
| `01_Speaker_Notes` | `MIS3250_Week09_Studio_Notes` | **v2.0** | CURRENT |
| `02_Lecture_Decks` | Weeks 1, 2, 7 — first version, edited 23 Sep | **v1.0** | CURRENT |
| `02_Lecture_Decks` | Weeks 3, 5 — edited 23 Sep | **v1.2** | CURRENT |
| `02_Lecture_Decks` | Week 6 — not edited | v1.1 | CURRENT |
| `02_Lecture_Decks` | Week 4 — not edited | v1.2 | CURRENT |
| `02_Lecture_Decks` | Weeks 9, 11, 12, 13, 14 — edited 23 Sep | **v2.2** | CURRENT |
| `02_Lecture_Decks` | Week 10 — not edited | v2.1 | CURRENT |
| `03_Studio_Packs` | `MIS3250_WeekNN_Studio` — Weeks 1–7, 11 | **v1.0** | CURRENT |
| `03_Studio_Packs` | Weeks 10, 12, 13, 14 | v1.1 | CURRENT |
| `03_Studio_Packs` | Week 9 | v2.0 | CURRENT |
{o['ch_rows']}
| `05_Compiled` | `MIS3250_Book_Complete_v{o['compiled']}.html` / `.docx` | **v{o['compiled']}** | CURRENT |
| `05_Compiled` | `MIS3250_Reader_v{o['compiled']}.html` | **v{o['compiled']}** | CURRENT |
| `07_Question_Banks` | `objectives.json` — all twelve chapters | **{o['objectives']} objectives** | CURRENT |
""" + "".join(f"| `07_Question_Banks` | `questions/ch{c:02d}.json` | **24 questions** | CURRENT — all approved |\n" for c in range(1, 13)) + """| `07_Question_Banks` | `review/ch01`–`ch12_review.md` | — | CURRENT, derived |

---

## 1. Version scheme
"""
    if layout == "file-bytes":  # synthetic fixture matching the SAD v6.18 Lane | File | Bytes | Status layout
        head, rest = reg.split("### Current version of every artifact", 1)
        tail = rest.split("\n---\n", 1)[1]
        head = head.replace("| Publisher | **Flexee Publishing** |", "| Publisher | **Flexee Publishing** |\n| Series | **Five Zero Books** |\n| Title | **Analysis and Design of Information Systems** |")
        rows = ["| Lane | File | Bytes | Status |", "|---|---|---|---|"]
        for lane in sorted(L):
            for fp in sorted(L[lane].rglob("*")):
                rel = fp.relative_to(L[lane])
                if fp.is_file() and not any(x.startswith("Archive") for x in rel.parts):
                    rows.append(f"| `{lane}` | `{rel.as_posix()}` | {fp.stat().st_size:,} | CURRENT |")
        reg = head + "### Current version of every artifact\n\nOne row per file.\n\n" + "\n".join(rows) + "\n\n---\n" + tail
    if escaped:  # the form Drive's text export produces
        reg = re.sub(r"([_*`#])", r"\\\1", reg)
    (root / "STATE_OF_RECORD.md").write_text(reg)
    return root
if __name__ == "__main__": build(sys.argv[1])
