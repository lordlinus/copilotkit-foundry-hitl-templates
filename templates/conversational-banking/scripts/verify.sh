#!/usr/bin/env bash
# verify.sh — read-only structural checks for an app from this gallery.
#
# Proves the load-bearing wiring is intact: the two AG-UI resilience patches (HITL
# approval routing + multi-tool snapshot split, both proven load-bearing),
# FoundryChatClient (Responses), the CopilotKit multi-route bridge, the HITL
# confirm_changes contract, name consistency, and the hosted/azd descriptors.
# Read-only (greps + path tests). For behavior, use scripts/smoke.py.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

ROOT="$(cd .. && pwd)"
info "app root: $ROOT"
cd "$ROOT"

# ── Layout ────────────────────────────────────────────────────────────────
[ -f src/agent.py ]                && pass "src/agent.py present"        || fail "src/agent.py missing"
[ -f backend/bridge_app.py ]       && pass "backend/bridge_app.py present (the AG-UI bridge)" || fail "backend/bridge_app.py missing"
[ -f hosted/azure.yaml ]           && pass "hosted/azure.yaml present"   || fail "hosted/azure.yaml missing"
[ -f hosted/responses/main.py ]    && pass "hosted/responses/main.py present" || fail "hosted/responses/main.py missing"
[ -f hosted/responses/agent.yaml ] && pass "hosted/responses/agent.yaml present" || fail "hosted/responses/agent.yaml missing"
[ -f hosted/responses/agent.manifest.yaml ] && pass "hosted/responses/agent.manifest.yaml present" || fail "agent.manifest.yaml missing"
[ -f hosted/responses/Dockerfile ] && pass "hosted/responses/Dockerfile present" || fail "hosted Dockerfile missing"
[ -f scripts/e2e_run.sh ]          && pass "scripts/e2e_run.sh present" || fail "scripts/e2e_run.sh missing"
[ -f frontend/e2e/hitl.spec.ts ]   && pass "frontend HITL browser E2E present" || fail "frontend/e2e/hitl.spec.ts missing"
[ -d "frontend/app/api/copilotkit/[[...slug]]" ] && pass "frontend catch-all route dir present" \
    || fail "frontend/app/api/copilotkit/[[...slug]]/ MISSING — Threads/Info will 404"

# ── Name consistency (drift breaks routing + hosted deploy) ─────────────────
runtime_name=$(grep -E '^AGENT_NAME[[:space:]]*=' src/agent.py | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')
provider_agent=$(grep -rEho --exclude-dir=node_modules --exclude-dir=.next 'agent="[^"]+"' frontend/ | sed -E 's/.*"([^"]+)"/\1/' | grep -vx '\.\.\.' | head -1)
route_agent=$(grep -E 'AGENT_NAME[[:space:]]*=' "frontend/app/api/copilotkit/[[...slug]]/route.ts" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [ -n "$runtime_name" ] && [ "$runtime_name" = "$provider_agent" ] && [ "$runtime_name" = "$route_agent" ]; then
  pass "runtime name consistent: agent.py == <CopilotKit agent> == route.ts ($runtime_name)"
else
  fail "runtime name DRIFT: agent.py='$runtime_name' provider='$provider_agent' route='$route_agent'"
fi
hosted_azure_name=$(awk '/^name:/{print $2; exit}' hosted/azure.yaml)
hosted_agent_yaml_name=$(awk '/^name:/{print $2; exit}' hosted/responses/agent.yaml)
hosted_manifest_name=$(awk '/^name:/{print $2; exit}' hosted/responses/agent.manifest.yaml)
app_name=$(awk '/^APP_NAME[[:space:]]*:/{print $3; exit}' Makefile)
if [ -n "$hosted_azure_name" ] && [ "$hosted_azure_name" = "$hosted_agent_yaml_name" ] \
  && [ "$hosted_azure_name" = "$hosted_manifest_name" ] && [ "$hosted_azure_name" = "$app_name" ]; then
  pass "hosted name consistent across Makefile + azure.yaml + agent.yaml + manifest ($hosted_azure_name)"
else
  fail "hosted name DRIFT: Makefile='$app_name' azure.yaml='$hosted_azure_name' agent.yaml='$hosted_agent_yaml_name' manifest='$hosted_manifest_name'"
fi

# ── Resource + protocol-version consistency across the paired manifests ────
# Each azd project (root LOCAL-DEV, hosted/ DEPLOY) declares cpu/memory in BOTH
# its azure.yaml (azd's own copy, for infra generation) and its agent.yaml (the
# AgentSchema ContainerAgent definition Foundry actually reads) — these two
# copies aren't cross-read by tooling, so drift is silent. Same for the
# protocol version across agent.yaml/agent.manifest.yaml, where drift is NOT
# silent (the hosted runtime fails fast at startup) — see references/architecture.md.
root_azure_cpu=$(grep -m1 'cpu:' azure.yaml | sed -E 's/.*cpu:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/')
root_azure_mem=$(grep -m1 'memory:' azure.yaml | sed -E 's/.*memory:[[:space:]]*//')
root_agent_cpu=$(grep -m1 'cpu:' agent.yaml | sed -E 's/.*cpu:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/')
root_agent_mem=$(grep -m1 'memory:' agent.yaml | sed -E 's/.*memory:[[:space:]]*//')
if [ "$root_azure_cpu" = "$root_agent_cpu" ] && [ "$root_azure_mem" = "$root_agent_mem" ]; then
  pass "root resources consistent: azure.yaml == agent.yaml (cpu=$root_agent_cpu, memory=$root_agent_mem)"
else
  fail "root resources DRIFT: azure.yaml cpu=$root_azure_cpu/mem=$root_azure_mem vs agent.yaml cpu=$root_agent_cpu/mem=$root_agent_mem"
fi

hosted_azure_cpu=$(grep -m1 'cpu:' hosted/azure.yaml | sed -E 's/.*cpu:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/')
hosted_azure_mem=$(grep -m1 'memory:' hosted/azure.yaml | sed -E 's/.*memory:[[:space:]]*//')
hosted_agent_cpu=$(grep -m1 'cpu:' hosted/responses/agent.yaml | sed -E 's/.*cpu:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/')
hosted_agent_mem=$(grep -m1 'memory:' hosted/responses/agent.yaml | sed -E 's/.*memory:[[:space:]]*//')
if [ "$hosted_azure_cpu" = "$hosted_agent_cpu" ] && [ "$hosted_azure_mem" = "$hosted_agent_mem" ]; then
  pass "hosted resources consistent: azure.yaml == agent.yaml (cpu=$hosted_agent_cpu, memory=$hosted_agent_mem)"
else
  fail "hosted resources DRIFT: azure.yaml cpu=$hosted_azure_cpu/mem=$hosted_azure_mem vs agent.yaml cpu=$hosted_agent_cpu/mem=$hosted_agent_mem"
fi

root_agent_proto=$(grep -m1 'version:' agent.yaml | sed -E 's/.*version:[[:space:]]*//')
hosted_agent_proto=$(grep -m1 'version:' hosted/responses/agent.yaml | sed -E 's/.*version:[[:space:]]*//')
hosted_manifest_proto=$(grep -m1 'version:' hosted/responses/agent.manifest.yaml | sed -E 's/.*version:[[:space:]]*//')
if [ "$root_agent_proto" = "$hosted_agent_proto" ] && [ "$root_agent_proto" = "$hosted_manifest_proto" ]; then
  pass "protocol version consistent: agent.yaml (root) == hosted agent.yaml == agent.manifest.yaml ($root_agent_proto)"
else
  fail "protocol version DRIFT: root agent.yaml=$root_agent_proto hosted agent.yaml=$hosted_agent_proto manifest=$hosted_manifest_proto — hosted runtime will RuntimeError at startup on mismatch"
fi

# ── The bridge: HostedProxyAgent → hosted agent (azd ai agent run locally) ──
grep -q 'add_agent_framework_fastapi_endpoint' backend/bridge_app.py \
  && pass "bridge mounts add_agent_framework_fastapi_endpoint (AG-UI endpoint)" \
  || fail "bridge_app does NOT use add_agent_framework_fastapi_endpoint"
grep -q 'HostedProxyAgent' backend/bridge_app.py && [ -f backend/hosted_proxy.py ] \
  && pass "bridge = HostedProxyAgent (forwards turns to the hosted agent)" \
  || fail "bridge_app/hosted_proxy.py missing HostedProxyAgent — bridge can't reach the hosted agent"
grep -q 'mcp_approval_response' backend/hosted_proxy.py \
  && pass "hosted_proxy forwards HITL approvals as mcp_approval_response (re-executes server-side)" \
  || fail "hosted_proxy does NOT send mcp_approval_response — HITL approve won't re-execute the tool"
grep -q '_pending_calls' backend/hosted_proxy.py && grep -q '_approved_calls' backend/hosted_proxy.py \
  && pass "hosted_proxy replays approved result-only calls for persistent UI cards" \
  || fail "hosted_proxy missing approved-call replay — action result cards vanish after approval"
grep -q '_is_confirm_changes_response' backend/bridge_app.py && grep -q '_resolve_approval_responses' backend/bridge_app.py \
  && pass "bridge neutralises ag-ui local approval interception (routes HITL to the agent)" \
  || fail "bridge_app does NOT patch _is_confirm_changes_response/_resolve_approval_responses — approvals swallowed locally"
grep -q 'converse_stream' backend/hosted_client.py \
  && pass "hosted_client streams the hosted agent's Responses (conversation + session)" \
  || fail "hosted_client missing converse_stream"
grep -q 'HOSTED_AGENT_DIRECT_URL' backend/hosted_client.py \
  && pass "hosted_client supports DIRECT mode (local 'azd ai agent run' via HOSTED_AGENT_DIRECT_URL)" \
  || fail "hosted_client missing DIRECT mode — make local/smoke can't drive a local agent"
grep -q 'startupCommand' azure.yaml \
  && pass "azure.yaml has startupCommand (azd ai agent run runs the agent locally)" \
  || warn "azure.yaml has no startupCommand — azd ai agent run will auto-detect"
grep -q 'azd ai agent run' scripts/lib-agentrun.sh 2>/dev/null \
  && pass "make local/smoke run the REAL agent locally via azd ai agent run (no mock)" \
  || fail "scripts/lib-agentrun.sh missing — make local/smoke can't start the local agent"
! ls src/mock_client.py backend/mock_hosted.py >/dev/null 2>&1 \
  && pass "no mock client (the real agent runs locally via azd ai agent run)" \
  || warn "stale mock files present — remove them; azd ai agent run replaces the mock"
grep -q 'def build_hosted_agent' src/agent.py \
  && pass "agent.py defines build_hosted_agent() (the single brain)" \
  || fail "agent.py missing build_hosted_agent()"
grep -q 'FoundryChatClient' src/agent.py \
  && pass "build_hosted_agent uses FoundryChatClient (Responses) — HITL approve-resume re-executes" \
  || fail "build_hosted_agent NOT using FoundryChatClient — hosted HITL approve-resume breaks"
grep -q 'build_hosted_agent' hosted/responses/main.py && grep -q 'build_hosted_agent' app.py \
  && pass "hosted entrypoints (app.py + hosted/responses/main.py) serve build_hosted_agent" \
  || fail "hosted entrypoints do NOT serve build_hosted_agent"
grep -q 'SSEKeepAliveMiddleware' backend/bridge_app.py \
  && pass "bridge has SSEKeepAliveMiddleware (long silent server-side tools don't drop the SSE)" \
  || warn "bridge_app has no SSE keepalive"
! grep -qE 'agent-framework-(foundry|openai)\b' backend/requirements.txt \
  && pass "deployed bridge image deps are lean (no foundry/openai — bridge runs no model)" \
  || warn "bridge image carries foundry/openai deps it doesn't need (bridge runs no model)"
grep -qE 'httpx==' backend/requirements.txt \
  && pass "bridge requirements pin httpx (hosted_client; prerelease pulls httpx 1.0.dev)" \
  || warn "httpx not pinned — hosted_client may break on prerelease resolution"
grep -q 'bridge_app:app' backend/Dockerfile \
  && pass "backend Dockerfile deploys the bridge (bridge_app:app)" \
  || fail "backend Dockerfile does NOT deploy bridge_app:app"

# ── CopilotKit bridge: five required choices ────────────────────────────────
route="frontend/app/api/copilotkit/[[...slug]]/route.ts"
grep -q 'from "@copilotkit/runtime/v2"' "$route" && pass "route imports @copilotkit/runtime/v2" \
  || fail "route does NOT import @copilotkit/runtime/v2 (lib CopilotRuntime → Threads 422)"
grep -q 'createCopilotHonoHandler' "$route" && pass "route uses createCopilotHonoHandler (multi-route)" \
  || fail "route does NOT use createCopilotHonoHandler — Threads endpoints 405"
for verb in POST GET PATCH DELETE; do
  grep -qE "^export const $verb\b" "$route" && pass "route exports $verb" || fail "route does NOT export $verb"
done
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'useSingleEndpoint={false}' frontend/ && pass "<CopilotKit useSingleEndpoint={false}> set" \
  || fail "<CopilotKit useSingleEndpoint={false}> NOT set — Threads/Info will 404"
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'fetch.bind(window)' frontend/ && pass "frontend binds global fetch (CopilotKit/@ag-ui Illegal-invocation guard)" \
  || fail "frontend does NOT bind global fetch — CopilotKit's @ag-ui HttpAgent throws 'Illegal invocation' on agent run (add the bind in app/layout.tsx)"
grep -q '"test:e2e"' frontend/package.json && grep -q '@playwright/test' frontend/package.json \
  && pass "frontend exposes Playwright E2E" || fail "frontend package.json missing test:e2e/@playwright"

# ── CopilotKit v2 hooks + HITL confirm_changes contract ─────────────────────
grep -rq --exclude-dir=node_modules --exclude-dir=.next '@copilotkit/react-core/v2' frontend/ && pass "frontend uses CopilotKit v2 hooks (@copilotkit/react-core/v2)" \
  || fail "frontend not on @copilotkit/react-core/v2 — migrate to v2 hooks (useAgent/useFrontendTool/useRenderTool/useHumanInTheLoop)"
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'useHumanInTheLoop' frontend/ && pass "useHumanInTheLoop wired (v2 HITL)" \
  || fail "no useHumanInTheLoop — v2 HITL approval card never renders"
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'name:[[:space:]]*"confirm_changes"' frontend/ && pass "confirm_changes HITL action wired" \
  || fail "no confirm_changes useHumanInTheLoop — approval card never renders"
grep -rq --exclude-dir=node_modules --exclude-dir=.next '{ accepted' frontend/ && pass "approval response uses {accepted, steps} shape" \
  || fail "approval payload not {accepted, ...} — backend check is \`\"accepted\" in parsed\`"

# ── At least one approval-gated tool ────────────────────────────────────────
grep -q 'approval_mode="always_require"' src/agent.py \
  && pass "src/agent.py has an approval_mode=always_require tool" \
  || fail "no approval_mode=always_require tool — there is no HITL gate to demo"

# ── MCR base images (ACR Tasks rate-limit guard) ────────────────────────────
grep -qE '^FROM[[:space:]]+mcr\.microsoft\.com/' hosted/responses/Dockerfile \
  && pass "hosted Dockerfile uses MCR base" || fail "hosted Dockerfile NOT MCR base"
grep -qE '^FROM[[:space:]]+mcr\.microsoft\.com/' backend/Dockerfile \
  && pass "backend Dockerfile uses MCR base" || fail "backend Dockerfile NOT MCR base"
grep -qE '^FROM[[:space:]]+mcr\.microsoft\.com/' frontend/Dockerfile \
  && pass "frontend Dockerfile uses MCR base" || fail "frontend Dockerfile NOT MCR base"

# ── azure.yaml host + extension pin ─────────────────────────────────────────
grep -q 'host:[[:space:]]*azure\.ai\.agent' hosted/azure.yaml \
  && pass "azure.yaml uses host: azure.ai.agent" || fail "azure.yaml MUST declare host: azure.ai.agent"
grep -q 'azure\.ai\.agents' hosted/azure.yaml \
  && pass "azure.ai.agents extension pinned" || warn "azure.ai.agents extension not pinned in azure.yaml"

# ── deploy/: bridge + frontend as Container Apps (the piece hosted/ doesn't cover) ─
[ -f deploy/azure.yaml ]              && pass "deploy/azure.yaml present (bridge + frontend Container Apps)" \
  || fail "deploy/azure.yaml missing — no automated way to deploy the bridge/frontend"
[ -f deploy/infra/main.bicep ]        && pass "deploy/infra/main.bicep present" || fail "deploy/infra/main.bicep missing"
[ -f deploy/infra/workload.bicep ]    && pass "deploy/infra/workload.bicep present" || fail "deploy/infra/workload.bicep missing"
grep -q 'host:[[:space:]]*containerapp' deploy/azure.yaml \
  && pass "deploy/azure.yaml declares host: containerapp for bridge + frontend" \
  || fail "deploy/azure.yaml MUST declare host: containerapp"
grep -qE '^\s*bridge:' deploy/azure.yaml && grep -qE '^\s*frontend:' deploy/azure.yaml \
  && pass "deploy/azure.yaml defines both the bridge and frontend services" \
  || fail "deploy/azure.yaml missing the bridge or frontend service"
grep -q 'eed3b665-ab3a-47b6-8f48-c9382fb1dad6' deploy/infra/main.bicep \
  && pass "deploy grants the bridge identity the Foundry Agent Consumer role (least-privilege agent access)" \
  || fail "deploy/infra/main.bicep missing the Foundry Agent Consumer role assignment — bridge can't call the hosted agent"
grep -q 'FOUNDRY_PROJECT_ENDPOINT' deploy/infra/workload.bicep && grep -q 'HOSTED_AGENT_NAME' deploy/infra/workload.bicep \
  && pass "bridge Container App is wired with FOUNDRY_PROJECT_ENDPOINT + HOSTED_AGENT_NAME" \
  || fail "deploy/infra/workload.bicep missing bridge env wiring to the hosted agent"
grep -q 'AG_UI_BACKEND_URL' deploy/infra/workload.bicep \
  && pass "frontend Container App is wired with AG_UI_BACKEND_URL (points at the bridge)" \
  || fail "deploy/infra/workload.bicep missing frontend->bridge wiring"
grep -qE 'external:\s*false' deploy/infra/workload.bicep \
  && pass "bridge Container App ingress is internal-only (not exposed to the public internet)" \
  || warn "bridge Container App ingress may be externally exposed — confirm this is intended"

finish
