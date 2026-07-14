#!/usr/bin/env bash
# Offline publication gate: every template verifies and the bundled skill scaffolds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for template in "$ROOT"/templates/*; do
  echo "▸ verify $(basename "$template")"
  make -s -C "$template" verify
done

echo "▸ scaffold from the publishable skill bundle"
bash "$ROOT/.agents/skills/forgewright/scripts/new-app.sh" publication-check "$tmp"
make -s -C "$tmp/publication-check" verify

echo "✓ offline publication checks passed"
