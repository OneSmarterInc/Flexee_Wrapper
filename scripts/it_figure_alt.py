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
