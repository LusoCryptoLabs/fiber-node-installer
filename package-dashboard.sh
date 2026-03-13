#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# package-dashboard.sh — Build and package the dashboard for release
#
# Usage:  ./package-dashboard.sh [version]
#         e.g. ./package-dashboard.sh v1.2.0
#
# Produces: dashboard-v1.2.0.zip  (ready to attach to a GitHub release)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_OUTER="$SCRIPT_DIR/fiber-dashboard"
DASHBOARD_APP="$DASHBOARD_OUTER/fiber-dashboard"

# ── Version ──────────────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -e "console.log('v'+require('$DASHBOARD_APP/package.json').version)" 2>/dev/null || echo "")
  if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>  (e.g. v1.2.0)"
    exit 1
  fi
  echo "Auto-detected version: $VERSION"
fi

echo "Packaging dashboard $VERSION ..."

# ── Build frontend ───────────────────────────────────────────────────
echo "Building frontend (vite) ..."
cd "$DASHBOARD_APP"
npm run build

# ── Create staging area ─────────────────────────────────────────────
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

DEST="$STAGING/dashboard"
mkdir -p "$DEST/ckb-fiber" "$DEST/fiber-dashboard/server" "$DEST/fiber-dashboard/src"

# ── Copy ckb-fiber (RPC client) ──────────────────────────────────────
cp "$DASHBOARD_OUTER/ckb-fiber/index.js"    "$DEST/ckb-fiber/"
cp "$DASHBOARD_OUTER/ckb-fiber/index.d.ts"  "$DEST/ckb-fiber/"
cp "$DASHBOARD_OUTER/ckb-fiber/package.json" "$DEST/ckb-fiber/"

# ── Copy fiber-dashboard ────────────────────────────────────────────
# Server source (tsx compiles at runtime)
cp "$DASHBOARD_APP/server/index.ts" "$DEST/fiber-dashboard/server/"

# Pre-built frontend
cp -r "$DASHBOARD_APP/dist" "$DEST/fiber-dashboard/dist"

# Source files (tsx needs to resolve imports for server compilation)
cp -r "$DASHBOARD_APP/src" "$DEST/fiber-dashboard/src"

# Config files needed for npm install / tsx
for f in package.json package-lock.json tsconfig.json index.html vite.config.ts tailwind.config.js postcss.config.js; do
  [ -f "$DASHBOARD_APP/$f" ] && cp "$DASHBOARD_APP/$f" "$DEST/fiber-dashboard/"
done

# ── Monitor directory if exists ──────────────────────────────────────
[ -d "$DASHBOARD_APP/src/monitor" ] && cp -r "$DASHBOARD_APP/src/monitor" "$DEST/fiber-dashboard/src/monitor"

# ── Create zip ───────────────────────────────────────────────────────
OUT_FILE="$SCRIPT_DIR/dashboard-${VERSION}.zip"
cd "$STAGING"
if command -v zip &>/dev/null; then
  zip -qr "$OUT_FILE" dashboard/
elif command -v powershell &>/dev/null; then
  # Windows Git Bash — use PowerShell to create zip
  WIN_STAGING=$(cygpath -w "$STAGING/dashboard")
  WIN_OUT=$(cygpath -w "$OUT_FILE")
  powershell -NoProfile -Command "Compress-Archive -Path '$WIN_STAGING' -DestinationPath '$WIN_OUT' -Force"
else
  echo "ERROR: Neither zip nor powershell found. Install zip or run on Windows/Linux."
  exit 1
fi

echo ""
echo "Done! Created: $OUT_FILE"
echo "Size: $(du -sh "$OUT_FILE" | cut -f1)"
echo ""
echo "To release:"
echo "  gh release upload $VERSION \"$OUT_FILE\""
