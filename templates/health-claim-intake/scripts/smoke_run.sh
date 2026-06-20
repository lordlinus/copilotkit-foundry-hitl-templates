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

cleanup() { kill "${BRIDGE_PID:-}" "${AGENT_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

start_agent_and_bridge "$ROOT" "$BPY" 8088 8080 || exit 1
"$BPY" "$ROOT/scripts/smoke.py"
