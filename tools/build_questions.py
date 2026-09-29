#!/usr/bin/env python3
"""
Flexee question-bank builder — part of book intake.

Validates per-chapter question files AND the book's learning objectives, checks
that every question links to a real objective, and consolidates both into the
content tree (questions.json + objectives.json) for the app to ingest.

Source layout (beside the manuscript):
    <src>/objectives.json              # the book's learning objectives (catalog substance)
    <src>/questions/ch04.json          # a chapter's questions (array)
    <src>/Chapter-4-*.questions.json   # alternative per-chapter naming

Usage:
  python3 build_questions.py --src SRC --book-id mis3000 --out content/mis3000
  python3 build_questions.py --src SRC --book-id mis3000 --scaffold 1-14
"""
import argparse, json, re, sys
from pathlib import Path

DIFFICULTIES = {"recall", "apply", "analyse"}
TYPES = {"multiple_choice"}

# Structured metadata (Question Bank Schema v1.1). Optional unless --require-meta is given;
# when present, values must come from these lists so the bank stays queryable later.
USES = {"practice", "quiz", "exam"}
STYLES = {"definition", "scenario", "diagram-reading", "comparison", "calculation"}
CONTEXTS = {"university", "retail", "healthcare", "manufacturing", "financial-services", "government",
            "hospitality", "logistics", "technology", "nonprofit", "general"}
REVIEW_STATUSES = {"draft", "reviewed", "approved"}
SOURCES = {"author", "ai-drafted-edited"}
META_FIELDS = ("use", "style", "context", "review", "source")

def validate_meta(q, bad, require):
    for f in META_FIELDS:
        if require and q.get(f) in (None, "", {}): bad(f"missing metadata field '{f}' (required with --require-meta)")
    if q.get("use") is not None and q["use"] not in USES: bad(f"use must be one of {sorted(USES)}")
    if q.get("style") is not None and q["style"] not in STYLES: bad(f"style must be one of {sorted(STYLES)}")
    if q.get("context") is not None and q["context"] not in CONTEXTS: bad(f"context must be one of {sorted(CONTEXTS)}")
    if q.get("source") is not None and q["source"] not in SOURCES: bad(f"source must be one of {sorted(SOURCES)}")
    if q.get("figure") is not None and not re.match(r"^fig\d+_\d+[a-z0-9_]*$", str(q["figure"])):
        bad("figure must name a book figure file stem, e.g. fig4_2_level0_dfd")
    r = q.get("review")
    if r is not None:
        if not isinstance(r, dict) or r.get("status") not in REVIEW_STATUSES:
            bad(f"review.status must be one of {sorted(REVIEW_STATUSES)}")
        elif r["status"] != "draft" and (not r.get("reviewer") or not re.match(r"^\d{4}-\d{2}-\d{2}$", str(r.get("date", "")))):
            bad("a reviewed or approved question needs review.reviewer and review.date (YYYY-MM-DD)")

# Item-writing checks (Question Bank Writing Guide v1.3, lower bounds added in v1.8). These flag
# answers a test-wise student could find without knowing the material. They are warnings: a chapter
# can pass validation and still be flagged. Use --fail-on-warnings to make them stop the run.
# The length tell runs both ways: an answer that is always the longest option gives itself away,
# and so does one that is never the longest.
POSITION_MAX_SHARE = 0.40     # no single position should hold the correct answer this often
LONGEST_MAX_SHARE = 0.40      # the correct answer should not be the longest option this often
LONGEST_MIN_SHARE = 0.10      # ...nor this rarely (chance is about 1 in 4)
LENGTH_RATIO_MAX = 1.20       # correct-answer length vs. the average distractor length
LENGTH_RATIO_MIN = 0.90       # ...and the same ratio from below

def item_warnings(label, qs):
    warns = []
    qs = [q for q in qs if isinstance(q.get("options"), list) and len(q["options"]) >= 2]
    if len(qs) < 8:
        return warns
    pos, longest, has_longest, ratios = [], 0, 0, []
    for q in qs:
        opts = q["options"]
        idx = next((i for i, o in enumerate(opts) if o.get("correct")), None)
        if idx is None: continue
        pos.append(idx)
        lens = [len(str(o.get("text", ""))) for o in opts]
        if lens.count(max(lens)) == 1:          # one option is strictly the longest (ties give nothing away)
            has_longest += 1
            if lens[idx] == max(lens): longest += 1
        others = [l for i, l in enumerate(lens) if i != idx]
        if others and sum(others): ratios.append(lens[idx] / (sum(others) / len(others)))
    n = len(pos)
    if not n: return warns
    from collections import Counter
    c = Counter(pos); letter = lambda i: "abcdefgh"[i] if i < 8 else str(i)
    spread = ", ".join(f"{letter(i)} {c.get(i, 0)}" for i in range(max(len(q["options"]) for q in qs)))
    top_i, top_n = c.most_common(1)[0]
    if top_n / n > POSITION_MAX_SHARE:
        warns.append(f"{label}: the correct answer is option {letter(top_i)} in {top_n} of {n} questions ({spread}) — rotate it across positions")
    if longest / n > LONGEST_MAX_SHARE:
        warns.append(f"{label}: the correct answer is the longest option in {longest} of {n} questions — shorten the answers rather than padding the distractors")
    if has_longest >= 8 and longest / has_longest < LONGEST_MIN_SHARE:
        warns.append(f"{label}: the correct answer is the longest option in only {longest} of the {has_longest} questions that have a single longest option — never being the longest is as easy to spot as always being it")
    if ratios:
        mean = sum(ratios) / len(ratios)
        if mean > LENGTH_RATIO_MAX:
            warns.append(f"{label}: correct answers average {mean:.2f}x the length of the distractors — even them out")
        if mean < LENGTH_RATIO_MIN:
            warns.append(f"{label}: correct answers average only {mean:.2f}x the length of the distractors — the distractors have been padded; even them out")
    return warns

def load_objectives(src: Path, book_id: str):
    f = src / "objectives.json"
    if not f.exists():
        return None, []
    errs = []
    try:
        arr = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        return None, [f"objectives.json: not valid JSON ({e})"]
    ids = set()
    for o in arr:
        oid = o.get("id", "?")
        if not re.match(r"^[a-z0-9]+-c\d{2}-o\d+$", oid):
            errs.append(f"objectives.json [{oid}]: id must look like <book>-cNN-oN")
        if o.get("book") != book_id:
            errs.append(f"objectives.json [{oid}]: book '{o.get('book')}' != '{book_id}'")
        if not o.get("label"):
            errs.append(f"objectives.json [{oid}]: missing 'label'")
        ids.add(oid)
    return {"list": arr, "ids": ids}, errs

def validate_question(q, book_id, obj_ids, seen, where, require_meta=False):
    errs = []
    qid = q.get("id", "?")
    def bad(m): errs.append(f"{where} [{qid}]: {m}")
    for fld in ("id", "book", "chapter", "objective", "difficulty", "stem", "options"):
        if q.get(fld) in (None, "", []): bad(f"missing required field '{fld}'")
    if not re.match(r"^[a-z0-9]+-c\d{2}-\d{3}$", q.get("id", "")): bad("id must look like <book>-cNN-nnn")
    if qid in seen: bad("duplicate id")
    if q.get("book") != book_id: bad(f"book '{q.get('book')}' != '{book_id}'")
    if q.get("difficulty") not in DIFFICULTIES: bad(f"difficulty must be one of {sorted(DIFFICULTIES)}")
    if q.get("type", "multiple_choice") not in TYPES: bad("type must be multiple_choice")
    # objective linkage
    if obj_ids is not None:
        oid = q.get("objectiveId")
        if not oid: bad("missing objectiveId (link the question to a learning objective)")
        elif oid not in obj_ids: bad(f"objectiveId '{oid}' is not defined in objectives.json")
    opts = q.get("options", [])
    if isinstance(opts, list):
        if len(opts) < 2: bad("needs at least 2 options")
        if len([o for o in opts if o.get("correct")]) != 1: bad("must have exactly one correct option")
        for o in opts:
            if not o.get("text"): bad("an option is missing 'text'")
            if not o.get("rationale"): bad(f"option '{o.get('id','?')}' is missing a rationale")
        ids = [o.get("id") for o in opts]
        if len(set(ids)) != len(ids): bad("option ids are not unique")
    if not isinstance(q.get("points", 1), int) or q.get("points", 1) < 1: bad("points must be a positive integer")
    validate_meta(q, bad, require_meta)
    return errs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True); ap.add_argument("--book-id", required=True)
    ap.add_argument("--out"); ap.add_argument("--scaffold")
    ap.add_argument("--require-meta", action="store_true", help="make use/style/context/review/source mandatory")
    ap.add_argument("--fail-on-warnings", action="store_true", help="treat item-writing warnings as failures")
    a = ap.parse_args()
    src = Path(a.src)

    if a.scaffold:
        lo, hi = (int(x) for x in a.scaffold.split("-"))
        qdir = src / "questions"; qdir.mkdir(parents=True, exist_ok=True)
        if not (src / "objectives.json").exists():
            (src / "objectives.json").write_text(json.dumps(
                [{"id": f"{a.book_id}-c{lo:02d}-o1", "book": a.book_id, "chapter": lo, "code": "", "label": "", "bloom": "apply"}], indent=2), encoding="utf-8")
            print("wrote objectives.json starter")
        made = 0
        for ch in range(lo, hi + 1):
            f = qdir / f"ch{ch:02d}.json"
            if f.exists(): continue
            f.write_text(json.dumps([{ "id": f"{a.book_id}-c{ch:02d}-001", "book": a.book_id, "chapter": ch, "section": "",
                "objective": "", "objectiveId": f"{a.book_id}-c{ch:02d}-o1", "type": "multiple_choice", "difficulty": "apply",
                "stem": "", "options": [{"id":"a","text":"","correct":True,"rationale":""},{"id":"b","text":"","correct":False,"rationale":""}],
                "points": 1, "shuffleOptions": True, "tags": [],
                "use": "quiz", "style": "scenario", "context": "general", "review": {"status": "draft"}, "source": "author" }], indent=2), encoding="utf-8")
            made += 1
        print(f"scaffolded {made} chapter template(s) in {qdir}")
        return

    objectives, errors = load_objectives(src, a.book_id)
    obj_ids = objectives["ids"] if objectives else None
    if objectives is None and not errors:
        print("  · note: no objectives.json — objective linkage not checked (build it to enable mastery reporting)")

    files = sorted(src.glob("questions/*.json")) + sorted(src.glob("*.questions.json"))
    if not files:
        print(f"No question source files under {src}."); sys.exit(1)

    all_q, seen = [], set()
    for f in files:
        try: arr = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e: errors.append(f"{f.name}: not valid JSON ({e})"); continue
        if not isinstance(arr, list): errors.append(f"{f.name}: top level must be an array"); continue
        for q in arr:
            if not q.get("stem"): print(f"  · skipping unfilled template {q.get('id','?')} in {f.name}"); continue
            e = validate_question(q, a.book_id, obj_ids, seen, f.name, a.require_meta)
            if e: errors.extend(e)
            else: seen.add(q["id"]); all_q.append(q)

    if errors:
        print("\nVALIDATION FAILED:")
        for e in errors: print("  -", e)
        sys.exit(1)

    all_q.sort(key=lambda q: (q["chapter"], q["id"]))
    by_ch = {}
    for q in all_q: by_ch[q["chapter"]] = by_ch.get(q["chapter"], 0) + 1
    print("validated:", ", ".join(f"ch{c}={n}" for c, n in sorted(by_ch.items())), f"| total {len(all_q)}",
          f"| objectives {len(obj_ids)}" if obj_ids else "")
    from collections import Counter
    for f in ("use", "style", "context", "source"):
        c = Counter(q.get(f, "-") for q in all_q)
        if set(c) != {"-"}: print(f"  {f}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    rv = Counter((q.get("review") or {}).get("status", "-") for q in all_q)
    if set(rv) != {"-"}: print("  review: " + ", ".join(f"{k} {v}" for k, v in sorted(rv.items())))

    warnings = []
    for c in sorted(by_ch):
        warnings += item_warnings(f"ch{c:02d}", [q for q in all_q if q["chapter"] == c])
    if warnings:
        print("\nITEM-WRITING WARNINGS (answers a test-wise student could spot):")
        for w in warnings: print("  -", w)
        if a.fail_on_warnings: sys.exit(2)
    else:
        print("  item-writing checks: no answer-position or answer-length tells")

    if a.out:
        out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
        (out / "questions.json").write_text(json.dumps(all_q, indent=2, ensure_ascii=False), encoding="utf-8")
        if objectives: (out / "objectives.json").write_text(json.dumps(objectives["list"], indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {out}/questions.json" + (" + objectives.json" if objectives else ""))

if __name__ == "__main__":
    main()
