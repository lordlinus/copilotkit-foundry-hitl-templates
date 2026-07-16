#!/usr/bin/env bash
# doctor.sh — check every tool, login, azd env, and port the make targets need,
# printing the fix next to each failure. Read-only: changes nothing, deploys
# nothing. Run it first whenever any make target fails.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh
. scripts/foundry-regions.sh

info "toolchain"
for t in uv node npm az azd; do
  command -v "$t" >/dev/null 2>&1 && pass "$t installed" \
    || fail "$t missing — see the README prerequisites table"
done
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] && pass "node >= 22 ($(node --version))" \
    || fail "node >= 22 required (have $(node --version))"
fi

info "Azure logins (azd keeps its own credential — BOTH are needed)"
ACCT="$(az account show --query '[name,user.name]' -o tsv 2>/dev/null | paste -sd' ' || true)"
[ -n "$ACCT" ] && pass "az logged in: $ACCT" \
  || fail "az not logged in — run: az login"
azd auth login --check-status >/dev/null 2>&1 && pass "azd logged in" \
  || fail "azd not logged in — run: azd auth login"

# NOTE: `azd env get-values` exits 0 and synthesizes AZURE_ENV_NAME from the
# directory name even when no env exists — only specific keys prove anything.
info "LOCAL azd env (./.azure — what make local/smoke/e2e run the agent against)"
# `azd env get-values` PROMPTS (and can create an env) when none exists — gate
# it behind `azd env list` (read-only) and close stdin so it can never hang.
ENVVALS=""
if azd env list -o json 2>/dev/null </dev/null | grep -q '"IsDefault":[[:space:]]*true'; then
  ENVVALS="$(azd env get-values 2>/dev/null </dev/null || true)"
fi
# `azd ai agent run` does NOT prompt for a subscription/project and does NOT
# provision anything on its own (verified against Microsoft Learn's Foundry
# Hosted Agents quickstarts and live against azd 1.27 + azure.ai.agents
# 1.0.0-beta.5 — it crashes with KeyError: FOUNDRY_PROJECT_ENDPOINT instead).
# `make smoke`/`make local`/`make e2e` auto-heal this from hosted/.azure (see
# scripts/lib-agentrun.sh); this check just tells you the fix if that fails too.
printf '%s\n' "$ENVVALS" | grep -q "^FOUNDRY_PROJECT_ENDPOINT=" && pass "FOUNDRY_PROJECT_ENDPOINT set" \
  || fail "FOUNDRY_PROJECT_ENDPOINT missing — run 'make up' first (make smoke/local/e2e then reuse its project automatically), or: azd env set FOUNDRY_PROJECT_ENDPOINT <project endpoint>"
# the model name may instead be a literal default in azure.yaml (the shipped shape)
model_literal="$(grep -A1 -m1 'name: AZURE_AI_MODEL_DEPLOYMENT_NAME' azure.yaml | awk '/value:/{print $2}')"
case "$model_literal" in '${'*) model_literal="";; esac
if printf '%s\n' "$ENVVALS" | grep -q "^AZURE_AI_MODEL_DEPLOYMENT_NAME="; then
  pass "AZURE_AI_MODEL_DEPLOYMENT_NAME set (azd env)"
elif [ -n "$model_literal" ]; then
  pass "AZURE_AI_MODEL_DEPLOYMENT_NAME defaults to '$model_literal' (azure.yaml literal; azd env can override)"
else
  fail "AZURE_AI_MODEL_DEPLOYMENT_NAME missing — azure.yaml carries a \${} placeholder and the azd env doesn't define it: azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME <model-deployment-name>"
fi

info "HOSTED azd env (hosted/.azure — what make up / up-app deploy)"
HOSTED_ENVVALS=""
if (cd hosted && azd env list -o json 2>/dev/null </dev/null) | grep -q '"IsDefault":[[:space:]]*true'; then
  HOSTED_ENVVALS="$(cd hosted && azd env get-values 2>/dev/null </dev/null || true)"
fi
if printf '%s\n' "$HOSTED_ENVVALS" | grep -q '^AZURE_SUBSCRIPTION_ID='; then
  pass "hosted env exists"
  HOSTED_LOC="$(printf '%s\n' "$HOSTED_ENVVALS" | sed -n 's/^AZURE_LOCATION="\(.*\)"$/\1/p')"
  if [ -n "$HOSTED_LOC" ]; then
    if foundry_region_is_supported "$HOSTED_LOC"; then
      pass "AZURE_LOCATION '$HOSTED_LOC' supports Foundry hosted agents"
    else
      fail "AZURE_LOCATION '$HOSTED_LOC' does NOT support Foundry hosted agents — 'make up' will fail deep in provisioning. Supported: $(foundry_region_list). Fix: cd hosted && azd env set AZURE_LOCATION <region>, then 'make up' again"
    fi
  fi
else
  warn "no hosted env yet — 'make up' creates it (required before up-app / verify-deployed); supported regions: $(foundry_region_list)"
fi

info "ports (8088 agent, 8080 bridge, 3000 frontend)"
for p in 8088 8080 3000; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    exec 3>&- 3<&- || true
    fail ":$p in use — fuser -k $p/tcp"
  else
    pass ":$p free"
  fi
done

finish
