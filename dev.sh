#!/bin/bash

# Garmin Analyzer - Development Script

echo "Starting Garmin Analyzer in development mode..."
echo ""
echo "This will start two processes:"
echo "  1. Vite dev server (port 9002)"
echo "  2. Tauri development app"
echo ""
echo "Press Ctrl+C to stop both processes"
echo ""

cleanup() {
    echo ""
    echo "Stopping development servers..."
    kill 0
}

trap cleanup EXIT

# Kill anything holding port 9002
lsof -ti:9002 | xargs kill -9 2>/dev/null || true

# Build Swift sync helper if needed
TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
SYNC_BIN="src-tauri/src/native/gobirdie-sync-helper-${TARGET_TRIPLE}"
if [ ! -f "${SYNC_BIN}" ] || [ "src-tauri/src/native/Sources/main.swift" -nt "${SYNC_BIN}" ]; then
    echo "Building gobirdie-sync-helper..."
    (cd src-tauri/src/native && swift build -c release)
    cp "src-tauri/src/native/.build/release/gobirdie-sync-helper" "${SYNC_BIN}"
    echo "    ${SYNC_BIN} built"
else
    echo "gobirdie-sync-helper up to date"
fi

echo "Starting Vite dev server..."
npm run dev &

sleep 3

echo "Starting Tauri app..."
npm run tauri:dev

wait
