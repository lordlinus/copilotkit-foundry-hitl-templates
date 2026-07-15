#!/usr/bin/env bash
# verify-deployed.sh — the DEPLOYMENT-VERIFIED gate. `make verify`/`make smoke`/
# `make e2e` all pass against a LOCAL run of the agent code (`azd ai agent run`,
# DIRECT mode) — that is the fast dev-loop gate, and it is NOT proof anything is
# deployed. This script is the separate, mechanical check for the other tier:
# does a REAL Foundry hosted agent exist for this app, is it active, and does a
# live invoke actually reach it (not a local process wearing the same code)?
#
# Run this — and require it green — before calling the app "deployed", "live",
# "shipped", or adding it to any showcase/gallery. `make up` must have run first.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

ROOT="$(cd .. && pwd)"
HOSTED_DIR="$ROOT/hosted"
AGENT_ID="$(grep -E '^name:' "$HOSTED_DIR/responses/agent.yaml" | head -1 | sed -E 's/^name:\s*//')"
info "app root: $ROOT"
info "hosted agent id: $AGENT_ID"

command -v azd >/dev/null || fail "azd is required — https://aka.ms/azd"
command -v az  >/dev/null || fail "az is required — https://aka.ms/install-azure-cli"

cd "$HOSTED_DIR"

# 1. The agent must exist in Foundry and be active — NOT just that `azd up`
#    printed SUCCESS at some point in the past. This also gives us the real
#    Responses endpoint, straight from the platform, not reconstructed by hand.
SHOW_JSON="$(AGENT_DEFINITION_PATH=responses/agent.yaml azd ai agent show "$AGENT_ID" -o json 2>/dev/null || true)"
if [ -z "$SHOW_JSON" ]; then
  fail "azd ai agent show '$AGENT_ID' returned nothing — has 'make up' been run for this azd env?"
  finish
fi
STATUS="$(printf '%s' "$SHOW_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status",""))' 2>/dev/null || true)"
[ "$STATUS" = "active" ] && pass "agent '$AGENT_ID' is active in Foundry (not just 'azd up succeeded')" \
  || fail "agent '$AGENT_ID' status is '$STATUS', expected 'active' — check 'azd ai agent show $AGENT_ID'"

ENDPOINT="$(printf '%s' "$SHOW_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("agent_endpoints",{}).get("responses",""))' 2>/dev/null || true)"
[ -n "$ENDPOINT" ] && pass "resolved the deployed Responses endpoint from Foundry (not HOSTED_AGENT_DIRECT_URL)" \
  || fail "could not resolve agent_endpoints.responses from 'azd ai agent show' output"

# 2. A live invoke must actually reach that DEPLOYED endpoint over the network —
#    this call structurally cannot be satisfied by a local `azd ai agent run` or
#    `python app.py` process, which is the whole point of this check vs `make smoke`.
if [ -n "$ENDPOINT" ]; then
  TOKEN="$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv 2>/dev/null || true)"
  if [ -z "$TOKEN" ]; then
    fail "az account get-access-token failed — run 'az login' first"
  else
    RESP="$(curl -sS -m 30 -X POST "$ENDPOINT" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"model\":\"$AGENT_ID\",\"input\":[{\"role\":\"user\",\"content\":\"reply with the single word OK\"}]}" \
      2>/dev/null || true)"
    INVOKE_STATUS="$(printf '%s' "$RESP" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("status",""))
except Exception:
    print("")' 2>/dev/null || true)"
    [ "$INVOKE_STATUS" = "completed" ] && pass "live invoke against the deployed endpoint completed (real Foundry hosted agent, not a local process)" \
      || fail "live invoke status was '$INVOKE_STATUS', expected 'completed' — raw response: ${RESP:0:300}"
  fi
fi

finish
