#!/usr/bin/env bash
# Shared helper: start `azd ai agent run` (the REAL agent, locally, connected to the
# env's Foundry resources) + the bridge in DIRECT mode pointed at it. Sets AGENT_PID
# and BRIDGE_PID. Requires `az login` + an azd env with a provisioned Foundry project
# (run `make up` once). No mock — this is the real hosted agent running locally.
start_agent_and_bridge() {
  local ROOT="$1" BPY="$2" AGENT_PORT="${3:-8088}" BRIDGE_PORT="${4:-8080}"
  local NAME; NAME="$(grep -E '^AGENT_NAME' "$ROOT/src/agent.py" | sed -E 's/.*"([^"]+)".*/\1/')"

  echo "▸ azd ai agent run (real agent, local :$AGENT_PORT) …"
  ( cd "$ROOT" && azd ai agent run --no-inspector --port "$AGENT_PORT" >/tmp/forge-agent.log 2>&1 ) &
  AGENT_PID=$!
  for _ in $(seq 1 120); do
    curl -sf "http://127.0.0.1:$AGENT_PORT/readiness" >/dev/null 2>&1 && break
    kill -0 "$AGENT_PID" 2>/dev/null || { echo "✗ azd ai agent run exited:"; tail -20 /tmp/forge-agent.log; return 1; }
    sleep 1
  done
  curl -sf "http://127.0.0.1:$AGENT_PORT/readiness" >/dev/null || { echo "✗ agent not ready"; tail -20 /tmp/forge-agent.log; return 1; }

  echo "▸ bridge (DIRECT → local agent) on :$BRIDGE_PORT …"
  HOSTED_AGENT_DIRECT_URL="http://127.0.0.1:$AGENT_PORT" \
    HOSTED_AGENT_NAME="$NAME" HOSTED_AUTH=none \
    "$BPY" -m uvicorn bridge_app:app --app-dir "$ROOT/backend" --host 127.0.0.1 --port "$BRIDGE_PORT" --log-level warning &
  BRIDGE_PID=$!
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$BRIDGE_PORT/healthz" >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -sf "http://127.0.0.1:$BRIDGE_PORT/healthz" >/dev/null || { echo "✗ bridge not ready"; return 1; }
}
