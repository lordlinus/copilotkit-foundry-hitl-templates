#!/usr/bin/env bash
# Real-browser E2E against the real local hosted agent + bridge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BPY="${BPY:-$ROOT/backend/.venv/bin/python}"
[ -x "$BPY" ] || BPY="python3"

# shellcheck source=/dev/null
. "$ROOT/scripts/lib-agentrun.sh"

cleanup() {
  kill "${FRONTEND_PID:-}" 2>/dev/null || true
  command -v fuser >/dev/null 2>&1 && fuser -k 3000/tcp 2>/dev/null || true
  stop_agent_and_bridge 8088 8080
}
trap cleanup EXIT INT TERM

start_agent_and_bridge "$ROOT" "$BPY" 8088 8080 || exit 1

cd "$ROOT/frontend"
npm run build
if curl -sf "http://127.0.0.1:3000/" >/dev/null 2>&1; then
  echo "✗ :3000 is already serving a frontend — stop it before running make e2e"
  exit 1
fi
AG_UI_BACKEND_URL="http://127.0.0.1:8080/" npm run start >/tmp/forge-frontend.log 2>&1 &
FRONTEND_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$FRONTEND_PID" 2>/dev/null || {
    echo "✗ frontend exited:"
    tail -30 /tmp/forge-frontend.log
    exit 1
  }
  curl -sf "http://127.0.0.1:3000/" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:3000/" >/dev/null || {
  echo "✗ frontend not ready"
  tail -30 /tmp/forge-frontend.log
  exit 1
}

npx playwright install chromium
npm run test:e2e
