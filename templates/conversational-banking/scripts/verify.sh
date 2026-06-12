#!/usr/bin/env bash
# verify.sh — read-only structural checks for a forgewright app.
#
# Proves the load-bearing wiring is intact: the four AG-UI resilience patches,
# Chat Completions (not Responses), the CopilotKit multi-route bridge, the HITL
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
[ -f backend/ag_ui_app.py ]        && pass "backend/ag_ui_app.py present" || fail "backend/ag_ui_app.py missing"
[ -f hosted/azure.yaml ]           && pass "hosted/azure.yaml present"   || fail "hosted/azure.yaml missing"
[ -f hosted/responses/main.py ]    && pass "hosted/responses/main.py present" || fail "hosted/responses/main.py missing"
[ -f hosted/responses/agent.yaml ] && pass "hosted/responses/agent.yaml present" || fail "hosted/responses/agent.yaml missing"
[ -f hosted/responses/agent.manifest.yaml ] && pass "hosted/responses/agent.manifest.yaml present" || fail "agent.manifest.yaml missing"
[ -f hosted/responses/Dockerfile ] && pass "hosted/responses/Dockerfile present" || fail "hosted Dockerfile missing"
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
if [ -n "$hosted_azure_name" ] && [ "$hosted_azure_name" = "$hosted_agent_yaml_name" ] && [ "$hosted_azure_name" = "$hosted_manifest_name" ]; then
  pass "hosted name consistent across azure.yaml + agent.yaml + manifest ($hosted_azure_name)"
else
  fail "hosted name DRIFT: azure.yaml='$hosted_azure_name' agent.yaml='$hosted_agent_yaml_name' manifest='$hosted_manifest_name'"
fi

# ── Chat Completions, NOT Responses (HITL re-exec correctness) ──────────────
grep -q 'OpenAIChatCompletionClient' src/agent.py \
  && pass "agent.py uses OpenAIChatCompletionClient (Chat Completions)" \
  || fail "agent.py NOT using OpenAIChatCompletionClient — HITL approve-resume will 400 'No tool output found'"
if grep -qE 'from agent_framework_openai import.*\bOpenAIChatClient\b' src/agent.py; then
  fail "agent.py imports the Responses-API OpenAIChatClient — HITL approve-resume will 400. Use OpenAIChatCompletionClient."
fi

# ── Keyless Foundry path present ────────────────────────────────────────────
grep -q 'ai.azure.com/.default' src/agent.py \
  && pass "agent.py requests the ai.azure.com audience (keyless Foundry)" \
  || warn "agent.py does not set the ai.azure.com audience — project-scoped token may 401"

# ── The four AG-UI resilience patches ───────────────────────────────────────
patches_missing=0
grep -q 'convert_agui_tools_to_agent_framework' backend/ag_ui_app.py || { fail "AG-UI Patch 1 (tool-name collisions) MISSING"; patches_missing=1; }
grep -q '_build_messages_snapshot'  backend/ag_ui_app.py || { fail "AG-UI Patch 2 (split multi-tool snapshot) MISSING"; patches_missing=1; }
grep -q '_emit_approval_request' backend/ag_ui_app.py || { fail "AG-UI Patch 2b (fresh parent_message_id) MISSING"; patches_missing=1; }
grep -q '_make_approval_tool_result_events\|_clean_resolved_approvals_from_snapshot' backend/ag_ui_app.py || { fail "AG-UI Patch 2c (persist HITL result) MISSING"; patches_missing=1; }
grep -q 'normalize_agui_input_messages' backend/ag_ui_app.py || { fail "AG-UI Patch 3 (orphan repair) MISSING"; patches_missing=1; }
[ "$patches_missing" -eq 0 ] && pass "all four AG-UI resilience patches present"

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

# ── HITL confirm_changes contract ───────────────────────────────────────────
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'name:[[:space:]]*"confirm_changes"' frontend/ && pass "confirm_changes action wired" \
  || fail "no confirm_changes useCopilotAction — approval card never renders"
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'renderAndWaitForResponse' frontend/ && pass "renderAndWaitForResponse present" \
  || fail "renderAndWaitForResponse NOT used on confirm_changes"
grep -rq --exclude-dir=node_modules --exclude-dir=.next 'available:[[:space:]]*"disabled"' frontend/ && pass 'confirm_changes is available:"disabled"' \
  || warn 'confirm_changes SHOULD be available:"disabled"'
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

# ── azure.yaml host + extension pin ─────────────────────────────────────────
grep -q 'host:[[:space:]]*azure\.ai\.agent' hosted/azure.yaml \
  && pass "azure.yaml uses host: azure.ai.agent" || fail "azure.yaml MUST declare host: azure.ai.agent"
grep -q 'azure\.ai\.agents' hosted/azure.yaml \
  && pass "azure.ai.agents extension pinned" || warn "azure.ai.agents extension not pinned in azure.yaml"

finish
