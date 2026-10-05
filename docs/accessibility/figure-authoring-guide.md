# Writing a figure so a screen reader can describe it

The convention built in Spec 21. It is **additive**: a chapter written the old way renders exactly
as it did before, so there is no deadline and no re-upload. Use it on new and revised chapters.

## The three places text goes

```markdown
![what the picture shows](figures/fig4_1_context.png "Figure 4.1: Context diagram for the course registration system")

> Long description: One process box sits in the middle. Three external entities send data in:
> Student sends a course request, Advisor sends an approval, Bursar sends a payment status.
> One data store, Transcript, receives the enrolment record.
```

| | What it is for | Who reads it |
|---|---|---|
| **alt** — the square brackets | What is *in* the picture, in one sentence. Not the number. Not the caption. | Read aloud in place of the image |
| **title** — the quoted string | The caption printed under the figure, word for word | Everyone, on screen |
| **`> Long description:`** | The detail a sighted reader gets from looking: what connects to what, what the trend is | Anyone who opens the "Description" collapsible |

**The number comes from the file name, not from the text.** `fig4_1_context.png` is Figure 4.1; the
address `#fig-4-1` is built from it, and in-text mentions of "Figure 4.1" become links to it. Keep
the `figN_M_name.png` form. A file name with only one number in it — `fig-01.png` — gives no number
at all, so the figure cannot be linked to.

**You write the `Figure N.M:` prefix yourself.** The renderer prints the caption exactly as you type
it; it adds nothing. The "Figures and tables" panel strips the prefix so the number is not shown
twice, which is why `Figure 4.1:` and `Figure 4.1 —` both work.

The `> Long description:` blockquote must be the **next thing after the image**, with only a blank
line between. It becomes a collapsible headed "Description", openable from the keyboard. A
blockquote anywhere else stays an ordinary quotation.

## The worked example, as it renders

SAD chapter 4's first figure, written to the convention, produces:

```html
<figure class="fx-figure" id="fig-4-1" tabindex="-1">
  <img src="…/figures/fig4_1_context.png"
       alt="A rounded rectangle labelled Registration System, with three arrows in from Student,
            Advisor and Bursar, and one arrow out to Transcript." loading="lazy">
  <figcaption>Figure 4.1: Context diagram for the course registration system</figcaption>
  <details class="fx-longdesc"><summary>Description</summary><p>One process box sits in the
    middle. …</p></details>
</figure>
```

A screen reader says the alt text, then the caption, then offers "Description, collapsed". Today
SAD's alt text *is* the caption, so it is read twice and says nothing about the diagram — that is
the thing this fixes.

## An old-style figure still works

`![Figure 4.1: Context diagram for the course registration system](figures/fig4_1_context.png)` with
no quoted string renders **identically to before**: that text becomes the caption, and it stays the
alt text too. A golden test holds all 74 figures of all three books byte for byte, so nothing moves
until you change it. The only difference is that the intake now says so.

## What the intake says

All three are **warnings. None of them can stop an intake or hold a book back.**

| Gate | When a book is clean | When it is not — the exact wording |
|---|---|---|
| Figure alt text | `48 figures, every one with alt text that says more than its number` | `missing alt text: 1 figure — ch1 fig1_1_a.png`<br>`number only alt text: 3 figures — ch1 fig1_2_b.png (alt is 'Figure 1.2'), ch1 fig1_3_c.png (alt is 'Figure 1.3:'), ch1 fig1_4_d.png (alt is 'Fig. 1.4'), and 2 more` |
| Table header cells | `no empty header cells in any table` | `ch4 line 63: column 1 of 3 has an empty header` |
| Figure descriptions | *(only appears once a chapter uses the convention)* | `3 figure(s) carry a caption in the title attribute, 2 carry a long description` |

"Number only" means alt text that is nothing but `Figure 1.2`, `Figure 1.2:`, `Fig. 1.4` or the
like. `Figure 1.6: a clerk sending work back` is not a warning — it has real words after the number.
Each category is summarised with a count and the first three figures, so the report stays readable
however many there are.

---

# SAD's seven empty table header cells

Five tables, four chapters. Each is a column a screen reader cannot announce: reading a cell in the
middle of the table, it has nothing to say the cell is *of*.

Four of the five are the same shape — a comparison table whose **top-left corner cell is empty**
while the first column holds the row labels. The fix is a word in the corner: `Aspect`, `Dimension`,
`Compared on`, whatever reads best.

| Chapter | Line | Under | The header row as written |
|---|---|---|---|
| ch04 | 63 | `### 4. Physical and Logical Models` | `\| \| Physical DFD \| Logical DFD \|` |
| ch05 | 143 | `### 7. Two Routes to One Model` | `\| \| ERD \| Normalization \|` |
| ch06 | 141 | `### 9. Choosing Between an Interface and a Report` | `\| \| User interface \| Report \|` |
| ch07 | 21 | `### 1. Three Paths, Three Kinds of Responsibility` | `\| \| Custom build \| Commercial package \| Outsource \|` |

**The fifth is different** — ch06 line 84, under `### 5. Reports Answer Questions`. Three of the
seven cells are here:

```markdown
| MIS 3250 — Section 001 |  |  |  |
| :--- | :--- | :--- | :--- |
| **Student** | **ID** | **Status** | **Grade** |
```

The first row is being used as a **title banner**, so the real header row — Student, ID, Status,
Grade — is read as ordinary data and the table has no headers at all. Move
`MIS 3250 — Section 001` into the table's caption line and let Student / ID / Status / Grade be the
header row.

---

# MIS 3000's sixteen figures

Every one of MIS 3000's sixteen images has alt text that is only `Figure N.M`. A screen reader user
hears the number they can already see and nothing about the picture. The caption beside it already
carries the number and the point, so the alt text is pure duplication.

The manifest's captions are good — "Three scales of change. The question changes with the scale: how
a firm works, where an industry ends, and what a society takes for granted." — so what is needed is
the **alt** text: one sentence saying what is drawn. The convention above is how to supply it, and
the long description is where the rest belongs.

Its file names are `fig-01.png`, `fig-02.png`, which carry no chapter number, so those figures have
no address and cannot be linked to from the prose. Renaming them to `figN_M_name.png` on the next
revision would fix that; nothing breaks if they stay as they are.

SAD's 48 figures and MIS 4950's 10 are clean on alt text.
