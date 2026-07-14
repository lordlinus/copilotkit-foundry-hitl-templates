#!/usr/bin/env bash
# Instantiate the bundled canonical template.
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$SKILL_ROOT/assets/agentic-copilot-foundry.tar.gz"

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
[ -f "$ARCHIVE" ] || {
  echo "✗ bundled template missing: $ARCHIVE" >&2
  echo "  Reinstall the skill or, in the gallery repository, run: make package-skill" >&2
  exit 1
}

DEST="$TARGET_DIR/$NAME"
[ -e "$DEST" ] && { echo "✗ '$DEST' already exists" >&2; exit 1; }

RUNTIME_NAME="${NAME//-/_}"
mkdir -p "$DEST"
tar -xzf "$ARCHIVE" -C "$DEST"

rewrite() {
  local from="$1" to="$2"
  grep -rIl --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.next \
    -- "$from" "$DEST" 2>/dev/null | while IFS= read -r f; do
      sed -i "s|$from|$to|g" "$f"
  done
}
rewrite "agentic-copilot-foundry" "$NAME"
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
echo "    4. update scripts/smoke.py and frontend/e2e/hitl.spec.ts for those tools"
echo "    5. make verify              (offline structural gate)"
echo "    6. make smoke && make e2e   (real agent; needs Azure login + a provisioned project)"
echo "    7. make up                  (deploy hosted Foundry agent via azd)"
