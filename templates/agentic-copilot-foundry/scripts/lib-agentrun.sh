#!/usr/bin/env bash
# Shared helper: start `azd ai agent run` (the REAL agent, locally, connected to the
# env's Foundry resources) + the bridge in DIRECT mode pointed at it. Sets AGENT_PID
# and BRIDGE_PID. Requires `az login` + an azd env with a provisioned Foundry project
# (run `make up` once). No mock — this is the real hosted agent running locally.
start_agent_and_bridge() {
  local ROOT="$1" BPY="$2" AGENT_PORT="${3:-8088}" BRIDGE_PORT="${4:-8080}"
  local NAME; NAME="$(grep -E '^AGENT_NAME' "$ROOT/src/agent.py" | sed -E 's/.*"([^"]+)".*/\1/')"

  # Fail fast if the agent port is already taken — otherwise `azd ai agent run`
  # can't bind, /readiness answers from the STALE agent, and the bridge silently
  # drives the WRONG agent (e.g. another template's). Refuse rather than mislead.
  if curl -sf "http://127.0.0.1:$AGENT_PORT/readiness" >/dev/null 2>&1; then
    echo "✗ :$AGENT_PORT is already serving an agent — refusing to start (would use the"
    echo "  wrong agent). Stop it first:  fuser -k $AGENT_PORT/tcp   (or set AGENT_PORT)."
    return 1
  fi

  # Same fail-fast for the bridge port: anything already on it (typically a stale
  # bridge from an interrupted run) means our uvicorn can't bind and the run dies
  # late with an unhelpful "bridge not ready".
  if (exec 3<>"/dev/tcp/127.0.0.1/$BRIDGE_PORT") 2>/dev/null; then
    exec 3>&- 3<&- || true
    echo "✗ :$BRIDGE_PORT is already in use — the bridge can't bind. Stop whatever holds"
    echo "  it first:  fuser -k $BRIDGE_PORT/tcp"
    return 1
  fi

  # Fail fast if the agent's required config can't be resolved — otherwise
  # `azd ai agent run` boots the agent and it dies deep inside a Python stack
  # trace (KeyError: FOUNDRY_PROJECT_ENDPOINT / "Model is required…"). The values
  # come from the LOCAL azd env at the app root (./.azure) or the shell env.
  # `azd env get-values` PROMPTS (hangs a non-TTY run) when no env exists — gate
  # it behind `azd env list` (read-only) and close stdin so it can never hang.
  local ENVVALS="" MISSING="" v model_literal
  if (cd "$ROOT" && azd env list -o json 2>/dev/null </dev/null) | grep -q '"IsDefault":[[:space:]]*true'; then
    ENVVALS="$( (cd "$ROOT" && azd env get-values 2>/dev/null </dev/null) || true )"
  fi
  # the model name may be a literal default in azure.yaml (the shipped shape) —
  # only demand it from the env when azure.yaml carries a ${} placeholder
  model_literal="$(grep -A1 -m1 'name: AZURE_AI_MODEL_DEPLOYMENT_NAME' "$ROOT/azure.yaml" | awk '/value:/{print $2}')"
  case "$model_literal" in '${'*) model_literal="";; esac
  check_missing() {
    MISSING=""
    for v in FOUNDRY_PROJECT_ENDPOINT AZURE_AI_MODEL_DEPLOYMENT_NAME; do
      [ -n "${!v:-}" ] && continue
      [ "$v" = "AZURE_AI_MODEL_DEPLOYMENT_NAME" ] && [ -n "$model_literal" ] && continue
      printf '%s\n' "$ENVVALS" | grep -q "^$v=" || MISSING="$MISSING $v"
    done
  }
  check_missing

  # Auto-heal: `azd ai agent run` does NOT prompt for a subscription/project and
  # does NOT provision anything on its own — verified against Microsoft Learn
  # ("Foundry Hosted Agents" quickstarts: FOUNDRY_PROJECT_ENDPOINT must be set
  # BEFORE `azd ai agent run`) and live against azd 1.27 + azure.ai.agents
  # 1.0.0-beta.5 (it crashes with KeyError: FOUNDRY_PROJECT_ENDPOINT instead).
  # So if the LOCAL env (./.azure) is missing it, reuse the project `make up`
  # already provisioned in hosted/.azure rather than provisioning a second,
  # redundant Foundry project just for local dev.
  if printf '%s\n' "$MISSING" | grep -q FOUNDRY_PROJECT_ENDPOINT && [ -d "$ROOT/hosted/.azure" ]; then
    local hosted_endpoint
    hosted_endpoint="$(cd "$ROOT/hosted" && azd env get-value FOUNDRY_PROJECT_ENDPOINT 2>/dev/null </dev/null || true)"
    if [ -n "$hosted_endpoint" ]; then
      echo "▸ no local FOUNDRY_PROJECT_ENDPOINT — reusing the one 'make up' provisioned (hosted/.azure)"
      # --no-prompt + </dev/null: when the LOCAL ./.azure has no environment yet,
      # `azd env set` implicitly creates one and — on a real TTY — can prompt for
      # subscription/location. Stdout/stderr are silenced above, so that prompt is
      # invisible and the run just hangs until the user Ctrl-C's it. --no-prompt
      # makes azd resolve automatically (deriving the env name from cwd) or fail
      # fast instead of blocking on unseen input; </dev/null is defense in depth.
      (cd "$ROOT" && azd env set FOUNDRY_PROJECT_ENDPOINT "$hosted_endpoint" --no-prompt >/dev/null 2>&1 </dev/null) || true
      ENVVALS="$( (cd "$ROOT" && azd env get-values 2>/dev/null </dev/null) || true )"
      check_missing
    fi
  fi

  if [ -n "$MISSING" ]; then
    echo "✗ the local agent has no model/project config — missing:$MISSING"
    echo "  These live in the LOCAL azd env at the app root (./.azure), which is"
    echo "  SEPARATE from hosted/.azure (created by 'make up'). One-time fix — run"
    echo "  'make up' first (so hosted/.azure exists), then retry; or set the"
    echo "  values directly:"
    echo "    azd env set FOUNDRY_PROJECT_ENDPOINT https://<account>.services.ai.azure.com/api/projects/<project>"
    echo "    azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME <model-deployment-name>"
    echo "  ('make doctor' checks all prerequisites with the fix for each.)"
    return 1
  fi

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

# Stop the agent + bridge and FREE their ports. `azd ai agent run` spawns a
# grandchild (azure-ai-agents-linux → python) that holds the port, so killing the
# launcher PID is not enough — also free the ports so the next run doesn't silently
# attach to a stale agent. Safe to call from a trap.
stop_agent_and_bridge() {
  local AGENT_PORT="${1:-8088}" BRIDGE_PORT="${2:-8080}"
  kill "${BRIDGE_PID:-}" "${AGENT_PID:-}" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${BRIDGE_PORT}/tcp" 2>/dev/null || true
    fuser -k "${AGENT_PORT}/tcp" 2>/dev/null || true
  fi
}
