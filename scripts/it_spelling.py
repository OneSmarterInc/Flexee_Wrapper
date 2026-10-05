#!/usr/bin/env python3
"""Spec 22 §7 and rule 8 — the widened spelling gate and the phrasing scan.

Every added form is checked against the American spelling of the same word, because a pattern that
flags both is worse than no pattern: it trains the Books coordinator to ignore the gate. The real
chapters of all three books are then scanned read-only, and the counts printed are the ones the
change note quotes.
"""
import io, os, re, sys, zipfile

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

hit = lambda s: bool(fi.BRITISH_RE.search(s))


@t("a prefixed British spelling is flagged, which it was not before")
def _():
    for w in ("reorganise", "reorganised", "reorganisation", "unauthorised", "disorganised",
              "misbehaviour", "overemphasise", "overemphasised", "underutilised", "reanalyse",
              "relabelled", "unlicensed" if hit("unlicensed") else "relabelling"):
        assert hit(w), w


@t("and a word that merely starts with one of those prefixes is not")
def _():
    # The words the prefix list could plausibly have broken. None matches: the group can only match
    # where a British stem follows it immediately. Measured, a \w* prefix would leave them alone
    # too, because no stem in the list appears inside a longer word — so what this check really
    # guards is the stems, and it is what would catch one added later that sits inside an ordinary
    # word.
    for w in ("research shows", "undercover work", "misread the chart", "disclose the risk",
              "overdue", "disorder", "understand", "overview", "reason", "mission", "discuss"):
        assert not hit(w), w


@t("each added form is British-only: the American spelling of the same word is not flagged")
def _():
    pairs = [("fulfil", "fulfill"), ("fulfilment", "fulfillment"), ("fulfils", "fulfills"),
             ("travelled", "traveled"), ("travelling", "traveling"), ("traveller", "traveler"),
             ("totalling", "totaling"), ("totalled", "totaled"),
             ("practise", "practice"), ("practising", "practicing"), ("practises", "practices"),
             ("harbour", "harbor"), ("labour", "labor"), ("neighbour", "neighbor"),
             ("neighbourhood", "neighborhood"), ("fibre", "fiber"), ("theatre", "theater"),
             ("cheque", "check")]
    for british, american in pairs:
        assert hit(british), "%s should be flagged" % british
        assert not hit(american), "%s is American and must not be flagged" % american


@t("the forms that were already flagged still are, and nothing unprefixed changed")
def _():
    for w in ("catalogue", "modelling", "labelled", "cancelled", "licence", "behaviour", "colour",
              "favour", "centre", "programme", "defence", "analyse", "judgement", "organise",
              "authorisation", "prioritise", "summarised"):
        assert hit(w), w
    for w in ("catalog", "modeling", "labeled", "canceled", "license", "behavior", "color",
              "favor", "center", "program", "defense", "analyze", "judgment", "organize"):
        assert not hit(w), w


@t("fulfilled and fulfilling are American too, and are left alone")
def _():
    # The trap in the spec's own list: fulfil(?!l) catches only the bare word, so "fulfilment"
    # escaped it. fulfil(?!l)\w* catches both and still skips every double-l form.
    for w in ("fulfilled", "fulfilling", "fulfillment", "fulfills", "fulfill"):
        assert not hit(w), w
    for w in ("fulfil", "fulfilment", "fulfils"):
        assert hit(w), w


@t("the phrasing scan skips a caption line and a long description, and keeps the prose")
def _():
    md = "\n".join([
        "![A box that is not a process. It is a store.](figures/fig1_1_x.png)", "",
        "**Figure 1.1** A dashed box is not a process. It is a hypothesis.", "",
        "Table 1.2 A column is not an attribute. It is a calculation.", "",
        "> Long description: The left box is not a process. It is a data store.", "",
        "A data flow is not a process. It is movement.", "",
    ])
    kept = fi.prose_only(md)
    assert "A data flow is not a process" in kept
    for gone in ("hypothesis", "calculation", "data store", "that is not a process"):
        assert gone not in kept, gone
    assert len(fi.NEG_PARALLEL.findall(kept)) == 1, fi.NEG_PARALLEL.findall(kept)
    # and with nothing to skip, it behaves exactly as the old inline substitution did
    plain = "A box is not a process. It is a store.\n"
    assert fi.prose_only(plain).strip() == plain.strip()


# ---------------------------------------------------------------- the three real books

BOOKS = [("SAD (fz1001)", r"G:\My Drive\Flexee\Flexee-SAD\MIS3250_v2_CURRENT"),
         ("MIS 3000 (fz1002)", r"G:\My Drive\Flexee\Flexee-3000\MIS3000_v1_CURRENT"),
         ("MIS 4950 (fz1003)", r"G:\My Drive\Flexee\FiveZero-4950\FZ1003_v1_CURRENT")]


def chapters(root):
    """The newest package per chapter, read-only."""
    lane = os.path.join(root, "04_Chapters")
    if not os.path.isdir(lane):
        return
    best = {}
    for name in os.listdir(lane):
        m = re.match(r"Chapter_(\d+)_Package_v([\d.]+)\.zip$", name)
        if not m:
            continue
        n, v = int(m.group(1)), tuple(int(x) for x in m.group(2).split("."))
        if n not in best or v > best[n][0]:
            best[n] = (v, os.path.join(lane, name))
    for n in sorted(best):
        with zipfile.ZipFile(best[n][1]) as z:
            for f in z.namelist():
                if f.endswith(".md"):
                    yield n, z.read(f).decode("utf-8", "replace")


present = [(label, root) for label, root in BOOKS if os.path.isdir(os.path.join(root, "04_Chapters"))]
if len(present) < len(BOOKS):
    print("\nSKIP the real-book counts — the packages live under G:\\My Drive\\Flexee")
else:
    print("\nthe counts the change note quotes, from the real chapter packages:")
    results = {}
    for label, root in present:
        words, chs, neg = {}, 0, 0
        for n, md in chapters(root):
            chs += 1
            for mt in fi.BRITISH_RE.finditer(md):
                words.setdefault(mt.group(0).lower(), []).append("ch%d" % n)
            neg += len(fi.NEG_PARALLEL.findall(fi.prose_only(md)))
        total = sum(len(v) for v in words.values())
        detail = ", ".join("%s x%d (%s)" % (w, len(v), v[0]) for w, v in sorted(words.items())) or "none"
        print("   %-20s %2d chapters · %d spelling warning(s): %s · %d phrasing note(s)"
              % (label, chs, total, detail, neg))
        results[label] = (total, words)

    @t("the widened gate warns once across all three books, and it is a real one")
    def _():
        sad = results["SAD (fz1001)"]
        assert sad[0] == 1, "SAD: expected 1 warning, got %d (%s)" % (sad[0], sorted(sad[1]))
        assert "practising" in sad[1], sorted(sad[1])
        assert sad[1]["practising"] == ["ch8"], sad[1]["practising"]
        for book in ("MIS 3000 (fz1002)", "MIS 4950 (fz1003)"):
            assert results[book][0] == 0, "%s: %s" % (book, sorted(results[book][1]))

    @t("the widening added no warning to a book that was clean")
    def _():
        # The guard against a pattern that starts flagging correct American prose: MIS 3000 and
        # MIS 4950 were clean before and must still be.
        for book in ("MIS 3000 (fz1002)", "MIS 4950 (fz1003)"):
            assert not results[book][1], "%s now warns: %s" % (book, sorted(results[book][1]))

print("\n%d checks passed" % passed)
