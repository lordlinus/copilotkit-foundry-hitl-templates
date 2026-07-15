#!/usr/bin/env bash
# doctor.sh — check every tool, login, azd env, and port the make targets need,
# printing the fix next to each failure. Read-only: changes nothing, deploys
# nothing. Run it first whenever any make target fails.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

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
ENVVALS="$(azd env get-values 2>/dev/null || true)"
for v in FOUNDRY_PROJECT_ENDPOINT AZURE_AI_MODEL_DEPLOYMENT_NAME; do
  printf '%s\n' "$ENVVALS" | grep -q "^$v=" && pass "$v set" \
    || fail "$v missing — run 'azd ai agent run' once interactively (Ctrl-C when serving), or: azd env set $v <value>"
done

info "HOSTED azd env (hosted/.azure — what make up / up-app deploy)"
if (cd hosted && azd env get-values 2>/dev/null || true) | grep -q '^AZURE_SUBSCRIPTION_ID='; then
  pass "hosted env exists"
else
  warn "no hosted env yet — 'make up' creates it (required before up-app / verify-deployed)"
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
