# copilotkit-foundry-hitl-templates gallery — make targets.
SHELL := /bin/bash
TEMPLATE := templates/agentic-copilot-foundry
DIR ?= .

.PHONY: help new-app new-template manifest check list verify-template sync-skill-refs package-skill release-check

help:
	@echo "copilotkit-foundry-hitl-templates gallery:"
	@echo "  make new-app NAME=<app> [DIR=<dir>]   scaffold a runnable app from the canonical template"
	@echo "  make new-template NAME=<n> DISPLAY='..' DESC='..'   add a template variant"
	@echo "  make manifest                         regenerate template-manifest.yml + README table"
	@echo "  make sync-skill-refs                  copy root skill references/*.md into all templates"
	@echo "  make package-skill                    rebuild the self-contained scaffold skill asset"
	@echo "  make check                            verify manifests + skill copies/assets are in sync"
	@echo "  make release-check                    run offline publication checks"
	@echo "  make list                             list templates"
	@echo "  make verify-template                  run the canonical template's structural checks"

new-app:
	@test -n "$(NAME)" || { echo "usage: make new-app NAME=<app> [DIR=<dir>]"; exit 2; }
	@bash scripts/new-app.sh "$(NAME)" "$(DIR)"

new-template:
	@test -n "$(NAME)" || { echo "usage: make new-template NAME=<n> DISPLAY='..' DESC='..'"; exit 2; }
	@bash scripts/new-template.sh "$(NAME)" "$(DISPLAY)" "$(DESC)"

manifest:
	@node scripts/generate-manifest.mjs

sync-skill-refs:
	@bash scripts/sync-skill-refs.sh

package-skill:
	@bash scripts/package-scaffold-skill.sh

check:
	@node scripts/generate-manifest.mjs --check
	@bash scripts/sync-skill-refs.sh --check
	@bash scripts/package-scaffold-skill.sh --check

release-check: check
	@bash scripts/release-check.sh

list:
	@ls -1 templates

verify-template:
	@bash $(TEMPLATE)/scripts/verify.sh
