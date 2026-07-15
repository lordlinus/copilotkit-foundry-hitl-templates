#!/usr/bin/env bash
# Instantiate the bundled Cookiecutter template via `uvx cookiecutter` (no
# persistent install — uv caches it after the first run). Requires `uv`:
# https://docs.astral.sh/uv/.
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$SKILL_ROOT/assets/agentic-copilot-foundry.tar.gz"

NAME="${1:-}"
TARGET_DIR="${2:-$PWD}"
if [ -z "$NAME" ]; then
  echo "usage: new-app.sh <app-name> [target-dir]" >&2
  exit 2
fi
command -v uv >/dev/null 2>&1 || {
  echo "✗ uv is required to run the bundled cookiecutter template — install it from https://docs.astral.sh/uv/" >&2
  exit 1
}
[ -f "$ARCHIVE" ] || {
  echo "✗ bundled template missing: $ARCHIVE" >&2
  echo "  Reinstall the skill or, in the gallery repository, run: make package-skill" >&2
  exit 1
}

DEST="$TARGET_DIR/$NAME"
[ -e "$DEST" ] && { echo "✗ '$DEST' already exists" >&2; exit 1; }
mkdir -p "$TARGET_DIR"

tmpl="$(mktemp -d)"
trap 'rm -rf "$tmpl"' EXIT
tar -xzf "$ARCHIVE" -C "$tmpl"

# app-name validation, file rewriting (agentic-copilot-foundry/agentic_copilot_foundry/
# agentic-copilot-foundry -> the new name), and the "next steps" message all live in
# the template's cookiecutter.json + hooks/ — see
# .agents/skills/copilotkit-foundry-scaffold/cookiecutter/ in the gallery repository.
uvx cookiecutter "$tmpl" --no-input "app_name=$NAME" --output-dir "$TARGET_DIR"
