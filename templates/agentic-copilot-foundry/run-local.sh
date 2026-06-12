#!/usr/bin/env bash
# Two-process local launcher: AG-UI backend (:8080) + Next.js frontend (:3000).
# Ctrl-C stops both. For Azure-free testing, set LLM_MODE=mock before running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -m uvicorn ag_ui_app:app --host 0.0.0.0 --port 8080 &
BACKEND_PID=$!

cd "$ROOT/frontend"
[ -d node_modules ] || npm install
[ -f .env.local ] || cp .env.example .env.local
npm run dev &
FRONTEND_PID=$!

cleanup() { kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "──────────────────────────────────────────────"
echo "  Backend : http://localhost:8080/healthz"
echo "  Frontend: http://localhost:3000"
echo "──────────────────────────────────────────────"
wait
