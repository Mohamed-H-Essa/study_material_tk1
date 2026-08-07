#!/usr/bin/env bash
# Confirm every lesson's video id really is the video the lesson claims to teach.
#
# verify.py can only prove the page and the catalogue AGREE — if both name the wrong
# video (which is exactly what happened in 2026-08, when a batch of lessons each got the
# id of the NEXT video in the source list) it cannot tell. This asks YouTube for the real
# title so a human can eyeball the pairing. Needs network; run it after adding lessons.
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'global.window={};require("./lessons.js");
  console.log(window.LESSONS.map(v=>[v.n,v.slug,v.id,v.title].join("|")).join("\n"))' |
while IFS='|' read -r n slug id title; do
  real=$(curl -s "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=$id&format=json" |
         python3 -c "import json,sys
try: print(json.load(sys.stdin)['title'])
except Exception: print('<<UNAVAILABLE / PRIVATE / DELETED>>')" 2>/dev/null || echo '<<ERROR>>')
  printf "%3s %-18s %-13s %-34s %s\n" "$n" "$slug" "$id" "$title" "$real"
done
