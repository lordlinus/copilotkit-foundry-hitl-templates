# The single-prompt workflow

How a coding agent turns one sentence into a verified, running app.

## What the user types

> "Build me an agentic app that can search a product catalog and place an order,
> but require my approval before any order is placed."

## What the agent does (and you can do by hand)

1. **Load the skill.** `AGENTS.md` points to
   `.agents/skills/forgewright/SKILL.md`. Read it — it is the build recipe, the
   load-bearing rules, the anti-patterns, and the Definition of Done.

2. **Scaffold.**
   ```bash
   scripts/new-app.sh product-orderer ~/projects
   ```
   This copies the canonical template into `~/projects/product-orderer/` and
   rewrites the agent-name tokens. The result already runs and already passes
   `make smoke`.

3. **Customize — only the extension points.** In `src/agent.py`:
   - Set `_INSTRUCTIONS` for the catalog/order domain.
   - Replace the demo `get_value` with read tools (e.g. `search_catalog`,
     `get_order_status`).
   - Replace the demo `apply_delta` with the consequential tool, keeping
     `@tool(approval_mode="always_require")` (e.g. `place_order`).
   In `frontend/components/Chat.tsx`, add render cards for the new tools; keep the
   `confirm_changes` HITL action unchanged.
   If you renamed tools, update `src/mock_client.py` and `scripts/smoke.py` so the
   offline smoke still drives the read + the approval-gated tool.

4. **Prove it.**
   ```bash
   cd ~/projects/product-orderer
   make verify     # structural checks
   make smoke      # offline end-to-end HITL — no Azure, no model
   ```
   Both must be green. This is the bar for "done".

5. **Run / deploy (optional).** `make local` for the dev loop; set
   `FOUNDRY_PROJECT_ENDPOINT` + `AZURE_AI_MODEL_DEPLOYMENT_NAME` and
   `make up` to publish the hosted Foundry agent.

## Why this is reliable

The template ships the *hard parts already solved and verified*: the four AG-UI
resilience patches, the CopilotKit multi-route bridge, the keyless
Chat-Completions Foundry client, and an offline mock that exercises the whole
HITL path. The agent only writes domain logic, then the checks prove the wiring
still holds. The agent is told never to declare success on an unverified build.
