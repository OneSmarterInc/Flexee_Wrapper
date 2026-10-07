"""Spec 21 rules 2 and 3: what the intake reads off a chapter's figures and tables.

Kept beside the intake rather than inside it so the renderer's three rules have one place that
states them in Python and one suite that tests them:

  * the figure's **number** comes from the file name (``figN_M_…``), not from the alt text;
  * the **caption** comes from the markdown title attribute when the author wrote one;
  * a blockquote starting ``Long description:`` directly after the image is that figure's
    long description.

Everything here only reports. Nothing in this module can stop an intake: a figure with no alt text
is a fault in the book that the Books coordinator fixes, and holding the whole book back for it
would mean the chapter nobody can read at all is the one with no description either.
"""
import re

# ![alt](path "optional title")
IMAGE = re.compile(r"!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+\"([^\"]*)\")?\s*\)")
NUMBER_FROM_FILE = re.compile(r"^fig[-_]?(\d+)[-_](\d+)", re.I)
# "Figure 4.1", "Figure 4.1:", "Fig. 4.1" and nothing else
NUMBER_ONLY_ALT = re.compile(r"^\s*(?:figure|fig\.?)\s*\d+\.\d+\s*[:.]?\s*$", re.I)
LONG_DESCRIPTION = re.compile(r"^>\s*Long description:\s*(.*)$", re.I)

# Spec 26: a leading "Figure 4.1" / "Fig. 4.1" label and whatever punctuation follows it. Not
# anchored at the end, unlike NUMBER_ONLY_ALT, because here it is a prefix to be removed from a
# longer sentence rather than the whole of one.
LEADING_LABEL = re.compile(r"^\s*(?:figure|fig\.?|table)\s*\d+(?:\.\d+)?\s*[:.—-]*\s*", re.I)


def number_from_file_name(name):
    """``fig4_2_level0.png`` -> ``'4.2'``; a name with one number gives None.

    MIS 3000's ``fig-01.png`` is the case that gives nothing: there is no chapter in the name to
    build "N.M" from, and guessing one would mint an address a link could not be trusted to reach.
    """
    m = NUMBER_FROM_FILE.match(name.rsplit("/", 1)[-1])
    return "%d.%d" % (int(m.group(1)), int(m.group(2))) if m else None


def long_description_after(markdown, end):
    """The ``> Long description:`` blockquote that directly follows the image ending at ``end``.

    "Directly" means the next non-blank line, so a description belongs to the image above it and
    an ordinary quotation somewhere further down is never taken for one. Returns the text with the
    marker removed and the quote marks stripped, or None.
    """
    rest = markdown[end:].split("\n")
    i = 0
    if rest and not rest[0].strip():
        i = 1
    while i < len(rest) and not rest[i].strip():
        i += 1
    if i >= len(rest):
        return None
    head = LONG_DESCRIPTION.match(rest[i])
    if not head:
        return None
    lines = [head.group(1).strip()]
    i += 1
    while i < len(rest) and rest[i].startswith(">"):
        lines.append(rest[i].lstrip(">").strip())
        i += 1
    text = " ".join(l for l in lines if l).strip()
    return text or None


def figures_in(markdown):
    """Every image in a chapter, with what the convention reads off it.

    Each entry: ``file``, ``alt``, ``title`` (None when the author wrote none), ``description``
    (None when there is no long description) and ``number`` (None when the file name gives none).
    """
    out = []
    for m in IMAGE.finditer(markdown):
        alt, path, title = m.group(1), m.group(2), m.group(3)
        out.append({
            "file": path.rsplit("/", 1)[-1],
            "path": path,
            "alt": (alt or "").strip(),
            "title": (title or "").strip() or None,
            "description": long_description_after(markdown, m.end()),
            "number": number_from_file_name(path),
        })
    return out


def alt_problems(markdown, chapter):
    """The two figure-alt warnings, as ``(category, where)`` pairs.

    ``missing`` — no alt text at all, so a screen reader reads the file name or says "image".
    ``number only`` — alt text that is only "Figure N.M", which repeats the caption beside it and
    describes nothing.
    ``repeats the caption`` — alt text that says no more than the caption already says, so a screen
    reader reads the same sentence twice and the picture goes undescribed (Spec 26).
    """
    out = []
    for f in figures_in(markdown):
        where = "ch%s %s" % (chapter, f["file"])
        if not f["alt"]:
            out.append(("missing", where))
        elif NUMBER_ONLY_ALT.match(f["alt"]):
            out.append(("number only", "%s (alt is %r)" % (where, f["alt"])))
        elif alt_repeats_caption(f["alt"], f["title"]):
            # Spec 26. Named by figure number where the file name gives one, because that is what
            # the Books coordinator looks for in the chapter.
            which = "Figure %s" % f["number"] if f["number"] else f["file"]
            out.append(("repeats the caption", "ch%s %s" % (chapter, which)))
    return out


def empty_table_headers(markdown, chapter):
    """Header cells with nothing in them, in any markdown pipe table, for every book.

    An empty header cell is a column a screen reader cannot announce: reading a cell in the middle
    of the table, it has nothing to say the cell is *of*. Checked whatever the book's age, because
    it is an accessibility fault rather than a house-style one.

    A trailing or leading empty cell from the pipes themselves is not one: ``| a | b |`` splits to
    ``['', 'a', 'b', '']``, which is the syntax and not a column.
    """
    out = []
    lines = markdown.split("\n")
    for i, line in enumerate(lines):
        if "|" not in line or i + 1 >= len(lines):
            continue
        # a pipe table's header is the line above the --- separator
        if not re.match(r"^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$", lines[i + 1]) or "-" not in lines[i + 1]:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        for j, c in enumerate(cells):
            if not c:
                out.append("ch%s line %d: column %d of %d has an empty header"
                           % (chapter, i + 1, j + 1, len(cells)))
    return out


def summarise(pairs, first=3):
    """A line per category, with the count and the first few, as decision 2 asked for.

    One line per figure over three books is a wall nobody reads; a count per category with three
    examples is a thing the Books coordinator can act on.
    """
    by = {}
    for category, where in pairs:
        by.setdefault(category, []).append(where)
    lines = []
    for category in sorted(by):
        wheres = by[category]
        shown = ", ".join(wheres[:first])
        more = "" if len(wheres) <= first else ", and %d more" % (len(wheres) - first)
        lines.append("%s alt text: %d figure%s — %s%s"
                     % (category, len(wheres), "" if len(wheres) == 1 else "s", shown, more))
    return lines


# --------------------------------------------------- Spec 26: alt text that repeats the caption

def normalise_for_compare(text):
    """Both sides of the comparison, reduced to the words they actually carry.

    Lower-cased, with a leading "Figure N.M" label and its punctuation removed, trailing punctuation
    removed, and runs of whitespace collapsed. So these are all the same sentence:

        "Figure 4.1: Context diagram for the course registration system"
        "context diagram for the course   registration system."
        "Context Diagram for the Course Registration System"

    The point is that a reader hearing the alt text and then the caption should learn something the
    second time. Differing only in case or a full stop is not learning anything.
    """
    t = (text or "").strip().lower()
    t = LEADING_LABEL.sub("", t)
    t = re.sub(r"[\s ]+", " ", t).strip()
    return t.rstrip(" .,;:!?—-").strip()


def alt_repeats_caption(alt, caption):
    """True when the alt text says no more than the caption already says.

    False when there is no separate caption: in the old style the caption *comes from* the alt text,
    so the two are always equal and nothing is being repeated (rule 4). False, too, when both sides
    normalise to nothing — that is a number-only alt, which has its own warning, and reporting it
    twice would make one figure look like two problems.
    """
    if not caption:
        return False
    a = normalise_for_compare(alt)
    c = normalise_for_compare(caption)
    if not a or not c:
        return False
    return a == c


def caption_check_line(with_caption, repeats):
    """One line saying the comparison ran, whether or not it found anything.

    A report that prints only the categories it found leaves a reader unable to tell a check that
    passed from a check that is not there. This costs one line and removes the doubt.
    """
    if not with_caption:
        return ("alt text vs caption: no figure has a separate caption yet, so there is nothing to "
                "compare — see the figure authoring guide")
    n = with_caption
    if not repeats:
        return ("alt text vs caption: checked %d figure%s with captions, none repeated"
                % (n, "" if n == 1 else "s"))
    return ("alt text vs caption: checked %d figure%s with captions, %d repeated"
            % (n, "" if n == 1 else "s", repeats))
