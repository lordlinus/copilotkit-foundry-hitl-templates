# forgewright gallery — make targets.
SHELL := /bin/bash
TEMPLATE := templates/agentic-copilot-foundry
DIR ?= .

.PHONY: help new-app new-template manifest check list verify-template

help:
	@echo "forgewright gallery:"
	@echo "  make new-app NAME=<app> [DIR=<dir>]   scaffold a runnable app from the canonical template"
	@echo "  make new-template NAME=<n> DISPLAY='..' DESC='..'   add a template variant"
	@echo "  make manifest                         regenerate forgewright-template.yml + README table"
	@echo "  make check                            verify generated manifests are in sync"
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

check:
	@node scripts/generate-manifest.mjs --check

list:
	@ls -1 templates

verify-template:
	@bash $(TEMPLATE)/scripts/verify.sh
