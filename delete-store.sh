#!/bin/bash
# Deletes the GoBirdie Companion round store.
# Store location: ~/Library/Application Support/go-birdie-companion/rounds.db

STORE="$HOME/Library/Application Support/go-birdie-companion/rounds.db"

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
