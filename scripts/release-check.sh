#!/usr/bin/env bash
# Offline publication gate: every template verifies and the bundled skill scaffolds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "▸ leak scan (tracked files + bundled skill asset)"
# GUIDs are only a leak in subscription/tenant context — Azure role-definition IDs
# are public constants and stay allowed.
GUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
SUB_CTX='subscription_id|tenant_id|subscriptions/'
LEAKS='\.azurecontainerapps\.io|/home/[a-z][a-z0-9_-]*|sk-[A-Za-z0-9]{20,}|AccountKey[=]|SharedAccessSignature[=]|BEGIN [A-Z ]*PRIVATE KEY'
fail=0
if git -C "$ROOT" ls-files -z | (cd "$ROOT" && xargs -0 grep -nHiEI "$GUID" --) \
    | grep -iE "$SUB_CTX" | grep -viE 'roledefinitions' | grep .; then
  echo "✗ GUID in subscription/tenant context in tracked files (above)"; fail=1
fi
if git -C "$ROOT" ls-files -z | (cd "$ROOT" && xargs -0 grep -nHiEI "$LEAKS" --) | grep .; then
  echo "✗ leak pattern (endpoint/home-path/key material) in tracked files (above)"; fail=1
fi
# The skill asset is a tracked binary — grep over tracked files can't see inside it.
asset="$ROOT/.agents/skills/copilotkit-foundry-scaffold/assets/agentic-copilot-foundry.tar.gz"
if tar -xzOf "$asset" | grep -iE "$GUID" | grep -iE "$SUB_CTX" | grep -viE 'roledefinitions' | grep .; then
  echo "✗ GUID in subscription/tenant context inside $(basename "$asset")"; fail=1
fi
if tar -xzOf "$asset" | grep -iE "$LEAKS" | grep .; then
  echo "✗ leak pattern inside $(basename "$asset")"; fail=1
fi
[ "$fail" -eq 0 ] || { echo "✗ leak scan failed — do not publish"; exit 1; }

for template in "$ROOT"/templates/*; do
  echo "▸ verify $(basename "$template")"
  make -s -C "$template" verify
done

echo "▸ scaffold from the publishable skill bundle"
bash "$ROOT/.agents/skills/copilotkit-foundry-scaffold/scripts/new-app.sh" publication-check "$tmp"
make -s -C "$tmp/publication-check" verify

echo "✓ offline publication checks passed"
