#!/usr/bin/env bash
set -euo pipefail

# Copy .opencode/context into the _context collection directory.
# Jekyll collections with output:true generate pages for all documents
# without requiring per-file front matter.
SRC="../.opencode/context"
DEST="./_context"

rm -rf "$DEST"
mkdir -p "$DEST"

find "$SRC" -name "*.md" | while IFS= read -r src; do
  rel="${src#$SRC/}"
  dest="$DEST/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
done

jekyll build
