import Link from "next/link";
import { getToc } from "@/lib/content";

export default async function Spine({ bookId, current }: { bookId: string; current?: string }) {
  const { book, items } = await getToc(bookId);
  return (
    <nav className="spine ui" aria-label="Table of contents">
      <Link href={`/${bookId}`} style={{ textDecoration: "none" }}>
        <p className="book-title">{book.title}</p>
      </Link>
      <p className="book-sub">{book.subtitle ?? ""}</p>
      <ol>
        {items.map((it) => (
          <li key={it.ref}>
            <Link href={`/${bookId}/${it.ref}`} aria-current={it.ref === current ? "page" : undefined}>
              {it.kind === "chapter" && it.number != null && <span className="num">{it.number}</span>}
              {it.title}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
