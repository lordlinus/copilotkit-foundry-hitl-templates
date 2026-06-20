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
   In `frontend/components/`, add CopilotKit v2 render cards for the new tools
   (`useRenderTool`); keep the `useHumanInTheLoop` / `confirm_changes` HITL gate
   unchanged.
   If you renamed tools, update `scripts/smoke.py`'s domain prompts (`READ_PROMPT` /
   `ACTION_PROMPT` / `STATE_FIELD` / `READ_TOOL`) so smoke still drives the read +
   the approval-gated tool.

4. **Prove it.**
   ```bash
   cd ~/projects/product-orderer
   make verify     # structural checks
   make smoke      # end-to-end HITL against the REAL agent (azd ai agent run)
   ```
   Both must be green. This is the bar for "done". `make smoke` needs `az login` +
   a provisioned Foundry project (`make up` once).

5. **Run / deploy (optional).** `make local` for the dev loop; set
   `FOUNDRY_PROJECT_ENDPOINT` + `AZURE_AI_MODEL_DEPLOYMENT_NAME` and
   `make up` to publish the hosted Foundry agent.

## Why this is reliable

The template ships the *hard parts already solved and verified*: the AG-UI bridge
(`HostedProxyAgent`) that forwards turns and `mcp_approval_response` to the Foundry
hosted agent so HITL re-executes server-side, the CopilotKit v2 multi-route bridge,
the keyless `FoundryChatClient` hosted agent — run the SAME agent locally for
development via `azd ai agent run`, which `make smoke` exercises through the bridge.
The agent only writes domain logic, then the checks prove the wiring
still holds. The agent is told never to declare success on an unverified build.
