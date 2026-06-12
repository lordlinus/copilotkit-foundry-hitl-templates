#!/usr/bin/env bash
# Start the AG-UI backend in offline mock mode, wait for health, run smoke.py,
# then stop the backend. No Azure, no real model.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BPY="${BPY:-$ROOT/backend/.venv/bin/python}"
[ -x "$BPY" ] || BPY="python3"

export LLM_MODE=mock
"$BPY" -m uvicorn ag_ui_app:app --app-dir backend --host 127.0.0.1 --port 8080 --log-level warning &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  curl -sf http://localhost:8080/healthz >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf http://localhost:8080/healthz >/dev/null || { echo "✗ backend failed to start"; exit 1; }

"$BPY" scripts/smoke.py
