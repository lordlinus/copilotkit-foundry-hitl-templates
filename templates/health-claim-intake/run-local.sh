#!/usr/bin/env bash
# Local dev loop: the REAL agent running locally via `azd ai agent run` (hot reload,
# connected to your Foundry project) + the bridge (DIRECT mode) + the Next.js UI.
# Prereq: `az login` + an azd env with a provisioned Foundry project (`make up` once).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BPY="$ROOT/backend/.venv/bin/python"
command -v uv >/dev/null || { echo "uv is required — https://docs.astral.sh/uv/"; exit 1; }
[ -d "$ROOT/backend/.venv" ] || uv venv --python 3.12 "$ROOT/backend/.venv"
uv pip install -q --python "$BPY" --prerelease=allow -r "$ROOT/backend/requirements.txt"

# shellcheck source=/dev/null
. "$ROOT/scripts/lib-agentrun.sh"

start_agent_and_bridge "$ROOT" "$BPY" 8088 8080 || exit 1

cd "$ROOT/frontend"
[ -d node_modules ] || npm install
[ -f .env.local ] || cp .env.example .env.local
npm run dev &
FRONTEND_PID=$!

cleanup() { kill "${FRONTEND_PID:-}" "${BRIDGE_PID:-}" "${AGENT_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "──────────────────────────────────────────────"
echo "  Agent (local) : http://localhost:8088/readiness"
echo "  Bridge        : http://localhost:8080/healthz"
echo "  Frontend      : http://localhost:3000"
echo "──────────────────────────────────────────────"
wait
