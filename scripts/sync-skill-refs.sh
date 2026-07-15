#!/usr/bin/env bash
# sync-skill-refs.sh — keep the shared dev skill in sync, root -> templates.
#
#   scripts/sync-skill-refs.sh            copy the root dev skill into all 3 templates
#   scripts/sync-skill-refs.sh --check    diff only; exit non-zero on any mismatch
#
# The repo ships TWO skills under .agents/skills/:
#
#   copilotkit-foundry-scaffold — the scaffold on-ramp. Its SKILL.md is intentionally
#                              DIFFERENT per copy (root = "build a NEW app"; each
#                              template = "customize/run/deploy THIS app"), so it is
#                              hand-authored per copy and NOT synced by this script.
#
#   copilotkit-foundry-hitl  — the Day-2 development skill (architecture, the 7
#                              patterns, troubleshooting, hosted-deploy, and the
#                              add-tool/wire-hitl/debug-hitl/shared-state/upgrade-loop
#                              workflows). This skill is fully DOMAIN-AGNOSTIC, so it
#                              is byte-identical across the root skill and every
#                              template's own copy. Each app ships a self-contained
#                              skill, so the content has to be physically copied in —
#                              which is exactly the kind of thing that silently drifts.
#                              This script makes the ROOT copy authoritative and a
#                              single `sync` (or `--check` in CI/local) the only way a
#                              template's copy should ever change.
#
# So: EVERY file under .agents/skills/copilotkit-foundry-hitl/ (SKILL.md + references/*
# + workflows/*) is synced; copilotkit-foundry-scaffold/SKILL.md is not.
set -euo pipefail

GALLERY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_REL=".agents/skills/copilotkit-foundry-hitl"
ROOT_SKILL="$GALLERY_ROOT/$SKILL_REL"
TEMPLATES=(agentic-copilot-foundry conversational-banking health-claim-intake)

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$ROOT_SKILL" ] || { echo "✗ missing root dev skill: $ROOT_SKILL" >&2; exit 1; }

# Every tracked file under the root dev skill, relative to the skill dir.
mapfile -t FILES < <(cd "$ROOT_SKILL" && find . -type f | sed 's|^\./||' | sort)

fail=0
for t in "${TEMPLATES[@]}"; do
  dest_root="$GALLERY_ROOT/templates/$t/$SKILL_REL"
  for f in "${FILES[@]}"; do
    src="$ROOT_SKILL/$f"
    dest="$dest_root/$f"
    if [ "$CHECK" = 1 ]; then
      if ! diff -q "$src" "$dest" >/dev/null 2>&1; then
        echo "✗ out of sync: templates/$t/$SKILL_REL/$f (run scripts/sync-skill-refs.sh)" >&2
        fail=1
      fi
    else
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
      echo "✓ synced templates/$t/$SKILL_REL/$f"
    fi
  done
  # In --check mode, also flag stray files in the template copy that no longer exist at root.
  if [ "$CHECK" = 1 ] && [ -d "$dest_root" ]; then
    while IFS= read -r df; do
      rel="${df#"$dest_root/"}"
      if [ ! -f "$ROOT_SKILL/$rel" ]; then
        echo "✗ stray file: templates/$t/$SKILL_REL/$rel (not in root skill; run scripts/sync-skill-refs.sh)" >&2
        fail=1
      fi
    done < <(find "$dest_root" -type f)
  fi
done

if [ "$CHECK" = 1 ]; then
  if [ "$fail" = 0 ]; then
    echo "✓ all template copies of copilotkit-foundry-hitl match the root skill"
  else
    exit 1
  fi
fi
