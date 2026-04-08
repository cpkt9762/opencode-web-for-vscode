#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/spa"
CDN="https://app.opencode.ai"

echo "Downloading SPA from $CDN ..."
rm -rf "$OUT"
mkdir -p "$OUT/assets"

# 1. Download index.html
curl -sS "$CDN/" -o "$OUT/index.html"

# 2. Extract JS and CSS asset paths
JS_FILES=$(grep -oE '/assets/[^"]+\.js' "$OUT/index.html")
CSS_FILES=$(grep -oE '/assets/[^"]+\.css' "$OUT/index.html")

# 3. Download JS files (core app + lazy chunks)
echo "Downloading JS bundles..."
MAIN_JS=$(echo "$JS_FILES" | head -1)
curl -sS "$CDN$MAIN_JS" -o "$OUT$MAIN_JS"
echo "  main: $(du -h "$OUT$MAIN_JS" | cut -f1)"

# Download all lazy-loaded chunks referenced in the main bundle
CHUNKS=$(grep -oE '/assets/[a-zA-Z0-9_-]+\.js' "$OUT$MAIN_JS" | sort -u || true)
TOTAL=0
for chunk in $CHUNKS; do
  target="$OUT$chunk"
  if [ ! -f "$target" ]; then
    curl -sS "$CDN$chunk" -o "$target" 2>/dev/null && TOTAL=$((TOTAL+1)) || true
  fi
done
echo "  chunks: $TOTAL files"

# Also download worker and session chunks explicitly from the index
for js in $JS_FILES; do
  target="$OUT$js"
  if [ ! -f "$target" ]; then
    curl -sS "$CDN$js" -o "$target" 2>/dev/null || true
  fi
done

# 4. Download CSS
for css in $CSS_FILES; do
  curl -sS "$CDN$css" -o "$OUT$css"
  echo "  css: $(du -h "$OUT$css" | cut -f1)"
done

SIZE=$(du -sh "$OUT" | cut -f1)
COUNT=$(ls "$OUT/assets/"*.js 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Done: $SIZE ($COUNT JS files)"
echo "Fonts/media will be loaded from CDN at runtime."
