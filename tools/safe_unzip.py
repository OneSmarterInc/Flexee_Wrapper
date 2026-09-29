#!/usr/bin/env python3
"""Extract an uploaded book ZIP without links, traversal, or unbounded expansion."""
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

MAX_FILES = 5_000
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


def extract(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if not entries or len(entries) > MAX_FILES:
            raise ValueError("The zip is empty or has too many files.")
        seen: set[str] = set()
        total = 0
        checked = []
        for entry in entries:
            name = entry.filename
            if not name or name.startswith("/") or "\\" in name or "\0" in name:
                raise ValueError("The zip contains an unsafe path.")
            parts = PurePosixPath(name).parts
            if ".." in parts or (parts and ":" in parts[0]):
                raise ValueError("The zip contains an unsafe path.")
            relative = PurePosixPath(*[p for p in parts if p != "."])
            if str(relative) == "." or str(relative) in seen:
                raise ValueError("The zip contains a duplicate or empty path.")
            seen.add(str(relative))
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (entry.flag_bits & 1):
                raise ValueError("The zip contains a link, special file, or encrypted file.")
            if entry.is_dir() != (kind == stat.S_IFDIR) and kind != 0:
                raise ValueError("The zip has inconsistent file types.")
            if entry.file_size > MAX_FILE_BYTES:
                raise ValueError("A file in the zip is too large.")
            total += entry.file_size
            if total > MAX_TOTAL_BYTES:
                raise ValueError("The zip expands beyond 1 GB.")
            checked.append((entry, relative))

        destination.mkdir(parents=True, exist_ok=True)
        for entry, relative in checked:
            target = destination.joinpath(*relative.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)


if __name__ == "__main__":
    try:
        extract(Path(sys.argv[1]), Path(sys.argv[2]))
    except (IndexError, OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(f"Unsafe or unreadable book zip: {error}", file=sys.stderr)
        sys.exit(1)
