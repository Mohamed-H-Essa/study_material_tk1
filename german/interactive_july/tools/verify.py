#!/usr/bin/env python3
"""Project-wide checks from CLAUDE.md step 6, run after every content batch.

  - every local href resolves to a file that exists
  - <title>/<h1> display numbers agree with lessons.js and run 1..N
  - each lesson file's PAGE slug matches its catalogue slug, and slugs are unique
  - every trainer mount div has a matching trainer id (and vice versa)
  - the two sync lines are present, in order, BEFORE _engine.js
  - the inline PAGE script is valid JS
  - every noun row in a vocab table shows a plural (or is marked kein/nur Plural)
"""
import glob, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fail = []


def err(f, msg):
    fail.append("%s: %s" % (f, msg))


def catalogue():
    out = subprocess.check_output(
        ["node", "-e",
         "global.window={};require('%s');process.stdout.write(JSON.stringify(window.LESSONS))"
         % os.path.join(ROOT, "lessons.js")], text=True)
    return json.loads(out)


CAT = catalogue()
BY_FILE = {v["file"]: v for v in CAT}

os.chdir(ROOT)
html_files = sorted(glob.glob("*.html"))

# --- 1. links resolve -------------------------------------------------------
for f in html_files:
    s = open(f, encoding="utf-8").read()
    for href in re.findall(r'href="([^"#?:]+\.html)"', s):
        if not os.path.exists(href):
            err(f, "broken link -> %s" % href)

# --- 2. numbering / titles --------------------------------------------------
ns = sorted(v["n"] for v in CAT)
if ns != list(range(1, len(CAT) + 1)):
    fail.append("lessons.js: n is not a contiguous 1..N sequence")
for f, v in BY_FILE.items():
    if not os.path.exists(f):
        fail.append("lessons.js: file missing on disk -> %s" % f)
        continue
    s = open(f, encoding="utf-8").read()
    m = re.search(r"<title>(\d+) · ", s)
    if not m or int(m.group(1)) != v["n"]:
        err(f, "title number != catalogue n (%s)" % v["n"])
    m = re.search(r"<h1>(\d+) · ", s)
    if not m or int(m.group(1)) != v["n"]:
        err(f, "h1 number != catalogue n (%s)" % v["n"])

# --- 3. slugs ---------------------------------------------------------------
slugs = [v["slug"] for v in CAT]
dups = {s for s in slugs if slugs.count(s) > 1}
if dups:
    fail.append("lessons.js: duplicate slugs %s" % sorted(dups))
ids = [v["id"] for v in CAT]
dups = {i for i in ids if ids.count(i) > 1}
if dups:
    fail.append("lessons.js: duplicate video ids %s" % sorted(dups))

for f, v in BY_FILE.items():
    if not os.path.exists(f):
        continue
    s = open(f, encoding="utf-8").read()
    m = re.search(r'slug\s*:\s*"([^"]+)"', s)
    if not m:
        err(f, "no slug in PAGE")
    elif m.group(1) != v["slug"]:
        err(f, "PAGE slug %r != catalogue slug %r" % (m.group(1), v["slug"]))

# --- 4. trainer mounts vs ids ----------------------------------------------
for f in html_files:
    s = open(f, encoding="utf-8").read()
    if "window.PAGE" not in s:
        continue
    mounts = set(re.findall(r'id="trainer-([A-Za-z0-9_-]+)"', s))
    tids = set(re.findall(r'\{\s*"?id"?\s*:\s*"([A-Za-z0-9_-]+)"', s))
    tids |= set(re.findall(r'"id"\s*:\s*"([A-Za-z0-9_-]+)"', s))
    missing = mounts - tids
    if missing:
        err(f, "mount(s) with no trainer: %s" % sorted(missing))

# --- 5. sync lines in the right order --------------------------------------
for f, v in BY_FILE.items():
    if not os.path.exists(f):
        continue
    s = open(f, encoding="utf-8").read()
    try:
        c, y, e = (s.index('src="config.js"'), s.index('src="sync.js"'), s.index('src="_engine.js"'))
        if not (c < y < e):
            err(f, "config.js/sync.js must both come BEFORE _engine.js")
    except ValueError:
        err(f, "missing config.js / sync.js / _engine.js script tag")

# --- 6. inline PAGE parses as JS -------------------------------------------
for f, v in BY_FILE.items():
    if not os.path.exists(f):
        continue
    s = open(f, encoding="utf-8").read()
    m = re.search(r"(window\.PAGE\s*=.*?);\nEngine\.init\(\);", s, re.S)
    if not m:
        err(f, "could not locate the PAGE block")
        continue
    tmp = "/tmp/_pagecheck.js"
    open(tmp, "w", encoding="utf-8").write("var window={};\n" + m.group(1) + ";\n")
    p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if p.returncode != 0:
        err(f, "PAGE is not valid JS: %s" % p.stderr.strip().splitlines()[-1:])

# --- 7. plural rule ---------------------------------------------------------
# A noun row (article der/die/das) must show a plural: "· die ..." or an explicit
# (kein Plural) / (nur Plural) marker.
for f, v in BY_FILE.items():
    if not os.path.exists(f):
        continue
    s = open(f, encoding="utf-8").read()
    for art, word in re.findall(
            r'<td class="art">(der|die|das)</td><td class="w" lang="de">([^<]*)</td>', s):
        if "·" in word or "kein Plural" in word or "nur Plural" in word:
            continue
        err(f, "noun without plural in vocab table: %r" % word)

# --- 8. export mounts + decks.js in step with the lessons ------------------
for f, v in BY_FILE.items():
    if not os.path.exists(f):
        continue
    s = open(f, encoding="utf-8").read()
    n = s.count('<div class="anki-export-mount"></div>')
    if n != 2:
        err(f, "expected 2 anki-export mounts (top+bottom), found %d" % n)

_decks = subprocess.check_output(
    ["node", "-e",
     "global.window={};require('%s');require('%s');"
     "const D=window.DECKS,L=window.LESSONS;"
     "process.stdout.write(JSON.stringify({d:Object.keys(D),miss:L.filter(v=>!D[v.slug]).map(v=>v.slug),"
     "mism:L.filter(v=>D[v.slug]&&!D[v.slug].cards.length).map(v=>v.slug)}))"
     % (os.path.join(ROOT, "decks.js"), os.path.join(ROOT, "lessons.js"))], text=True)
_d = json.loads(_decks)
if _d["miss"]:
    fail.append("decks.js: lessons with no deck: %s" % _d["miss"])
if _d["mism"]:
    fail.append("decks.js: decks with zero cards: %s" % _d["mism"])
if len(_d["d"]) != len(CAT):
    fail.append("decks.js has %d decks but there are %d lessons" % (len(_d["d"]), len(CAT)))

# --- 9. the video a page embeds must be the one the catalogue names ---------
# This is the check that would have caught the 2026-08 mix-up, where a whole batch of
# lessons was given the id of the NEXT video in the source list. Titles are not fetched
# here (no network in the verifier) — that is a separate, deliberate step; see
# tools/check_video_titles.sh.
SECOND_VIDEO = {"weatherweek": {"kkLK2nUOlJE"}}   # lessons that legitimately show 2 videos
for f, v in BY_FILE.items():
    if not os.path.exists(f):
        continue
    s = open(f, encoding="utf-8").read()
    ids = set(re.findall(r"youtube\.com/watch\?v=([A-Za-z0-9_-]{11})", s)) | \
          set(re.findall(r"img\.youtube\.com/vi/([A-Za-z0-9_-]{11})/", s))
    allowed = {v["id"]} | set(SECOND_VIDEO.get(v["slug"], ()))
    if v.get("id2"):
        allowed.add(v["id2"])
    if v["id"] not in ids:
        err(f, "catalogue video id %s does not appear on the page" % v["id"])
    extra = ids - allowed
    if extra:
        err(f, "page embeds video id(s) not in the catalogue: %s" % sorted(extra))

print("checked %d html files, %d catalogue entries" % (len(html_files), len(CAT)))
if fail:
    print("\nFAILURES (%d):" % len(fail))
    for x in fail:
        print("  -", x)
    sys.exit(1)
print("ALL CHECKS PASSED")
