#!/bin/bash
# Deletes the garmin-analyzer round store.
# Store location: ~/Library/Application Support/garmin-analyzer/rounds.db

STORE="$HOME/Library/Application Support/garmin-analyzer/rounds.db"

if [ ! -d "$STORE" ]; then
    echo "Store not found: $STORE"
    exit 0
fi

read -p "Delete all stored rounds? This cannot be undone. [y/N] " confirm
if [[ "$confirm" =~ ^[Yy]$ ]]; then
    rm -rf "$STORE"
    echo "Store deleted."
else
    echo "Aborted."
fi
