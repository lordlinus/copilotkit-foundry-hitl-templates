#!/usr/bin/env bash
# Build/check the self-contained COOKIECUTTER template archive shipped with the
# scaffold skill (used by `new-app.sh` via `uvx cookiecutter`).
#
# The canonical, directly-runnable source of truth stays
# templates/agentic-copilot-foundry/ exactly as-is (literal names, so `make
# verify`/`smoke`/`e2e` keep working on it unmodified). This script derives a
# Cookiecutter-shaped package from it on every build:
#   1. Export ONLY git-tracked files (`git ls-files`) — never the raw working
#      directory, which can carry gitignored local artifacts (.env.local,
#      playwright-report/, etc.) that differ per machine/checkout.
#   2. Rewrite the three literal naming tokens to Jinja expressions
#      (`{{ cookiecutter.app_name }}` / its underscored form).
#   3. Escape the one genuine `{{...}}` collision — hosted/responses/
#      agent.manifest.yaml's OWN `{{ PARAM }}` init-time template syntax
#      (unrelated to Cookiecutter; see the note in hosted-deploy.md) — so
#      Cookiecutter's Jinja pass emits it back out literally instead of
#      trying to resolve it as a Cookiecutter variable.
#   4. Bundle in cookiecutter.json + hooks/ (input validation + next-steps
#      message) from .agents/skills/copilotkit-foundry-scaffold/cookiecutter/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_REL="templates/agentic-copilot-foundry"
CC_SUPPORT="$ROOT/.agents/skills/copilotkit-foundry-scaffold/cookiecutter"
DEST="$ROOT/.agents/skills/copilotkit-foundry-scaffold/assets/agentic-copilot-foundry.tar.gz"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$ROOT/$TEMPLATE_REL" ] || { echo "✗ template not found: $ROOT/$TEMPLATE_REL" >&2; exit 1; }
[ -f "$CC_SUPPORT/cookiecutter.json" ] || { echo "✗ cookiecutter support files missing: $CC_SUPPORT" >&2; exit 1; }

STAGE="$(mktemp -d)"
filelist="$(mktemp)"
tmp="$(mktemp)"
trap 'rm -rf "$STAGE"; rm -f "$filelist" "$tmp"' EXIT

PKG_DIR='{{cookiecutter.app_name}}'
mkdir -p "$STAGE/$PKG_DIR"

cd "$ROOT"
git ls-files -z -- "$TEMPLATE_REL" > "$filelist"
tar --null -T "$filelist" --transform "s#^${TEMPLATE_REL}/#./#" -cf - \
  | tar -xf - -C "$STAGE/$PKG_DIR"

python3 - "$STAGE/$PKG_DIR" <<'PYEOF'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

# Order-independent: the two tokens never overlap as substrings of each other
# (hyphenated vs underscored).
TOKEN_REPLACEMENTS = [
    ("agentic-copilot-foundry", "{{ cookiecutter.app_name }}"),
    ("agentic_copilot_foundry", "{{ cookiecutter.app_name.replace('-', '_') }}"),
]

for path in root.rglob("*"):
    if not path.is_file():
        continue
    text = path.read_text(encoding="utf-8")
    changed = text
    for old, new in TOKEN_REPLACEMENTS:
        changed = changed.replace(old, new)
    if changed != text:
        path.write_text(changed, encoding="utf-8")

# The ONE genuine collision: agent.manifest.yaml's own `{{ PARAM }}` init-time
# template syntax (Foundry's `azd ai agent init -m <manifest-url>`), unrelated
# to Cookiecutter. Escape it so Jinja emits it back out literally.
manifest = root / "hosted" / "responses" / "agent.manifest.yaml"
if manifest.exists():
    text = manifest.read_text(encoding="utf-8")
    escaped = text.replace(
        "{{AZURE_AI_MODEL_DEPLOYMENT_NAME}}",
        "{{ '{{' }}AZURE_AI_MODEL_DEPLOYMENT_NAME{{ '}}' }}",
    )
    if escaped != text:
        manifest.write_text(escaped, encoding="utf-8")
PYEOF

cp "$CC_SUPPORT/cookiecutter.json" "$STAGE/cookiecutter.json"
cp -r "$CC_SUPPORT/hooks" "$STAGE/hooks"

tar \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 --group=0 --numeric-owner \
  -cf - -C "$STAGE" . | gzip -n -9 > "$tmp"

if [ "$CHECK" = 1 ]; then
  if [ ! -f "$DEST" ] || ! cmp -s "$tmp" "$DEST"; then
    echo "✗ scaffold skill archive is stale (run make package-skill)" >&2
    exit 1
  fi
  echo "✓ scaffold skill archive matches the canonical template"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
mv "$tmp" "$DEST"
trap - EXIT
echo "✓ packaged $DEST ($(du -h "$DEST" | awk '{print $1}'))"
