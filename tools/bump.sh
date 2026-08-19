#!/bin/sh
# Bump the asset version in index.html and CACHE in sw.js together.
# They must move in lockstep: the service worker is cache-first, so a stale
# ?v= leaves installed phones running old code. Doing this by hand has broken
# a debugging session three times, hence the script.
set -e
cd "$(dirname "$0")/.."
cur=$(grep -oE '\?v=[0-9]+' index.html | head -1 | cut -d= -f2)
next=$((cur + 1))
sed -i '' "s/?v=$cur\"/?v=$next\"/g" index.html
sed -i '' "s/?v=$cur'/?v=$next'/g" sw.js
sed -i '' "s/wimpout-v$cur'/wimpout-v$next'/" sw.js
echo "v$cur -> v$next"
grep -c "v=$next" index.html | sed 's/^/  index.html refs: /'
grep -E "CACHE =" sw.js | sed 's/^/  /'
