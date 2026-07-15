# showcase — convenience targets.
# Runs the real hosted-agent runtime + AG-UI bridge per agent; needs `az login`
# + a Foundry project (FOUNDRY_PROJECT_ENDPOINT + AZURE_AI_MODEL_DEPLOYMENT_NAME).
SHELL := /bin/bash
GATEWAY_DIR := gateway
UI_DIR := ui

.PHONY: help install gateway ui-dev ui-build verify test-dom smoke deploy pages-build clean

help:
	@echo "make install      - set up the gateway venv (uv) + UI deps (npm)"
	@echo "make gateway      - run the multi-agent gateway on :8080 (real Foundry)"
	@echo "make ui-dev       - run the static gallery UI on :5173 (Vite dev server)"
	@echo "make ui-build     - production build of the UI into ui/dist"
	@echo "make verify       - UI build + Tier-1 jsdom DOM tests (render/UX gate)"
	@echo "make test-dom     - run the Tier-1 jsdom DOM tests only"
	@echo "make smoke        - end-to-end HITL smoke via the gateway (needs az login + Foundry)"
	@echo "make deploy       - azd up the gateway Container App (from gateway/)"
	@echo ""
	@echo "Real Foundry needs: az login + FOUNDRY_PROJECT_ENDPOINT + AZURE_AI_MODEL_DEPLOYMENT_NAME"

install:
	cd $(GATEWAY_DIR) && uv venv --seed --python 3.12 .venv && \
	  uv pip install --python .venv/bin/python --prerelease=allow -r requirements.txt
	cd $(UI_DIR) && npm install

gateway:
	cd $(GATEWAY_DIR) && PORT=8080 .venv/bin/python launcher.py

ui-dev:
	cd $(UI_DIR) && npm run dev

ui-build:
	cd $(UI_DIR) && npm run build

test-dom:
	cd $(UI_DIR) && npm run test:dom

# UI render/UX gate: production build must compile AND the jsdom DOM tests must
# pass. Backend `make smoke` is necessary but not sufficient for a UI change.
verify: ui-build test-dom
	@echo "✓ showcase UI verified (build + DOM tests)"

smoke:
	@echo "Starting the gateway (real hosted-agent runtime + bridge) and running the HITL smoke…"
	@cd $(GATEWAY_DIR); \
	  PORT=8080 .venv/bin/python launcher.py > /tmp/showcase-smoke.log 2>&1 & \
	  for i in $$(seq 1 90); do curl -sf http://localhost:8080/healthz >/dev/null 2>&1 && break; sleep 1; done; \
	  sed 's#^BASE = .*#BASE = "http://localhost:8080/agents/agentic-copilot-foundry/"#' \
	    ../../templates/agentic-copilot-foundry/scripts/smoke.py > /tmp/showcase-smoke.py; \
	  .venv/bin/python /tmp/showcase-smoke.py; rc=$$?; \
	  fuser -k 8080/tcp 9101/tcp 8101/tcp 2>/dev/null; exit $$rc

deploy:
	cd $(GATEWAY_DIR) && azd up

clean:
	rm -rf $(UI_DIR)/dist $(GATEWAY_DIR)/.venv
