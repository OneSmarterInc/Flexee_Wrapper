#!/usr/bin/env python3
"""
Flexee book intake — register-first, automated.

Reads a book's standard shelf (Drive folder in production, a local folder in testing),
resolves what the register calls CURRENT, runs every gate, stages a Wrapper content tree,
and writes a report. Nothing is typed by a person: versions come from filenames and the
register, integrity from content hashes, and the only human act is approving the staged
result (`--approve`).

  # production: read the shelf straight from Drive (service account with read access)
  python3 tools/flexee_intake.py --book-id sad --drive-folder <FOLDER_ID> \
      --credentials sa.json --out content

  # testing / fixtures: same pipeline, local files
  python3 tools/flexee_intake.py --book-id sad --local <dir-with-chapter-zips> \
      --register STATE_OF_RECORD.md --out content

  # after reviewing the report, admit the staged tree
  python3 tools/flexee_intake.py --book-id sad --out content --approve
"""
import argparse, hashlib, io, json, os, re, shutil, sys, zipfile
from datetime import datetime, timezone
from pathlib import Path

FIGURE_MAX_WIDTH = 1500

# Operating-system metadata files. Google Drive for Desktop writes desktop.ini into most folders it
# syncs, and Finder leaves .DS_Store and ._ resource forks; Windows leaves Thumbs.db. None of them is
# book content, none is ever listed in the register, and none should stop an intake. Matched on the
# file's own name, so this applies at any depth, and case-insensitively, because Windows and Drive
# are both inconsistent about capitalisation. Nothing else is ignored: an unlisted file that is not
# on this list still stops the intake, which is the whole point of the register-first gate.
_OS_METADATA_NAMES = {
    "desktop.ini",
    "thumbs.db",
    ".ds_store",
    "icon" + chr(13),  # classic Mac custom-icon file: the name ends in a carriage return
}

def is_os_metadata(name):
    """True for an operating-system metadata file, by its own name (not its path)."""
    n = str(name).lower()
    return n in _OS_METADATA_NAMES or n.startswith("._")

# ---------------------------------------------------------------- sources
class LocalSource:
    """A book shelf on disk: <root>/<lane>/... exactly as in Drive. Used for tests and fixtures."""
    def __init__(self, root, register_path=None):
        self.root = Path(root); self.register_path = register_path
    def register_text(self):
        if self.register_path: return Path(self.register_path).read_text(encoding="utf-8")
        p = self.root / "STATE_OF_RECORD.md"
        return p.read_text(encoding="utf-8") if p.exists() else None
    def _lane_dir(self, lane):
        d = self.root / lane
        if not d.exists() and lane == "04_Chapters" and any(self.root.glob("Chapter_*_Package_*.zip")):
            return self.root  # legacy flat fixture
        return d
    def list_lane(self, lane):
        """Every file in a lane, by path relative to the lane, skipping any Archive folder
        and any operating-system metadata file."""
        d = self._lane_dir(lane); out = {}
        if not d.exists(): return None
        for f in d.rglob("*"):
            rel = f.relative_to(d)
            if f.is_file() and not any(part.startswith("Archive") for part in rel.parts):
                if is_os_metadata(f.name): continue
                if d == self.root and not rel.name.startswith("Chapter_"): continue
                out[rel.as_posix()] = f.stat().st_size
        return out
    def read(self, lane, rel): return (self._lane_dir(lane) / rel).read_bytes()
    def fetch_tool(self, name): return None

class DriveSource:
    """Reads a book's shelf directly from Google Drive (API v3) with a service account that has read
    access to the book folder (and, for the shared tools, to Flexee_Standards). Everything is located
    by folder id under the book's own folder, never by a Drive-wide name search: two books' lanes
    carry the same names."""
    API = "https://www.googleapis.com/drive/v3"
    def __init__(self, folder_id, credentials_path, standards_folder=None):
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
        creds = service_account.Credentials.from_service_account_file(
            credentials_path, scopes=["https://www.googleapis.com/auth/drive.readonly"])
        creds.refresh(Request()); self.token = creds.token
        self.folder_id = folder_id; self.standards_folder = standards_folder; self._ids = {}
    def _get(self, url):
        import urllib.request
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(req) as r: return r.read()
    def _children(self, parent):
        import urllib.parse
        out, page = [], None
        while True:
            q = urllib.parse.quote(f"'{parent}' in parents and trashed=false")
            url = f"{self.API}/files?q={q}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=200"
            if page: url += f"&pageToken={page}"
            d = json.loads(self._get(url)); out += d.get("files", []); page = d.get("nextPageToken")
            if not page: return out
    def _by_name(self, parent, name):
        return next((f for f in self._children(parent) if f["name"] == name), None)
    def _download(self, fid): return self._get(f"{self.API}/files/{fid}?alt=media")
    def register_text(self):
        f = self._by_name(self.folder_id, "STATE_OF_RECORD.md")
        return self._download(f["id"]).decode("utf-8") if f else None
    def list_lane(self, lane):
        lane_f = self._by_name(self.folder_id, lane)
        if not lane_f: return None
        out = {}
        def walk(fid, prefix):
            for c in self._children(fid):
                if c["mimeType"] == "application/vnd.google-apps.folder":
                    if not c["name"].startswith("Archive"): walk(c["id"], prefix + c["name"] + "/")
                elif is_os_metadata(c["name"]):
                    continue  # Drive for Desktop syncs desktop.ini up into most lanes
                else:
                    rel = prefix + c["name"]; out[rel] = int(c.get("size", 0)); self._ids[(lane, rel)] = c["id"]
        walk(lane_f["id"], ""); return out
    def read(self, lane, rel):
        if (lane, rel) not in self._ids: self.list_lane(lane)
        return self._download(self._ids[(lane, rel)])
    def fetch_tool(self, name):
        if not self.standards_folder: return None
        tools = self._by_name(self.standards_folder, "Tools")
        f = tools and self._by_name(tools["id"], name)
        return self._download(f["id"]) if f else None

# ---------------------------------------------------------------- register
def clean(md):  # the Drive text export escapes markdown; normalize either form
    return md.replace("\\", "").replace("**", "")

# Spec 15: for comparing a register's Title and Subtitle with the words on the title page, where the
# two are written differently on purpose — the register bolds its values, the page sets the title as
# a heading, and either may carry curly quotes. Used by that check ONLY. Publisher, author, editor
# and year keep matching exactly as they always have, so this cannot change whether a book that
# passed before passes now.
_QUOTES = {ord(c): d for c, d in zip("‘’‚‛“”„‟",
                                     "''''" + '""""')}
def fold(s):
    """Case, whitespace, emphasis marks, backslashes and curly quotes, all folded away."""
    if not s: return ""
    s = str(s).translate(_QUOTES).replace("\\", "")
    s = re.sub(r"[*_]+", "", s)          # **bold**, *italic*, _underscores_
    return re.sub(r"\s+", " ", s).strip().lower()

INTAKE_LANES = {"00_Front_Matter", "04_Chapters", "07_Question_Banks"}  # what the Wrapper actually reads

def _nums(s):
    """'1, 2, 3, 5, 6' / '4, 7–12' / '1–7, 11' -> [1, 2, ...]"""
    out = []
    for part in re.split(r"\s*,\s*", s.strip()):
        m = re.match(r"^(\d+)\s*[–-]\s*(\d+)$", part)
        if m: out += list(range(int(m.group(1)), int(m.group(2)) + 1))
        elif part.isdigit(): out.append(int(part))
    return out

def _expected_files(lane, artifact, version, course):
    """What a section-0 row says should be in a lane, as filenames relative to the lane."""
    ticks = re.findall(r"`([^`]+)`", artifact)
    weeks = re.search(r"Weeks?\s+([\d,\s–-]+)", artifact)
    chaps = re.search(r"Chapters?\s+([\d,\s–-]+)", artifact)
    wk = _nums(weeks.group(1)) if weeks else []
    if lane == "04_Chapters" and chaps:
        return [f"Chapter_{n:02d}_Package_v{version}.zip" for n in _nums(chaps.group(1))]
    if lane in ("01_Speaker_Notes", "02_Lecture_Decks", "03_Studio_Packs"):
        ext = ".md" if lane == "01_Speaker_Notes" else ".pptx"
        kind = {"01_Speaker_Notes": "Notes", "02_Lecture_Decks": "Lecture", "03_Studio_Packs": "Studio"}[lane]
        base = ticks[0] if ticks else f"{course}_WeekNN_{kind}"
        if re.search(r"\.\w{2,5}$", base) and "NN" not in base:
            return [base]  # already a complete file name (File | Bytes layout)
        if "NN" in base:
            return [base.replace("NN", f"{w:02d}") + f"_v{version}{ext}" for w in wk]
        return [base + f"_v{version}{ext}"]
    if len(ticks) == 2 and re.match(r"^(?:[\w-]+/)?ch\d+$", ticks[0]) and re.match(r"^ch\d+_", ticks[1]):
        a = re.match(r"^((?:[\w-]+/)?)ch(\d+)$", ticks[0]); b = re.match(r"^ch(\d+)(_.+)$", ticks[1])
        return [f"{a.group(1)}ch{n:02d}{b.group(2)}" for n in range(int(a.group(2)), int(b.group(1)) + 1)]
    files = []
    for tk in ticks:
        if tk.startswith(".") and files: files.append(re.sub(r"\.[^.]+$", tk, files[-1]))
        else: files.append(tk)
    return files

def parse_register(text):
    t = clean(text)
    if "Current version of every artifact" not in t:
        return parse_register_legacy(text)
    r = {"raw_ok": True, "layout": "section-0 table"}
    m = re.search(r"Register version:\s*v?([\d.]+)", t); r["register_version"] = m.group(1) if m else None
    st = re.search(r"Intake status:\s*([A-Z][A-Z ]+)", t); r["intake_status"] = st.group(1).strip() if st else None
    bt = re.search(r"Built to:\s*(.+?)\s*$", t, re.M); r["built_to"] = re.sub(r"\s*\(.*$", "", bt.group(1)).strip() if bt else None
    first = next((l for l in t.splitlines() if l.startswith("#")), "")
    c = re.search(r"\b([A-Z]{2,5})\s?(\d{3,4})\b", first); r["course"] = (c.group(1) + c.group(2)) if c else None
    def cell(label):
        m = re.search(rf"^\|\s*{label}\s*\|\s*([^|]+?)\s*\|", t, re.M | re.I); return m.group(1).strip() if m else None
    ed = cell("Edition") or ""
    r["imprint"] = {"publisher": cell("Publisher"), "author": cell("Author"), "editor": cell("Editor"),
                    "year": (re.search(r"\d{4}", ed) or [None])[0]}
    # Spec 15: the book's own title, from the register's imprint table. The register is the only
    # source; nothing splits a title at a colon, so a subtitle is its own row or absent. Rows the
    # intake does not know about stay ignored, as before.
    r["title"] = cell("Title")
    r["subtitle"] = cell("Subtitle")
    r["series"] = cell("Series")
    def lead_int(v):  # "25 — counted in the packages…" -> 25
        m = re.match(r"\s*(\d[\d,]*)", v or ""); return int(m.group(1).replace(",", "")) if m else None
    r["chapter_count"] = lead_int(cell("Chapters"))
    r["figure_count"] = lead_int(cell("Figures"))
    bv = re.search(r"v?(\d+(?:\.\d+)+)", cell("Book version") or ""); r["book_version"] = bv.group(1) if bv else None
    body = t[t.index("Current version of every artifact"):]
    body = re.split(r"\n\s*---\s*\n|\n#{1,3} ", body)[0]
    rows, chap = [], {}
    for line in body.splitlines():
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("Lane", "") or set(cells[0]) <= set("-: "): continue
        lane = cells[0].strip("`"); artifact, vcell, status = cells[1], cells[2], cells[3]
        vm = re.search(r"v(\d+(?:\.\d+)*)", vcell); version = vm.group(1) if vm else None
        size = None
        if re.fullmatch(r"[\d,]+", vcell.replace("*", "").strip()):   # Lane | File | Bytes | Status layout
            size = int(vcell.replace("*", "").replace(",", "").strip())
        if not version:                                                # version lives in the file name
            fm = re.search(r"_v(\d+(?:\.\d+)+)\.[A-Za-z0-9]+`?\s*$", artifact.strip().strip("`"))
            if fm: version = fm.group(1)
        cnt = re.search(r"(\d+)\s+objectives", vcell + " " + status)
        has_ticks = "`" in artifact
        files = _expected_files(lane, artifact, version, r["course"]) if (version or has_ticks or lane == "07_Question_Banks") else []
        rows.append({"lane": lane, "artifact": artifact, "version": version, "status": status, "files": files,
                     "size": size if len(files) == 1 else None})
        if lane == "04_Chapters" and version:
            for f in files:
                n = int(re.match(r"Chapter_(\d+)_", f).group(1)); chap.setdefault(n, []).append(version)
        if lane == "00_Front_Matter" and version: r["front_matter_version"] = version
        if lane == "07_Question_Banks" and cnt: r["objective_count"] = int(cnt.group(1))
    r["rows"] = rows
    r["chapter_versions"] = {n: v[0] for n, v in chap.items()}
    r["chapter_conflicts"] = {n: v for n, v in chap.items() if len(v) > 1}
    if not rows or not r["chapter_versions"]: r["raw_ok"] = False
    return r

def reconcile(reg, src):
    """Every section-0 row against the book's own folders. Returns (stops, warnings, per-lane counts)."""
    stops, warns, seen = [], [], {}
    lanes = sorted({row["lane"] for row in reg["rows"]})
    for lane in lanes:
        listing = src.list_lane(lane)
        if listing is None: stops.append(f"{lane}: the register names this lane but the book folder has no such folder"); continue
        expected = [f for row in reg["rows"] if row["lane"] == lane for f in row["files"]]
        missing = [f for f in expected if f not in listing]
        extra = [f for f in listing if f not in expected]
        for f in missing: stops.append(f"{lane}: register lists `{f}`, not in Drive")
        for row in reg["rows"]:
            if row["lane"] != lane or row.get("size") is None or not row["files"]: continue
            f = row["files"][0]
            if f in listing and listing[f] != row["size"]:
                msg = f"{lane}: `{f}` is {listing[f]:,} bytes in Drive; the register says {row['size']:,}"
                stops.append(msg)
        for f in extra:
            if lane == "07_Question_Banks" and f.startswith("review/"): continue  # derived, regenerated
            (stops if lane in INTAKE_LANES else warns).append(f"{lane}: `{f}` is in Drive but not in the register")
        seen[lane] = (len(expected) - len(missing), len(expected))
    for n, vs in reg.get("chapter_conflicts", {}).items():
        stops.append(f"04_Chapters: the register gives chapter {n} two versions ({', '.join('v' + v for v in vs)})")
    return stops, warns, seen

def parse_register_legacy(text):
    t = clean(text); r = {"raw_ok": True}
    m = re.search(r"Register version:\s*([\d.]+)", t); r["register_version"] = m.group(1) if m else None
    st = re.search(r"Intake status:\s*([A-Z][A-Z ]+)", t); r["intake_status"] = st.group(1).strip() if st else None
    bt = re.search(r"Built to:\s*(.+?)\s*$", t, re.M); r["built_to"] = bt.group(1).strip() if bt else None
    m = re.search(r"Chapter packages\s*\|\s*v([\d.]+)(?:,\s*except chapters ([\d,\s]+?) at v([\d.]+))?", t)
    if not m: r["raw_ok"] = False; return r
    default, exc, excv = m.group(1), m.group(2), m.group(3)
    r["chapter_versions"] = {}
    m2 = re.search(r"(\w+) chapters,\s*([\d,]+) words,\s*(\d+) figures", t)
    words = {"twelve": 12, "eleven": 11, "ten": 10, "fourteen": 14, "thirteen": 13}
    r["chapter_count"] = words.get(m2.group(1).lower(), None) if m2 else None
    r["figure_count"] = int(m2.group(3)) if m2 else None
    for n in range(1, (r["chapter_count"] or 0) + 1): r["chapter_versions"][n] = default
    if exc:
        for n in re.findall(r"\d+", exc): r["chapter_versions"][int(n)] = excv
    fm = re.search(r"Front matter source\s*\|\s*v([\d.]+)", t); r["front_matter_version"] = fm.group(1) if fm else None
    bv = re.search(r"Current:\s*v([\d.]+)", t); r["book_version"] = bv.group(1) if bv else None
    m = re.search(r"Imprint standardi[sz]ed\.\s*(.+?)\s*—", t)
    pub = re.search(r"Imprint standardi[sz]ed\.\s*([A-Z][\w ]+?)\s+—", t)
    au = re.search(r"Author ([A-Z][a-z]+ [A-Z][a-z]+)", t)
    ed = re.search(r"editor ([A-Z][a-z]+ [A-Z][a-z]+)", t)
    yr = re.search(r"Edition year\s*(\d{4})", t)
    r["imprint"] = {"publisher": pub.group(1).strip() if pub else None,
                    "author": au.group(1) if au else None, "editor": ed.group(1) if ed else None,
                    "year": yr.group(1) if yr else None}
    return r

# ---------------------------------------------------------------- gates
BRITISH = [r"catalogue", r"modell(?:ing|ed|er|ers)", r"labell(?:ed|ing)", r"cancell(?:ed|ing)",
           r"licen[cs]e(?=\s+(?:wording|text|terms))", r"licence", r"behaviour\w*", r"colour\w*", r"favour\w*",
           r"centre\w*", r"programme\w*", r"defence", r"analys(?:e|ed|ing)", r"judgement",
           r"(?:organi|recogni|reali|prioriti|minimi|maximi|optimi|standardi|summari|utili|categori|characteri|"
           r"emphasi|finali|normali|authori|customi|formali|generali|initiali|locali|speciali|visuali|synchroni|"
           r"critici|capitali|moderni|memori|apologi)s(?:e|ed|es|ing|ation|ations)"]
BRITISH_RE = re.compile(r"\b(?:" + "|".join(BRITISH) + r")\b", re.I)
NEG_PARALLEL = re.compile(r"[^.!?]*\b(?:is|are|was|isn't|aren't) not\b[^.!?]{0,120}[.!?]\s+(?:It|This|That|They) (?:is|are|'s)\b[^.!?]*[.!?]")
SIM_LEAK = re.compile(r"\b(?:MVCFN|food[- ]bank|Studio Pack|hidden spec)\b", re.I)

def sha(b): return hashlib.sha256(b).hexdigest()

def run(args):
    out = Path(args.out); book = args.book_id
    stage = out / "_staging" / book
    report = {"book": book, "startedAt": datetime.now(timezone.utc).isoformat(), "gates": [], "stop": False}
    def gate(name, ok, detail, level="fail"):
        report["gates"].append({"gate": name, "ok": ok, "level": level if not ok else "pass", "detail": detail})
        if not ok and level == "fail": report["stop"] = True

    src = (DriveSource(args.drive_folder, args.credentials, args.standards_folder) if args.drive_folder
           else LocalSource(args.local, args.register))
    report["source"] = f"drive:{args.drive_folder}" if args.drive_folder else f"local:{args.local}"

    # 1 — register first
    reg_text = src.register_text()
    gate("Register present", bool(reg_text), "STATE_OF_RECORD.md read" if reg_text else "no register on the shelf")
    reg = parse_register(reg_text) if reg_text else {"raw_ok": False}
    gate("Register parseable", reg.get("raw_ok", False),
         f"register v{reg.get('register_version')}: {reg.get('chapter_count')} chapters, {reg.get('figure_count')} figures"
         if reg.get("raw_ok") else "could not read the chapter-package version row")
    report["register"] = reg
    gate("Book declared ready", reg.get("intake_status") == "READY FOR INTAKE",
         "register says READY FOR INTAKE" if reg.get("intake_status") == "READY FOR INTAKE"
         else f"register intake status is '{reg.get('intake_status') or 'missing'}' — the book chat must finish all corrections and set 'Intake status: READY FOR INTAKE' first")
    gate("Standard followed", bool(reg.get("built_to")),
         reg.get("built_to") or "register does not say which Flexee Book Standard version it follows ('Built to:')", "warn")
    if report["stop"]: return finish(report, out, book)

    # 1b — the register against Drive, every section-0 entry, by folder
    if reg.get("rows"):
        stops, warns, seen = reconcile(reg, src)
        total = sum(v[1] for v in seen.values()); present = sum(v[0] for v in seen.values())
        gate("Register ↔ Drive, every entry", not stops,
             stops or f"all {total} files the register lists are in Drive, in the lanes it names ({len(seen)} lanes)")
        if warns: gate("Files in Drive the register doesn't list (outside the intake lanes)", False, warns, "warn")
        if report["stop"]: return finish(report, out, book)

    # 2 — resolve CURRENT versions against filenames
    chap_list = src.list_lane("04_Chapters") or {}
    pkgs = {n: src.read("04_Chapters", n) for n in chap_list if re.match(r"Chapter_\d+_Package_v[\d.]+\.zip$", n)}
    found = {}
    for name, data in pkgs.items():
        m = re.match(r"Chapter_(\d+)_Package_v([\d.]+)\.zip$", name); n, v = int(m.group(1)), m.group(2)
        found.setdefault(n, []).append((v, name, data))
    exp = reg["chapter_versions"]; problems = []
    for n, v in exp.items():
        have = found.get(n, [])
        if not have: problems.append(f"ch{n}: register says v{v}, no package on the shelf")
        elif len(have) > 1: problems.append(f"ch{n}: {len(have)} versions present ({', '.join(x[0] for x in have)}) — superseded copies belong in Archive")
        elif have[0][0] != v: problems.append(f"ch{n}: register says v{v}, shelf has v{have[0][0]}")
    extra = [n for n in found if n not in exp]
    if extra: problems.append(f"packages not in the register: chapters {extra}")
    gate("Register ↔ shelf versions", not problems, problems or f"all {len(exp)} chapters match the register")
    gate("Chapter count", len(pkgs) == reg["chapter_count"], f"{len(pkgs)} packages vs register {reg['chapter_count']}")

    # 3 — integrity against the last admitted lock
    lock_path = out / book / "intake.lock.json"
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else {"files": {}}
    drift = []
    for n, lst in found.items():
        v, name, data = lst[0]; prev = lock["files"].get(f"ch{n:02d}")
        if prev and prev["version"] == v and prev["sha256"] != sha(data):
            drift.append(f"ch{n}: content changed but version still v{v} — bump the version")
    gate("Version integrity (content hash)", not drift,
         drift or ("first admission — hashes recorded" if not lock["files"] else "no content changed under an unchanged version"))
    if report["stop"]: return finish(report, out, book)

    # 4 — unpack, conform, figures, text checks; stage the tree
    if stage.exists(): shutil.rmtree(stage)
    stage.mkdir(parents=True)
    conform, fig_notes, brit, negpar, leaks = [], [], [], [], []
    total_figs = 0; saved = 0; spine = []; lock_files = {}
    for n in sorted(found):
        v, name, data = found[n][0]; eid = f"ch{n:02d}"
        z = zipfile.ZipFile(io.BytesIO(data))
        mds = [f for f in z.namelist() if f.endswith(".md")]
        pngs = {os.path.basename(f): f for f in z.namelist() if f.lower().endswith(".png")}
        if len(mds) != 1: conform.append(f"ch{n}: {len(mds)} markdown files (expected 1)"); continue
        md = z.read(mds[0]).decode("utf-8")
        h1 = re.search(r"^# CHAPTER (\d+):\s*(.+)$", md, re.M)
        if not h1 or int(h1.group(1)) != n: conform.append(f"ch{n}: heading does not read '# CHAPTER {n}: …'")
        refs = re.findall(r"!\[([^\]]*)\]\(([^)]+)\)", md)
        refnames = [os.path.basename(r[1]) for r in refs]
        miss = [r for r in refnames if r not in pngs]; unref = [p for p in pngs if p not in refnames]
        wrong = [r for r in refnames if not re.match(rf"fig{n}_\d+", r)]
        if miss: conform.append(f"ch{n}: figures referenced but missing {miss}")
        if unref: conform.append(f"ch{n}: figures present but unreferenced {unref}")
        if wrong: conform.append(f"ch{n}: figure numbering does not match chapter {wrong}")
        # text checks (report-level)
        for mt in BRITISH_RE.finditer(md): brit.append(f"ch{n}: '{mt.group(0)}'")
        for mt in NEG_PARALLEL.finditer(re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", md)): negpar.append(f"ch{n}: " + re.sub(r"\s+", " ", mt.group(0)).strip()[:140])
        for mt in SIM_LEAK.finditer(md): leaks.append(f"ch{n}: '{mt.group(0)}'")
        # stage entry
        d = stage / eid; (d / "figures").mkdir(parents=True)
        figures = []
        for i, (alt, path) in enumerate(refs, 1):
            fn = os.path.basename(path); raw = z.read(pngs[fn]) if fn in pngs else None
            if raw is None: continue
            from PIL import Image
            im = Image.open(io.BytesIO(raw)); w, hgt = im.size
            if w > FIGURE_MAX_WIDTH:
                im = im.resize((FIGURE_MAX_WIDTH, round(hgt * FIGURE_MAX_WIDTH / w)), Image.LANCZOS)
                buf = io.BytesIO(); im.save(buf, "PNG", optimize=True); newb = buf.getvalue()
                fig_notes.append(f"ch{n} {fn}: {w}px → {FIGURE_MAX_WIDTH}px, {len(raw)//1024} KB → {len(newb)//1024} KB")
                saved += len(raw) - len(newb); raw = newb
            (d / "figures" / fn).write_bytes(raw); total_figs += 1
            cap = re.sub(r"^Figure\s+", "", alt).strip()
            num = re.match(r"(\d+\.\d+)", cap); cap_text = re.sub(r"^\d+\.\d+:\s*", "", cap)
            figures.append({"id": f"fig-{book}-c{n:02d}-{i:02d}", "kind": "image", "status": "final",
                            "src": f"figures/{fn}", "alt": alt, "caption": alt, "number": num.group(1) if num else f"{n}.{i}"})
        body = re.sub(r"(!\[[^\]]*\]\()(?:\./)?([^)/]+\.png)\)", r"\1figures/\2)", md)
        if not body.endswith("\n"): body += "\n"
        (d / "content.md").write_text(body, encoding="utf-8")
        sections = [{"id": f"c{n}s{j}", "title": re.sub(r"^\d+\.\s*", "", h).strip()}
                    for j, h in enumerate(re.findall(r"^### (.+)$", md, re.M), 1)]
        man = {"schemaVersion": 2, "id": eid, "book": book, "kind": "chapter", "number": n, "label": str(n),
               "title": h1.group(2).strip() if h1 else f"Chapter {n}", "version": 1, "sourceVersion": f"v{v}",
               "contentHash": "sha256:" + sha(body.encode())[:16], "content": "content.md",
               "sections": sections, "figures": figures}
        (d / "manifest.json").write_text(json.dumps(man, indent=2, ensure_ascii=False), encoding="utf-8")
        spine.append({"ref": eid, "kind": "chapter"}); lock_files[eid] = {"package": name, "version": v, "sha256": sha(data)}

    gate("Chapter conformance", not conform, conform or "one markdown per package; every figure present, referenced and numbered to its chapter")
    gate("Figure count", total_figs == reg["figure_count"], f"{total_figs} figures vs register {reg['figure_count']}")
    gate("Figure size (≤1500 px)", True, fig_notes or "all figures already within 1500 px", "pass")
    gate("Spelling convention (American)", not brit, brit or "no British spellings found", "warn")
    gate("Phrasing (negative parallelism)", True, negpar or "none found", "pass")
    gate("Decoupling (no simulation terms in the book)", not leaks, leaks or "no simulation terms found", "warn")

    imp = reg.get("imprint", {})
    gate("Imprint recorded in the register", all(imp.values()), imp)
    # Spec 15: a missing Title is a warning, never a stop. The book still goes in; it shows its id
    # until the register gains the row.
    if reg.get("title"):
        gate("Title recorded in the register", True,
             reg["title"] + (f": {reg['subtitle']}" if reg.get("subtitle") else "")
             + (f" · {reg['series']}" if reg.get("series") else ""))
    else:
        gate("Title recorded in the register", False,
             f"the register has no Title row; the book will show its id ({book.upper()})", "warn")
    fm_list = src.list_lane("00_Front_Matter") or {}
    fm_files = {n: src.read("00_Front_Matter", n) for n in fm_list if re.match(r"Book_Front_Matter_v[\d.]+\.md$", n)}
    fm_entries = []
    want = reg.get("front_matter_version")
    fm_v = {re.search(r"_v([\d.]+)\.md$", k).group(1): (k, v) for k, v in fm_files.items()}
    if not want:
        gate("Front matter", False, "register does not name a front matter version", "warn")
    elif want not in fm_v:
        gate("Front matter version", False, f"register says v{want}; shelf has {sorted(fm_v) or 'none'}")
    else:
        fname, fbytes = fm_v[want]
        stale = [f"v{k}" for k in fm_v if k != want]
        gate("Front matter version", True, f"v{want} found" + (f"; other versions also on the shelf ({', '.join(stale)}) — move to Archive" if stale else ""))
        prev = lock["files"].get("front-matter")
        if prev and prev["version"] == want and prev["sha256"] != sha(fbytes):
            gate("Version integrity (front matter)", False, f"front matter changed but version still v{want} — bump the version")
        fm = fbytes.decode("utf-8")
        probs = []
        if imp.get("publisher") and imp["publisher"] not in fm: probs.append(f"publisher '{imp['publisher']}' not found")
        if "Flexee Publishers" in fm: probs.append("still says 'Flexee Publishers'")
        for k in ("author", "editor", "year"):
            if imp.get(k) and imp[k] not in fm: probs.append(f"{k} '{imp[k]}' not found")
        gate("Imprint on the pages", not probs, probs or "publisher, author, editor and year all match the register")

        # Spec 15: the register's Title, and Subtitle when given, must be on the title page. Folded
        # on both sides, because the register bolds its values and the page sets the title as a
        # heading. A missing title stops the intake, as a wrong publisher does. Skipped entirely
        # when the register names no Title — that case warns on its own, below.
        if reg.get("title"):
            folded = fold(fm)
            missing = [f"{label} '{val}' is not on the title page"
                       for label, val in (("Title", reg.get("title")), ("Subtitle", reg.get("subtitle")))
                       if val and fold(val) not in folded]
            gate("Title on the pages", not missing,
                 missing or f"the title page states the register's title" + (" and subtitle" if reg.get("subtitle") else ""))
        vs = re.search(r"\*\*Version ([\d.]+)\*\*", fm)
        if vs and reg.get("book_version") and vs.group(1) != reg["book_version"]:
            gate("Version stated on copyright page", False, f"page says Version {vs.group(1)}; register says the book is v{reg['book_version']}", "warn")
        fbrit = [f"front matter: '{m.group(0)}'" for m in BRITISH_RE.finditer(fm)]
        if fbrit: gate("Spelling convention (front matter)", False, fbrit, "warn")
        # split into entries: title block, then one entry per "## " heading
        parts = re.split(r"^## (.+)$", fm, flags=re.M)
        def tidy(s): return re.sub(r"^(?:\s*---\s*\n)+|(?:\n\s*---\s*)+\s*$", "", s.strip()).strip() + "\n"
        title_block = tidy(parts[0]); h1 = re.search(r"^# (.+)$", title_block, re.M)
        chunks = [("title-page", h1.group(1).strip() if h1 else "Title page", title_block)]
        for i in range(1, len(parts), 2):
            head = parts[i].strip(); slug = re.sub(r"[^a-z0-9]+", "-", head.lower()).strip("-")
            chunks.append((slug, head, "## " + head + "\n\n" + tidy(parts[i + 1])))
        for slug, head, body in chunks:
            d = stage / slug; d.mkdir(parents=True)
            (d / "content.md").write_text(body, encoding="utf-8")
            (d / "manifest.json").write_text(json.dumps({"schemaVersion": 2, "id": slug, "book": book, "kind": "front",
                "number": None, "label": None, "title": head, "version": 1, "sourceVersion": f"v{want}",
                "contentHash": "sha256:" + sha(body.encode())[:16], "content": "content.md", "sections": [], "figures": []},
                indent=2, ensure_ascii=False), encoding="utf-8")
            fm_entries.append({"ref": slug, "kind": "front"})
        lock_files["front-matter"] = {"file": fname, "version": want, "sha256": sha(fbytes)}
        gate("Front matter entries", True, f"{len(fm_entries)} entries: " + ", ".join(e['ref'] for e in fm_entries))
    spine = fm_entries + spine

    # 5 — the question bank: validated by the shared validator, staged for loading
    qb_list = src.list_lane("07_Question_Banks")
    if qb_list is None:
        gate("Question bank", False, "no 07_Question_Banks folder — this book has no bank yet", "warn")
    else:
        import subprocess, tempfile
        bank_files = [f for f in qb_list if f == "objectives.json" or re.match(r"questions/ch\d+\.json$", f)]
        tool = Path(args.validator).read_bytes() if args.validator else src.fetch_tool("build_questions.py")
        if not tool:
            gate("Question bank validation", False, "no validator — pass --validator, or --standards-folder to fetch it from Flexee_Standards/Tools")
        else:
            with tempfile.TemporaryDirectory() as td:
                qb = Path(td) / "qb"; (qb / "questions").mkdir(parents=True)
                for f in bank_files:
                    data = src.read("07_Question_Banks", f); (qb / f).write_bytes(data)
                    lock_files[f"bank:{f}"] = {"file": f, "sha256": sha(data)}
                (Path(td) / "build_questions.py").write_bytes(tool)
                res = subprocess.run([sys.executable, str(Path(td) / "build_questions.py"), "--src", str(qb), "--book-id", book,
                                      "--require-meta", "--fail-on-warnings", "--out", str(stage)],
                                     capture_output=True, text=True)
            outtxt = res.stdout + res.stderr
            summary = next((l.strip() for l in outtxt.splitlines() if l.startswith("validated:")), "")
            errors = [l.strip()[2:] for l in outtxt.splitlines() if l.strip().startswith("- ")]
            gate("Question bank validation (shared validator, exit code read directly)", res.returncode == 0,
                 summary if res.returncode == 0 else (errors[:12] or [f"validator exit code {res.returncode}"]))
            if res.returncode == 0:
                objs = json.loads((stage / "objectives.json").read_text()) if (stage / "objectives.json").exists() else []
                qs = json.loads((stage / "questions.json").read_text())
                approved = sum(1 for q in qs if (q.get("review") or {}).get("status") == "approved")
                drafts = len(qs) - approved
                want = reg.get("objective_count")
                gate("Objectives match the register", want is None or want == len(objs),
                     f"{len(objs)} objectives" + (f" vs register {want}" if want is not None else " (register states no count)"))
                chapters_in_bank = sorted({q["chapter"] for q in qs})
                gate("Every chapter has questions", chapters_in_bank == list(range(1, (reg.get("chapter_count") or 0) + 1)),
                     f"questions for chapters {chapters_in_bank}")
                gate("Questions approved for students", drafts == 0,
                     f"{approved} approved" + (f", {drafts} still draft — drafts are loaded but never served" if drafts else ""), "warn")

    meta = f"{imp.get('author')} · {imp.get('publisher')} · First edition {imp.get('year')}"
    # Spec 15: the register is the only source of the title. The previous manifest's title and
    # subtitle used to be carried forward here, because nothing else supplied them — but that never
    # fired in the Library job, which builds in a fresh temp directory, so every book fell back to
    # its id in capitals. Carrying it forward would also let an old value outlive the register.
    bm = {"schemaVersion": 2, "id": book,
          "title": reg.get("title") or book.upper(),       # no Title row: the id, with a warning above
          "subtitle": reg.get("subtitle"),
          "series": reg.get("series"),
          "meta": meta, "copyright": imp.get("publisher"), "license": "read-only",
          "defaultEntry": spine[0]["ref"] if spine else None, "spine": spine,
          "admittedFromRegister": reg.get("register_version")}
    (stage / "book.manifest.json").write_text(json.dumps(bm, indent=2, ensure_ascii=False), encoding="utf-8")
    (stage / "intake.lock.json").write_text(json.dumps({"registerVersion": reg.get("register_version"),
        "stagedAt": report["startedAt"], "source": report["source"], "files": lock_files}, indent=2), encoding="utf-8")
    report["staged"] = str(stage); report["figuresBytesSaved"] = saved
    return finish(report, out, book)

def finish(report, out, book):
    out.mkdir(parents=True, exist_ok=True)
    status = "STOPPED — nothing staged for admission" if report["stop"] else "READY TO APPROVE"
    lines = [f"# Intake report — {book}", "", f"**Status: {status}**", "",
             f"Source: `{report.get('source')}`  ", f"Register version: {report.get('register', {}).get('register_version')}  ",
             f"Run: {report['startedAt']}", "", "| Gate | Result | Detail |", "|---|---|---|"]
    for g in report["gates"]:
        res = "pass" if g["ok"] else ("**STOP**" if g["level"] == "fail" else "warning")
        det = g["detail"]; det = "; ".join(det) if isinstance(det, list) else (json.dumps(det) if isinstance(det, dict) else det)
        lines.append(f"| {g['gate']} | {res} | {det} |")
    if not report["stop"]:
        lines += ["", f"Staged at `{report['staged']}`. Run with `--approve` to admit it; the previous tree is archived, not deleted."]
    p = out / f"_intake_report_{book}.md"; p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines)); return 1 if report["stop"] else 0

def approve(args):
    out = Path(args.out); book = args.book_id; stage = out / "_staging" / book; live = out / book
    if not stage.exists(): raise SystemExit("Nothing staged — run an intake first")
    if live.exists():
        arch = out / "_archive" / f"{book}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        arch.parent.mkdir(parents=True, exist_ok=True); shutil.move(str(live), str(arch)); print(f"archived previous tree → {arch}")
    shutil.move(str(stage), str(live)); print(f"admitted {book} → {live}")
    print("next: npm run db:sync-content && npm run db:sync-questions")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--book-id", required=True); ap.add_argument("--out", default="content")
    ap.add_argument("--drive-folder"); ap.add_argument("--credentials")
    ap.add_argument("--local"); ap.add_argument("--register"); ap.add_argument("--approve", action="store_true")
    ap.add_argument("--standards-folder", help="Drive id of Flexee_Standards, to fetch the shared validator")
    ap.add_argument("--validator", help="path to build_questions.py (testing)")
    a = ap.parse_args()
    if a.approve: approve(a)
    else:
        if not (a.drive_folder or a.local): raise SystemExit("give --drive-folder (production) or --local (testing)")
        sys.exit(run(a))
