#!/usr/bin/env bash
# Build/check the self-contained template archive shipped with the scaffold skill.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/templates/agentic-copilot-foundry"
DEST="$ROOT/.agents/skills/forgewright/assets/agentic-copilot-foundry.tar.gz"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$TEMPLATE" ] || { echo "✗ template not found: $TEMPLATE" >&2; exit 1; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

tar \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 --group=0 --numeric-owner \
  --exclude='node_modules' --exclude='.venv' --exclude='.next' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.azure' \
  -cf - -C "$TEMPLATE" . | gzip -n -9 > "$tmp"

if [ "$CHECK" = 1 ]; then
  if [ ! -f "$DEST" ] || ! cmp -s "$tmp" "$DEST"; then
    echo "✗ scaffold skill archive is stale (run make package-skill)" >&2
    exit 1
  fi
  echo "✓ scaffold skill archive matches the canonical template"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
mv "$tmp" "$DEST"
trap - EXIT
echo "✓ packaged $DEST ($(du -h "$DEST" | awk '{print $1}'))"
