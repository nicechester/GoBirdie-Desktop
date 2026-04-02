#!/usr/bin/env bash
set -euo pipefail

NATIVE_SRC="src-tauri/src/native/garmin_mtp.c"
NATIVE_BIN="src-tauri/src/native/garmin_mtp"
BREW_PREFIX="$(brew --prefix)"

# ── 1. Compile native MTP helper ─────────────────────────────────────────────
echo "==> Building native MTP helper..."
TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
clang \
  -I"${BREW_PREFIX}/include" \
  -L"${BREW_PREFIX}/lib" \
  -lmtp \
  -o "${NATIVE_BIN}-${TARGET_TRIPLE}" \
  "${NATIVE_SRC}"
echo "    ${NATIVE_BIN}-${TARGET_TRIPLE} built"

# ── 2. JS deps + Tauri build ──────────────────────────────────────────────────
echo "==> Installing JS dependencies..."
npm install

echo "==> Building Tauri app..."
npm run tauri:build

# ── 3. Bundle dylibs + repackage DMG ─────────────────────────────────────────
bash bundle_dylibs.sh
