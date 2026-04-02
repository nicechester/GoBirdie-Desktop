#!/usr/bin/env bash
# bundle_dylibs.sh — patches libmtp + libusb into the .app and repackages the DMG
# Usage: ./bundle_dylibs.sh
set -euo pipefail

BREW_PREFIX="$(brew --prefix)"
APP_BUNDLE="$(ls -d src-tauri/target/release/bundle/macos/*.app | head -1)"
FRAMEWORKS="${APP_BUNDLE}/Contents/Frameworks"
MACOS="${APP_BUNDLE}/Contents/MacOS"
MTP_BIN="$(ls "${MACOS}"/garmin_mtp* | head -1)"

LIBMTP_ORIG="${BREW_PREFIX}/opt/libmtp/lib/libmtp.9.dylib"
LIBUSB_ORIG="${BREW_PREFIX}/opt/libusb/lib/libusb-1.0.0.dylib"

echo "==> Bundling dylibs into ${APP_BUNDLE}..."
mkdir -p "${FRAMEWORKS}"

for dylib in "${LIBMTP_ORIG}" "${LIBUSB_ORIG}"; do
  name="$(basename "${dylib}")"
  dest="${FRAMEWORKS}/${name}"
  cp "${dylib}" "${dest}"
  chmod u+w "${dest}"
  install_name_tool -id "@executable_path/../Frameworks/${name}" "${dest}"
  install_name_tool -change "${dylib}" "@executable_path/../Frameworks/${name}" "${MTP_BIN}"
done

# Fix cross-reference inside libmtp
install_name_tool \
  -change "${LIBUSB_ORIG}" "@executable_path/../Frameworks/libusb-1.0.0.dylib" \
  "${FRAMEWORKS}/libmtp.9.dylib"

echo "==> Repackaging DMG..."
APP_NAME="$(basename "${APP_BUNDLE}" .app)"
DMG_DIR="src-tauri/target/release/bundle/dmg"
DMG_OUT="${DMG_DIR}/${APP_NAME}.dmg"

# Remove old DMG and create a fresh one
rm -f "${DMG_OUT}"
hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${APP_BUNDLE}" \
  -ov -format UDZO \
  "${DMG_OUT}"

echo ""
echo "Done. DMG: ${DMG_OUT}"
