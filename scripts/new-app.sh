#!/usr/bin/env bash
# Repository entrypoint for the self-contained scaffold skill.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/.agents/skills/copilotkit-foundry-scaffold/scripts/new-app.sh" "$@"
