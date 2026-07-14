#!/usr/bin/env bash
# Build/check the self-contained template archive shipped with the scaffold skill.
#
# Packages ONLY git-tracked files (via `git ls-files`), not the raw working
# directory — taring the raw directory previously swept in gitignored local
# artifacts (.env.local, playwright-report/, test-results/) that differ
# between machines/checkouts, making the archive non-reproducible and
# leaking local dev files into the published skill asset.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_REL="templates/agentic-copilot-foundry"
TEMPLATE="$ROOT/$TEMPLATE_REL"
DEST="$ROOT/.agents/skills/forgewright/assets/agentic-copilot-foundry.tar.gz"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$TEMPLATE" ] || { echo "✗ template not found: $TEMPLATE" >&2; exit 1; }

tmp="$(mktemp)"
filelist="$(mktemp)"
trap 'rm -f "$tmp" "$filelist"' EXIT

cd "$ROOT"
git ls-files -z -- "$TEMPLATE_REL" > "$filelist"

tar \
  --null -T "$filelist" \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 --group=0 --numeric-owner \
  --transform "s#^${TEMPLATE_REL}/#./#" \
  -cf - | gzip -n -9 > "$tmp"

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
