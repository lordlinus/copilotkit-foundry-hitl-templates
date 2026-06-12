#!/usr/bin/env bash
# new-app.sh — instantiate a runnable app from the canonical forgewright template.
#
#   scripts/new-app.sh <app-name> [target-dir]
#
# Copies templates/agentic-copilot-foundry/ into <target-dir>/<app-name>/ and
# rewrites the agent-name tokens so src/agent.py, the CopilotKit route + provider,
# and the hosted azd descriptors all stay consistent. The result already runs and
# already passes `make smoke`. After this, customize src/agent.py + Chat.tsx, then
# `make verify && make smoke`.
set -euo pipefail

GALLERY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$GALLERY_ROOT/templates/agentic-copilot-foundry"

NAME="${1:-}"
TARGET_DIR="${2:-$PWD}"
if [ -z "$NAME" ]; then
  echo "usage: new-app.sh <app-name> [target-dir]" >&2
  exit 2
fi
if ! printf '%s' "$NAME" | grep -Eq '^[a-z][a-z0-9-]{0,63}$'; then
  echo "✗ invalid app name '$NAME'. Use lowercase letters/digits/hyphens, start with a letter." >&2
  exit 2
fi
[ -d "$TEMPLATE" ] || { echo "✗ template not found: $TEMPLATE" >&2; exit 1; }

DEST="$TARGET_DIR/$NAME"
[ -e "$DEST" ] && { echo "✗ '$DEST' already exists" >&2; exit 1; }

RUNTIME_NAME="${NAME//-/_}"   # snake_case for AGENT_NAME + <CopilotKit agent=>

mkdir -p "$DEST"
# Copy without build artifacts.
( cd "$TEMPLATE" && tar \
    --exclude='node_modules' --exclude='.venv' --exclude='.next' \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='.azure' \
    -cf - . ) | ( cd "$DEST" && tar -xf - )

# Token rewrites (longest/compound tokens first so substrings don't double-apply).
#   forgewright_app  -> <runtime_name>   (snake; AGENT_NAME / route / provider)
#   forgewright-app  -> <app-name>       (kebab; hosted yaml / frontend pkg name)
#   APP_NAME := agentic-copilot-foundry -> <app-name>
rewrite() {
  local from="$1" to="$2"
  grep -rIl --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.next \
    -- "$from" "$DEST" 2>/dev/null | while IFS= read -r f; do
      sed -i "s|$from|$to|g" "$f"
  done
}
rewrite "forgewright_app" "$RUNTIME_NAME"
rewrite "forgewright-app" "$NAME"
sed -i "s|^APP_NAME[[:space:]]*:=.*|APP_NAME   := $NAME|" "$DEST/Makefile"

echo
echo "✓ created $DEST"
echo "  runtime agent name : $RUNTIME_NAME"
echo "  next:"
echo "    1. cd $DEST"
echo "    2. edit src/agent.py        (instructions + your read & approval-gated tools)"
echo "    3. edit frontend/components/Chat.tsx  (render cards for your tools)"
echo "    4. make verify && make smoke   (must be green — no Azure needed)"
echo "    5. make local                  (dev loop on http://localhost:3000)"
echo "    6. make up                     (deploy hosted Foundry agent via azd)"
