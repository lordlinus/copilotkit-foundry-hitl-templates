#!/usr/bin/env bash
# verify-hosted.sh — the showcase's DEPLOYMENT-VERIFIED gate.
#
# `make verify` (UI build + jsdom) and `make smoke` (bridge protocol/HITL) can
# both pass even if the gateway is silently running each template's agent code
# LOCALLY instead of forwarding to a real Foundry hosted agent — that is exactly
# the failure this repo shipped once (see AGENTS.md's two-tier Golden Rule).
# This script is the mechanical, non-negotiable check for the other tier: for
# EVERY agent in agents.json, is there a REAL Foundry agent, of kind "hosted",
# in state "enabled", whose id matches `hostedAgentName` (or `id`)?
#
# Requires: az login, and FOUNDRY_PROJECT_ENDPOINT pointed at the project the
# showcase's hosted agents were deployed into (see showcase/gateway/DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")/../.."

REGISTRY="${SHOWCASE_REGISTRY:-agents.json}"
[ -f "$REGISTRY" ] || { echo "✗ $REGISTRY not found"; exit 1; }

PROJECT_ENDPOINT="${FOUNDRY_PROJECT_ENDPOINT:-}"
if [ -z "$PROJECT_ENDPOINT" ]; then
  echo "✗ FOUNDRY_PROJECT_ENDPOINT is not set — cannot verify hosted agents"
  echo "  (set it to the project the showcase's agents were deployed into)"
  exit 1
fi

command -v az >/dev/null || { echo "✗ az is required — run 'az login' first"; exit 1; }
TOKEN="$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv 2>/dev/null || true)"
[ -n "$TOKEN" ] || { echo "✗ az account get-access-token failed — run 'az login'"; exit 1; }

AGENTS_JSON="$(curl -sS -m 30 -H "Authorization: Bearer $TOKEN" \
  "${PROJECT_ENDPOINT%/}/agents?api-version=2025-11-15-preview" 2>/dev/null || true)"
[ -n "$AGENTS_JSON" ] || { echo "✗ could not list agents from $PROJECT_ENDPOINT"; exit 1; }

python3 - "$REGISTRY" "$AGENTS_JSON" << 'PYEOF'
import json, sys

registry_path, agents_json = sys.argv[1], sys.argv[2]
registry = json.load(open(registry_path))
remote = json.loads(agents_json)
remote_by_id = {a.get("id"): a for a in remote.get("data", [])}

failed = False
for agent in registry.get("agents", []):
    aid = agent.get("id")
    hosted_name = agent.get("hostedAgentName", aid)
    remote_agent = remote_by_id.get(hosted_name)
    if remote_agent is None:
        print(f"  [FAIL] '{aid}' -> hostedAgentName='{hosted_name}' NOT FOUND in Foundry "
              f"(this agent's gateway backend is not a registered hosted agent)")
        failed = True
        continue
    kind = remote_agent.get("versions", {}).get("latest", {}).get("definition", {}).get("kind")
    state = remote_agent.get("state")
    ok = kind == "hosted" and state == "enabled"
    marker = "PASS" if ok else "FAIL"
    print(f"  [{marker}] '{aid}' -> hostedAgentName='{hosted_name}' kind={kind} state={state}")
    if not ok:
        failed = True

sys.exit(1 if failed else 0)
PYEOF
FAILED=$?

echo
if [ "$FAILED" -ne 0 ]; then
  echo "FAIL — one or more showcase agents are not real Foundry hosted agents."
  echo "Do NOT call the showcase deployed/live/promoted until this is green."
  exit 1
fi
echo "PASS — every showcase agent is a real, enabled Foundry hosted agent."
