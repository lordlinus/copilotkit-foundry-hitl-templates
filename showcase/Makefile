# forgewright showcase — convenience targets.
# Real Foundry by default; set LLM_MODE=mock for an offline plumbing test.
SHELL := /bin/bash
GATEWAY_DIR := gateway
UI_DIR := ui

.PHONY: help install gateway ui-dev ui-build smoke deploy pages-build clean

help:
	@echo "make install      - set up the gateway venv (uv) + UI deps (npm)"
	@echo "make gateway      - run the multi-agent gateway on :8080 (real Foundry)"
	@echo "make ui-dev       - run the static gallery UI on :5173 (Vite dev server)"
	@echo "make ui-build     - production build of the UI into ui/dist"
	@echo "make smoke        - offline end-to-end HITL smoke (LLM_MODE=mock) via the gateway"
	@echo "make deploy       - azd up the gateway Container App (from gateway/)"
	@echo ""
	@echo "Real Foundry needs: az login + FOUNDRY_PROJECT_ENDPOINT + AZURE_AI_MODEL_DEPLOYMENT_NAME"

install:
	cd $(GATEWAY_DIR) && uv venv --seed --python 3.12 .venv && \
	  uv pip install --python .venv/bin/python --prerelease=allow \
	    -r ../../templates/agentic-copilot-foundry/backend/requirements.txt \
	    -r requirements.txt
	cd $(UI_DIR) && npm install

gateway:
	cd $(GATEWAY_DIR) && PORT=8080 .venv/bin/python launcher.py

ui-dev:
	cd $(UI_DIR) && npm run dev

ui-build:
	cd $(UI_DIR) && npm run build

smoke:
	@echo "Starting gateway in mock mode and running the HITL smoke…"
	@cd $(GATEWAY_DIR); \
	  LLM_MODE=mock PORT=8080 .venv/bin/python launcher.py > /tmp/showcase-smoke.log 2>&1 & \
	  echo $$! > /tmp/showcase-smoke.pid; \
	  for i in $$(seq 1 40); do curl -sf http://localhost:8080/healthz >/dev/null 2>&1 && break; sleep 1; done; \
	  sed 's#^BASE = .*#BASE = "http://localhost:8080/agents/agentic-copilot-foundry/"#' \
	    ../../templates/agentic-copilot-foundry/scripts/smoke.py > /tmp/showcase-smoke.py; \
	  .venv/bin/python /tmp/showcase-smoke.py; rc=$$?; \
	  kill $$(cat /tmp/showcase-smoke.pid) 2>/dev/null; exit $$rc

deploy:
	cd $(GATEWAY_DIR) && azd up

clean:
	rm -rf $(UI_DIR)/dist $(GATEWAY_DIR)/.venv
