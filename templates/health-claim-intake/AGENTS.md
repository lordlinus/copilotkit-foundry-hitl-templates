# AGENTS.md

This project was scaffolded from the **forgewright** template: a Next.js +
CopilotKit chat UI over a FastAPI + AG-UI (SSE) backend hosting one Microsoft
Agent Framework agent, connected keyless to Azure AI Foundry, with native
human-in-the-loop approval.

**Load `.agents/skills/forgewright/SKILL.md`** before changing agent or bridge
code — it lists the load-bearing rules, the known traps, and the Definition of
Done.

## Where to make changes

- `src/agent.py` — instructions + tools. Keep ≥1 read tool and ≥1
  `@tool(approval_mode="always_require")` consequential tool.
- `frontend/components/Chat.tsx` — render cards for your tools (keep
  `confirm_changes` as-is).
- If you rename tools, update `scripts/smoke.py`'s domain prompts (READ_PROMPT/
  ACTION_PROMPT/STATE_FIELD/READ_TOOL) so `make smoke` still exercises the HITL gate.

## Do NOT edit

`backend/{bridge_app,hosted_proxy,hosted_client}.py`;
`build_hosted_agent()` (FoundryChatClient) in `src/agent.py`; and the CopilotKit
bridge in `frontend/app/api/copilotkit/[[...slug]]/route.ts`.


## Prove it

`make verify` (structural) and `make smoke` (bridge → REAL agent via `azd ai agent
run`; needs `az login` + a provisioned project) must both pass. `azd`/dev-server
starting is not proof.
