/**
 * Spec 22 §3: how a book id is shown.
 *
 * The stored id is lower-case everywhere — `content/<id>/`, `sections.book_id`, question ids, the
 * asset routes — and none of that changes. What changes is that an id shaped like a catalog number
 * is *displayed* in capitals, because that is how the catalog writes it and how the Books chat,
 * the register and the printed book all refer to it: FZ1003, not fz1003.
 *
 * Only catalog-shaped ids. `sad` and `mis3000` are shown exactly as they are stored — capitalising
 * them would invent a convention they do not follow and make "SAD" look like an acronym the book
 * does not use.
 *
 * No "server-only" here: a client component renders ids too (the upload form), and this is a pure
 * string function with no database and no secrets.
 */

/** Two letters and four digits, the Flexee Catalog Standard's form. */
const CATALOG_SHAPED = /^[a-z]{2}\d{4}$/;

export function isCatalogShaped(id: string) {
  return CATALOG_SHAPED.test(id);
}

/** The id as a reader should see it. */
export function displayBookId(id: string | null | undefined): string {
  const s = String(id ?? "");
  return CATALOG_SHAPED.test(s) ? s.toUpperCase() : s;
}

/**
 * Spec 22 §5: a file named `*.zip.zip`.
 *
 * It happens when the browser has already unzipped the download and the folder was zipped again,
 * which usually means the archive holds one folder containing the lanes rather than the lanes
 * themselves. Often it is still the right file, so this drives a warning and never a refusal.
 */
export function looksDoubleZipped(fileName: string | null | undefined) {
  return /[.]zip[.]zip$/i.test(String(fileName ?? ""));
}
