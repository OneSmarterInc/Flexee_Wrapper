# Intake report — sad

**Status: READY TO APPROVE**

Source: `local:/home/claude/sad_in`  
Register version: 4.2  
Run: 2026-09-24T22:07:01.214638+00:00

| Gate | Result | Detail |
|---|---|---|
| Register present | pass | STATE_OF_RECORD.md read |
| Register parseable | pass | register v4.2: 12 chapters, 48 figures |
| Register ↔ shelf versions | pass | all 12 chapters match the register |
| Chapter count | pass | 12 packages vs register 12 |
| Version integrity (content hash) | pass | no content changed under an unchanged version |
| Chapter conformance | pass | one markdown per package; every figure present, referenced and numbered to its chapter |
| Figure count | pass | 48 figures vs register 48 |
| Figure size (≤1500 px) | pass | all figures already within 1500 px |
| Spelling convention (American) | pass | no British spellings found |
| Phrasing (negative parallelism) | pass | ch2: Use cases, data flow diagrams, entity-relationship diagrams, interface designs, and test plans are not separate modeling exercises collected; ch4: It carries a number and a verb-phrase name, which is why "Student data" is not a process and "Validate registration" is. It is drawn as a ro; ch5: A grade is not a fact about the student, since the same student has different grades in different sections, and it is not a fact about the s; ch10: A column labeled "seats remaining" is not an attribute. It is a calculation, and the review question is whether the derivation is stated any; ch10: Four Levels, Four Kinds of Evidence The levels are not four degrees of thoroughness applied in sequence. They are four different kinds of ev; ch11: A load that completes without errors is not evidence that the migration was correct. It is evidence that nothing crashed, and those are diff |
| Decoupling (no simulation terms in the book) | pass | no simulation terms found |
| Imprint recorded in the register | pass | {"publisher": "Flexee Publishing", "author": "Vikram Sethi", "editor": "Chuck Nemer", "year": "2027"} |
| Front matter version | pass | v1.5 found; other versions also on the shelf (v1.4) — move to Archive |
| Imprint on the pages | pass | publisher, author, editor and year all match the register |
| Front matter entries | pass | 8 entries: title-page, dedication, copyright, preface, acknowledgments, how-to-use-this-book, a-note-for-instructors, figures |

Staged at `/home/claude/content/_staging/sad`. Run with `--approve` to admit it; the previous tree is archived, not deleted.
