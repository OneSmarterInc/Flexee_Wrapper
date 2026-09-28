# Wrapper change 4 — Intake reads the File | Bytes register layout

**27 September 2026** · Patch: `0004-intake-file-bytes-register.patch` · apply after 0001–0003

## Why

A book's register (`STATE_OF_RECORD.md`) lists every current file in its §0 table, and the intake
checks that table against the book's folders before admitting a book. The MIS 3250 register (v6.18,
marked READY FOR INTAKE) lists files with columns **Lane | File | Bytes | Status**, one row per file,
with each version inside the file name. The intake previously read versions only from a
**Version** column, so it would have found no chapters in that register and stopped — on a
correct book. `Book_Folder_Standard v1.2` now makes the File | Bytes layout the template for
every book.

## What changed (`tools/flexee_intake.py`)

- A row's version is taken from its file name (`…_v1.3.zip`) when the table has no Version column.
- A complete file name in the notes, decks and studio lanes is taken as-is.
- **When the register gives a file's size, the file in Drive must have exactly that size.** Any
  mismatch stops the intake, including for notes, decks and studio files.
  This catches a right-named file with the wrong content (e.g. an old version saved under a new name).
- Both layouts are read: Lane | File | Bytes | Status (MIS 3250, the standard) and
  Lane | Artifact | Version | Status (MIS 3000 register v1.7). Extra imprint rows (Series, Title) are ignored.

## Tests

`npm run test:intake` — 13 passed, including: the File | Bytes layout with Series and Title rows is
admitted with every size checked; a file one byte off its registered size stops the intake.
Checked by hand against the MIS 3250 register as Drive stores it: all 82 files matched, all twelve
chapter versions read from their file names.
