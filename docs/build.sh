#!/usr/bin/env bash
set -euo pipefail

# Copy .opencode/context into docs/context, injecting Jekyll front matter
# so files without --- blocks are rendered as HTML pages.
SRC="../.opencode/context"
DEST="./context"

rm -rf "$DEST"
mkdir -p "$DEST"

find "$SRC" -name "*.md" | while IFS= read -r src; do
  rel="${src#$SRC/}"
  dest="$DEST/$rel"
  mkdir -p "$(dirname "$dest")"
  if head -1 "$src" | grep -q "^---"; then
    cp "$src" "$dest"
  else
    # Derive a title from the filename
    title=$(basename "$src" .md | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
    { echo "---"; echo "title: \"$title\""; echo "layout: default"; echo "---"; echo; cat "$src"; } > "$dest"
  fi
done

jekyll build
