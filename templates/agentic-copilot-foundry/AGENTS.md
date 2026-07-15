# AGENTS.md

This project was scaffolded from the **copilotkit-foundry-hitl-templates** gallery: a Next.js +
CopilotKit chat UI over a FastAPI + AG-UI (SSE) backend hosting one Microsoft
Agent Framework agent, connected keyless to Azure AI Foundry, with native
human-in-the-loop approval.

**For changing agent or bridge code, load
`.agents/skills/copilotkit-foundry-hitl/SKILL.md`** — the Day-2 dev skill lists the
load-bearing rules, the known traps, the Definition of Done, and step-by-step
workflows (add-tool, wire-hitl, debug-hitl, shared-state, upgrade-loop).
`.agents/skills/copilotkit-foundry-scaffold/SKILL.md` is the quick app-specific guide.

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

`make verify` (structural), `make smoke` (protocol), and `make e2e` (real Chromium
UI) must pass. The latter two drive the REAL agent via `azd ai agent run` and need
`az login` + a provisioned project. `azd`/dev-server starting is not proof.
