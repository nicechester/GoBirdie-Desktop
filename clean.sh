#!/bin/bash
set -euo pipefail

echo "Cleaning build artifacts..."

rm -rf node_modules dist
echo "  removed node_modules/ dist/"

rm -rf src-tauri/target
echo "  removed src-tauri/target/"

rm -rf src-tauri/src/native/.build
echo "  removed src-tauri/src/native/.build/"

TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
rm -f "src-tauri/src/native/garmin_mtp-${TARGET_TRIPLE}"
rm -f "src-tauri/src/native/gobirdie-sync-helper-${TARGET_TRIPLE}"
echo "  removed native binaries"

echo "Done."
