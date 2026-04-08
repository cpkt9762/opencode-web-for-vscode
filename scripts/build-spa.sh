#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$(cd "$ROOT/../packages/app" 2>/dev/null && pwd || echo "")"

if [ -z "$APP" ] || [ ! -f "$APP/package.json" ]; then
  echo "ERROR: packages/app not found at $APP"
  echo "This script must run from inside the opencode monorepo."
  exit 1
fi

echo "Building SPA from $APP ..."
cd "$APP"
bun run build

echo "Copying dist to $ROOT/spa/ ..."
rm -rf "$ROOT/spa"
mkdir -p "$ROOT/spa/assets"

cp "$APP/dist/index.html" "$ROOT/spa/"
cp "$APP/dist/assets/"*.js "$ROOT/spa/assets/"
cp "$APP/dist/assets/"*.css "$ROOT/spa/assets/"

SIZE=$(du -sh "$ROOT/spa" | cut -f1)
COUNT=$(ls "$ROOT/spa/assets/"*.js | wc -l | tr -d ' ')
echo "Done: $SIZE ($COUNT JS files)"
