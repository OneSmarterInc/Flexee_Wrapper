#!/usr/bin/env python3
"""Spec 21 rules 2 and 3, on the intake's side: what it reads off a chapter and what it warns about.

The renderer's half is scripts/it-figures.ts. The two have to agree about three things — where the
number comes from, where the caption comes from, and what a long description is — so each case here
has a counterpart there, and the last check runs both books' real chapters through this module to
report what the live manifests would say.
"""
import io, os, re, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import figure_alt

passed = 0
def t(name):
    def deco(fn):
        global passed
        try:
            fn(); passed += 1; print("  ✓", name)
        except Exception:
            print("  ✗", name); raise
    return deco


@t("the number comes from the file name, and a name with one number gives none")
def _():
    assert figure_alt.number_from_file_name("fig4_2_level0.png") == "4.2"
    assert figure_alt.number_from_file_name("fig-4-2.png") == "4.2"
    assert figure_alt.number_from_file_name("figures/fig12_3.png") == "12.3"
    assert figure_alt.number_from_file_name("fig_7_11_wide.png") == "7.11"
    assert figure_alt.number_from_file_name("fig04_01.png") == "4.1", "leading zeros are numbers"
    # MIS 3000's names: one number is a figure with no chapter, and inventing one would mint an
    # address a link could not be trusted to reach.
    assert figure_alt.number_from_file_name("fig-01.png") is None
    assert figure_alt.number_from_file_name("diagram.png") is None
    assert figure_alt.number_from_file_name("figure_one.png") is None


@t("the image syntax is read with its title attribute, and without one")
def _():
    md = '![A queue of three](figures/fig3_1_q.png "Figure 3.1: The bottleneck")\n'
    f = figure_alt.figures_in(md)[0]
    assert f["alt"] == "A queue of three", f
    assert f["title"] == "Figure 3.1: The bottleneck", f
    assert f["file"] == "fig3_1_q.png" and f["number"] == "3.1", f

    plain = figure_alt.figures_in("![Figure 1.1](fig-01.png)\n")[0]
    assert plain["title"] is None and plain["alt"] == "Figure 1.1", plain
    assert plain["number"] is None, plain

    # an empty alt is read as empty rather than missed altogether
    empty = figure_alt.figures_in("![](fig2_1_x.png)\n")[0]
    assert empty["alt"] == "" and empty["number"] == "2.1", empty


@t("a long description is the blockquote directly after its own image")
def _():
    md = (
        "![A queue](figures/fig3_1_q.png)\n\n"
        "> Long description: Two arrows enter one box marked Clerk.\n"
        "> A third leaves it and returns to the first queue.\n\n"
        "Some prose.\n\n"
        "![Another](figures/fig3_2_q.png)\n\n"
        "> An ordinary quotation, which is not a description.\n"
    )
    figs = figure_alt.figures_in(md)
    assert len(figs) == 2, figs
    assert figs[0]["description"].startswith("Two arrows enter one box"), figs[0]
    assert "returns to the first queue" in figs[0]["description"], figs[0]
    assert "Long description" not in figs[0]["description"], figs[0]
    assert figs[1]["description"] is None, figs[1]

    # not directly after: prose in between means the quotation belongs to the prose
    far = figure_alt.figures_in("![A queue](fig3_1_q.png)\n\nProse.\n\n> Long description: no.\n")
    assert far[0]["description"] is None, far


@t("the two alt warnings name the right figures and nothing else")
def _():
    md = (
        "![](fig1_1_a.png)\n\n"
        "![Figure 1.2](fig1_2_b.png)\n\n"
        "![Figure 1.3:](fig1_3_c.png)\n\n"
        "![Fig. 1.4](fig1_4_d.png)\n\n"
        "![A clerk sending work back to a queue](fig1_5_e.png)\n\n"
        "![Figure 1.6: a clerk sending work back](fig1_6_f.png)\n"
    )
    got = figure_alt.alt_problems(md, 1)
    kinds = sorted((c, w.split()[1]) for c, w in got)
    assert kinds == [
        ("missing", "fig1_1_a.png"),
        ("number only", "fig1_2_b.png"),
        ("number only", "fig1_3_c.png"),
        ("number only", "fig1_4_d.png"),
    ], kinds
    # a real description is not a warning, and neither is a number followed by real words
    assert not any("fig1_5_e" in w or "fig1_6_f" in w for _c, w in got), got


# ------------------------------------------- Spec 26: alt text that repeats the caption

@t("normalising reduces both sides to the words they carry")
def _():
    n = figure_alt.normalise_for_compare
    want = "context diagram for the course registration system"
    for raw in ("Figure 4.1: Context diagram for the course registration system",
                "context diagram for the course registration system",
                "CONTEXT DIAGRAM FOR THE COURSE REGISTRATION SYSTEM.",
                "  Fig. 4.1 \u2014 Context  diagram for the   course registration system  ",
                "Figure 4.1. Context diagram for the course registration system!",
                "Table 4.1: context diagram for the course registration system;"):
        assert n(raw) == want, (raw, n(raw))
    assert n("") == ""
    assert n(None) == ""
    # A number-only alt reduces to nothing, which is how it is told from a real sentence.
    assert n("Figure 4.1") == ""
    assert n("Figure 4.1:") == ""


@t("rule 1 — identical alt text and caption warn")
def _():
    same = "Context diagram for the course registration system"
    md = '![%s](figures/fig4_1_ctx.png "%s")\n' % (same, same)
    got = figure_alt.alt_problems(md, 4)
    assert got == [("repeats the caption", "ch4 Figure 4.1")], got


@t("rule 2 — case, trailing punctuation, spacing or a leading label still warn")
def _():
    cases = [
        ("Context Diagram for the System", "context diagram for the system", "case"),
        ("Context diagram for the system", "Context diagram for the system.", "a full stop"),
        ("Context  diagram  for the system", "Context diagram for the system", "spacing"),
        ("Context diagram for the system", "Figure 4.2: Context diagram for the system",
         "a label on the caption"),
        ("Figure 4.2: Context diagram for the system", "Context diagram for the system",
         "a label on the alt"),
        ("Figure 4.2 \u2014 Context diagram for the system!", "context diagram for the system",
         "all of them at once"),
    ]
    for alt, caption, why in cases:
        md = '![%s](figures/fig4_2_x.png "%s")\n' % (alt, caption)
        got = figure_alt.alt_problems(md, 4)
        assert got == [("repeats the caption", "ch4 Figure 4.2")], (why, got)


@t("rule 3 — alt text that genuinely differs does not warn")
def _():
    caption = "Figure 4.1: Context diagram for the course registration system"
    for alt in ("A rounded box exchanging data with four outside parties",
                "Context diagram for the course registration system, with four parties",
                "The registration system as one process",
                "Context diagram for the billing system"):
        md = '![%s](figures/fig4_1_x.png "%s")\n' % (alt, caption)
        got = figure_alt.alt_problems(md, 4)
        assert got == [], (alt, got)


@t("rule 4 — an old-style figure, with no separate caption, is not flagged")
def _():
    # Here the caption *comes from* the alt text, so the two are always equal and nothing is being
    # repeated. MIS 3000's figures are all of this shape.
    md = '![Figure 4.1: Context diagram for the course registration system](figures/fig4_1_x.png)\n'
    assert figure_alt.alt_problems(md, 4) == []
    assert figure_alt.alt_repeats_caption("anything at all", None) is False
    assert figure_alt.alt_repeats_caption("anything at all", "") is False
    # A real sentence with no caption is equally not this warning's business.
    md2 = '![A rounded box exchanging data with four parties](figures/fig4_1_x.png)\n'
    assert figure_alt.alt_problems(md2, 4) == []


@t("a number-only alt with a caption is one warning, not two")
def _():
    # Both sides normalise to nothing once the label is stripped, so a naive comparison would call
    # them equal and report the same figure twice.
    md = '![Figure 4.1](figures/fig4_1_x.png "Figure 4.1")\n'
    got = figure_alt.alt_problems(md, 4)
    assert len(got) == 1, got
    assert got[0][0] == "number only", got
    # A blank alt with a caption stays the "missing" warning alone.
    md2 = '![](figures/fig4_2_x.png "Figure 4.2: A real caption")\n'
    got2 = figure_alt.alt_problems(md2, 4)
    assert [c for c, _ in got2] == ["missing"], got2


@t("the warning names the figure by number, falling back to the file name")
def _():
    same = "Context diagram for the system"
    numbered = '![%s](figures/fig7_3_x.png "%s")\n' % (same, same)
    assert figure_alt.alt_problems(numbered, 7) == [("repeats the caption", "ch7 Figure 7.3")]
    # MIS 3000's naming gives no number, so the file name is the only handle there is.
    unnumbered = '![%s](figures/fig-03.png "%s")\n' % (same, same)
    assert figure_alt.alt_problems(unnumbered, 7) == [("repeats the caption", "ch7 fig-03.png")]


@t("rule 5 — the comparison's own line is printed whether or not it found anything")
def _():
    line = figure_alt.caption_check_line
    assert line(48, 0) == "alt text vs caption: checked 48 figures with captions, none repeated"
    assert line(1, 0) == "alt text vs caption: checked 1 figure with captions, none repeated"
    assert line(48, 3) == "alt text vs caption: checked 48 figures with captions, 3 repeated"
    # No figure has a caption yet: say so rather than claiming a clean result.
    assert "nothing to compare" in line(0, 0)
    for n, r in ((0, 0), (1, 0), (48, 0), (48, 3)):
        assert line(n, r), (n, r)


@t("the new category summarises like the others, with a count and the first few")
def _():
    pairs = [("repeats the caption", "ch%d Figure %d.1" % (i, i)) for i in range(1, 6)]
    lines = figure_alt.summarise(pairs)
    assert len(lines) == 1, lines
    assert lines[0].startswith("repeats the caption alt text: 5 figures \u2014 "), lines[0]
    assert lines[0].endswith("and 2 more"), lines[0]


@t("the three real books are reported, and SAD's revision is visible in the counts")
def _():
    # Measured rather than asserted from memory. On 6 October none of the books used a separate
    # caption at all; SAD and MIS 4950 were revised to the convention on the 7th, which is what
    # gives this check anything to compare in the first place.
    import zipfile
    shelves = [("SAD (fz1001)", os.environ.get("SAD_PACKAGES")
                or r"G:\My Drive\Flexee\Flexee-SAD\FZ1001_v2_CURRENT"),
               ("MIS 3000", r"G:\My Drive\Flexee\Flexee-3000\MIS3000_v1_CURRENT"),
               ("MIS 4950", r"G:\My Drive\Flexee\FiveZero-4950\FZ1003_v1_CURRENT")]
    missing = [n for n, r in shelves if not os.path.isdir(os.path.join(r, "04_Chapters"))]
    if missing:
        print("      (skipped %s — packages not present)" % ", ".join(missing)); return

    for label, root in shelves:
        lane = os.path.join(root, "04_Chapters")
        figs = with_caption = repeats = 0
        for name in sorted(os.listdir(lane)):
            if not name.endswith(".zip"):
                continue
            with zipfile.ZipFile(os.path.join(lane, name)) as z:
                for f in z.namelist():
                    if not f.endswith(".md"):
                        continue
                    md = z.read(f).decode("utf-8", "replace")
                    for g in figure_alt.figures_in(md):
                        figs += 1
                        if g["title"]:
                            with_caption += 1
                    repeats += sum(1 for c, _ in figure_alt.alt_problems(md, 1)
                                   if c == "repeats the caption")
        print("      %-14s %3d figures, %3d with a caption, %d repeating it"
              % (label, figs, with_caption, repeats))
        # The check that matters: nowhere in any book does an alt text repeat its caption.
        assert repeats == 0, "%s has %d figure(s) whose alt text repeats its caption" % (label, repeats)
        # And the comparison is not vacuous for the two revised books.
        if label != "MIS 3000":
            assert with_caption > 0, "%s has no separate captions, so nothing was compared" % label


@t("an empty table header is found, and the pipes themselves are not mistaken for one")
def _():
    good = "| Stage | Who |\n|---|---|\n| Analysis | Analyst |\n"
    assert figure_alt.empty_table_headers(good, 6) == []

    bad = "| Stage | | Days |\n|---|---|---|\n| Analysis | x | 10 |\n"
    out = figure_alt.empty_table_headers(bad, 6)
    assert len(out) == 1 and "column 2 of 3" in out[0], out

    # the leading and trailing empties a pipe table's own syntax produces
    noborder = "Stage | Who\n--- | ---\nAnalysis | Analyst\n"
    assert figure_alt.empty_table_headers(noborder, 6) == []

    # a line of prose with a pipe in it is not a table
    prose = "Use a pipe | like this in text.\nAnd an ordinary next line.\n"
    assert figure_alt.empty_table_headers(prose, 6) == []

    trailing = "| Stage | Who | |\n|---|---|---|\n| Analysis | Analyst | x |\n"
    assert len(figure_alt.empty_table_headers(trailing, 6)) == 1, figure_alt.empty_table_headers(trailing, 6)


@t("the summary is per category, with a count and the first few")
def _():
    pairs = [("missing", "ch1 a.png"), ("missing", "ch1 b.png"), ("missing", "ch2 c.png"),
             ("missing", "ch2 d.png"), ("missing", "ch3 e.png"), ("number only", "ch4 f.png")]
    lines = figure_alt.summarise(pairs)
    assert len(lines) == 2, lines
    assert lines[0].startswith("missing alt text: 5 figures — ch1 a.png, ch1 b.png, ch2 c.png"), lines[0]
    assert lines[0].endswith("and 2 more"), lines[0]
    assert lines[1] == "number only alt text: 1 figure — ch4 f.png", lines[1]
    assert figure_alt.summarise([]) == []


@t("the two books in the repository are reported, and the report is a summary not a wall")
def _():
    # What the intake would say about the books as they stand today. This is the figure the change
    # note quotes, computed rather than copied.
    total = {}
    for book in ("sad", "mis3000"):
        pairs, ths, figs = [], [], 0
        root = os.path.join("content", book)
        for entry in sorted(os.listdir(root)):
            if not re.match(r"^ch\d+$", entry):
                continue
            md_path = os.path.join(root, entry, "content.md")
            if not os.path.exists(md_path):
                continue
            md = io.open(md_path, encoding="utf-8").read()
            chapter = entry[2:].lstrip("0") or "0"
            pairs += figure_alt.alt_problems(md, chapter)
            ths += figure_alt.empty_table_headers(md, chapter)
            figs += len(figure_alt.figures_in(md))
        lines = figure_alt.summarise(pairs)
        total[book] = (figs, len(pairs), len(ths))
        print("      %-8s %d figures; %s; %d empty table header(s)"
              % (book, figs, "; ".join(lines) or "no alt warnings", len(ths)))
        # decision 2: a summary, so the number of lines does not grow with the number of figures
        assert len(lines) <= 2, lines

    # The survey before the build found MIS 3000's 25 figures all warning and SAD's 48 clean.
    assert total["sad"][1] == 0, "SAD's alt text was clean in the survey: %r" % (total["sad"],)
    assert total["mis3000"][1] == total["mis3000"][0], \
        "every MIS 3000 figure's alt was number-only or missing: %r" % (total["mis3000"],)


print("\n%d checks passed" % passed)
