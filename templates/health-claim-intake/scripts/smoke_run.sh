#!/usr/bin/env bash
# End-to-end smoke against the REAL agent running LOCALLY via `azd ai agent run`
# (no mock). Starts the agent + the bridge (DIRECT mode) and runs the assertions.
# Prereq: `az login` + an azd env with a provisioned Foundry project (`make up` once).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BPY="${BPY:-$ROOT/backend/.venv/bin/python}"
[ -x "$BPY" ] || BPY="python3"

# shellcheck source=/dev/null
. "$ROOT/scripts/lib-agentrun.sh"

cleanup() { stop_agent_and_bridge 8088 8080; }
trap cleanup EXIT INT TERM

start_agent_and_bridge "$ROOT" "$BPY" 8088 8080 || exit 1
"$BPY" "$ROOT/scripts/smoke.py" || {
  echo ""
  echo "✗ smoke failed. The agent's own errors are NOT in the output above — check:"
  echo "    tail -50 /tmp/forge-agent.log"
  echo "  A 403 'does not have permissions …agents/write' there means the signed-in"
  echo "  identity lacks the 'Azure AI User' role on the Foundry project (az login"
  echo "  with the account that provisioned it, or grant the role)."
  exit 1
}
