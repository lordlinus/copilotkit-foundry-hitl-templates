#!/usr/bin/env bash
# new-template.sh — scaffold a NEW gallery template by cloning the canonical one.
#
#   scripts/new-template.sh <name> "<Display Name>" "<description>"
#
# Use this to add a second template variant to the gallery (e.g. a multi-tool or
# file-upload starter). For building an *app* from a template, use new-app.sh.
set -euo pipefail

GALLERY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$GALLERY_ROOT/templates/agentic-copilot-foundry"

NAME="${1:-}"; DISPLAY="${2:-}"; DESC="${3:-}"
if [ -z "$NAME" ] || [ -z "$DISPLAY" ] || [ -z "$DESC" ]; then
  echo 'usage: new-template.sh <name> "<Display Name>" "<description>"' >&2
  exit 2
fi
if ! printf '%s' "$NAME" | grep -Eq '^[a-z][a-z0-9-]{0,63}$'; then
  echo "✗ invalid name '$NAME' (lowercase-hyphen)." >&2; exit 2
fi
DEST="$GALLERY_ROOT/templates/$NAME"
[ -e "$DEST" ] && { echo "✗ '$DEST' already exists" >&2; exit 1; }

mkdir -p "$DEST"
( cd "$BASE" && tar \
    --exclude='node_modules' --exclude='.venv' --exclude='.next' \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='.azure' \
    -cf - . ) | ( cd "$DEST" && tar -xf - )

# Update the new template's manifest.json metadata.
node -e '
const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,"utf8"));
m.templateId=process.argv[2];m.displayName=process.argv[3];m.description=process.argv[4];
fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n");
' "$DEST/manifest.json" "$NAME" "$DISPLAY" "$DESC"

# Regenerate gallery manifests + README table.
node "$GALLERY_ROOT/scripts/generate-manifest.mjs"

echo
echo "✓ created templates/$NAME (from agentic-copilot-foundry)"
echo "  edit its src/agent.py, frontend/, README.md, then run: node scripts/generate-manifest.mjs"
