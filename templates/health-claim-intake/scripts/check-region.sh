#!/usr/bin/env bash
# Pre-flight region check for `make up` — fails FAST with the supported-region
# list instead of letting `azd up` run for minutes before erroring deep inside
# ARM/agent-creation with a confusing message. Also used as a hint before the
# first interactive `azd up` run (which prompts for env name/subscription/
# location) so the user picks a region that actually supports hosted agents.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/foundry-regions.sh

if [ ! -d hosted/.azure ]; then
  echo "▸ first 'azd up' run will prompt for env name, subscription, and location —"
  echo "  pick a region that supports Foundry hosted agents:"
  echo "    $(foundry_region_list)"
  exit 0
fi

# `azd env get-value` PROMPTS (and can hang a non-TTY run) when no default env
# exists yet — gate it behind `azd env list` (read-only) and close stdin.
LOC=""
if (cd hosted && azd env list -o json 2>/dev/null </dev/null) | grep -q '"IsDefault":[[:space:]]*true'; then
  LOC="$(cd hosted && azd env get-value AZURE_LOCATION 2>/dev/null </dev/null || true)"
fi
[ -n "$LOC" ] || exit 0   # nothing set yet — azd up will prompt; nothing to validate

if ! foundry_region_is_supported "$LOC"; then
  echo "✗ hosted/.azure's AZURE_LOCATION ('$LOC') does not support Foundry hosted agents."
  echo "  Supported regions:"
  echo "    $(foundry_region_list)"
  echo "  Fix: cd hosted && azd env set AZURE_LOCATION <region>   (then 'make up' again —"
  echo "  changing location re-provisions the Foundry resource there)."
  exit 1
fi
