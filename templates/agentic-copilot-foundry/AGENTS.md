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
- If you rename tools, update `src/mock_client.py` and `scripts/smoke.py` so
  `make smoke` still exercises the HITL gate.

## Do NOT edit

The four AG-UI resilience patches in `backend/ag_ui_app.py`, the CopilotKit
bridge in `frontend/app/api/copilotkit/[[...slug]]/route.ts`, and the keyless
Chat-Completions client in `build_chat_client()`.

## Prove it

`make verify` (structural) and `make smoke` (offline, `LLM_MODE=mock`) must both
pass. `azd`/dev-server starting is not proof.
