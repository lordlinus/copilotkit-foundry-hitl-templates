# The single-prompt workflow

How a coding agent turns one sentence into a verified, running app.

## What the user types

> "Build me an agentic app that can search a product catalog and place an order,
> but require my approval before any order is placed."

## What the agent does (and you can do by hand)

1. **Load the skill.** `AGENTS.md` points to
   `.agents/skills/copilotkit-foundry-scaffold/SKILL.md` — the scaffold on-ramp. It hands off to the
   `copilotkit-foundry-hitl` skill (the load-bearing rules, the known traps, the 7
   patterns, and the Day-2 workflows) for everything after the initial customization.

2. **Scaffold.**
   ```bash
   bash <scaffold-skill-dir>/scripts/new-app.sh product-orderer ~/projects
   ```
   This extracts the skill's bundled canonical template into
   `~/projects/product-orderer/` and rewrites the agent-name tokens. No gallery
   checkout is required.

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
   make verify     # structural checks — offline, run it first
   az login && azd auth login   # once — azd keeps its own credential
   make up         # provision the Foundry project + deploy the hosted agent
                    # (only some regions support hosted agents — this fails
                    # fast with the full list if yours doesn't)
   make smoke      # end-to-end HITL against the REAL agent, run locally via
                    # `azd ai agent run` (reuses the project 'make up' just
                    # provisioned — no extra manual step)
   make e2e        # real browser: read, approve, reject, follow-up after approval
   ```
   All three must be green. This is the bar for **dev-done** (it proves the
   bridge/HITL protocol against a local run of the agent code — not that
   anything is deployed).

5. **Run / deploy.** `make local` for the dev loop. Before calling the app
   *deployed* or *live*: `make up-app` (bridge + frontend Container Apps) and
   `make verify-deployed` (a REAL active Foundry agent answers a live invoke).
   `make down` tears everything back down when you're done with it.

6. **Continue development.** For any change beyond the initial customization — a new
   tool, a new approval, shared state, a bug, an upgrade — load
   `.agents/skills/copilotkit-foundry-hitl/SKILL.md` and pick the matching workflow
   (add-tool, wire-hitl, debug-hitl, shared-state, upgrade-loop).

## Why this is reliable

The template ships the *hard parts already solved and verified*: the AG-UI bridge
(`HostedProxyAgent`) that forwards turns and `mcp_approval_response` to the Foundry
hosted agent so HITL re-executes server-side, the CopilotKit v2 multi-route bridge,
the keyless `FoundryChatClient` hosted agent — run the SAME agent locally for
development via `azd ai agent run`, which `make smoke` exercises through the bridge.
The agent only writes domain logic, then the checks prove the wiring
still holds. The agent is told never to declare success on an unverified build.
