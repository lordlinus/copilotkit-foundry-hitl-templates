# Agentic CopilotKit + Foundry (HITL)

A domain-agnostic starter: a **Next.js + CopilotKit** chat UI over a
**FastAPI + AG-UI (SSE)** backend that hosts **one Microsoft Agent Framework
agent**, connected **keyless** to **Azure AI Foundry**, with **native
human-in-the-loop approval** on consequential tools. The same agent is also
publishable as a **Foundry hosted agent** (Responses protocol) via `azd`.

The demo agent holds a single numeric value: `get_value` reads it (no approval);
`apply_delta` changes it (approval-gated). Replace these with your domain.

## Getting started

```bash
# Offline — no Azure, no real model (used by CI):
make smoke        # starts the backend with LLM_MODE=mock and asserts the HITL flow
make verify       # read-only structural checks

# Local dev loop (needs a Foundry project + `az login`, OR LLM_MODE=mock):
cp backend/.env.example backend/.env       # set FOUNDRY_PROJECT_ENDPOINT + model
make local                                 # backend :8080 + frontend :3000

# Deploy the hosted Foundry agent (needs az login to the Foundry tenant):
make up
```

Open http://localhost:3000 and try: *"what's the current value?"* then
*"apply a delta of 25"* — the change pauses for your Approve/Reject.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent: instructions, tools, `build_chat_client()` (mock / key / keyless-Foundry). **Edit this.** |
| `src/mock_client.py` | Deterministic offline client for `LLM_MODE=mock`. |
| `backend/ag_ui_app.py` | FastAPI + AG-UI/SSE host + the four resilience patches. **Don't edit the patches.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
| `frontend/app/page.tsx` | `<CopilotKit useSingleEndpoint={false} agent=...>`. |
| `frontend/components/Chat.tsx` | `confirm_changes` HITL card + per-tool render cards. **Edit render cards.** |
| `hosted/` | `azd` → Foundry hosted agent (Responses protocol). |
| `scripts/verify.sh`, `scripts/smoke.py` | The proof: structural + offline end-to-end. |

## Scripts (make targets)

| Target | Does |
| --- | --- |
| `make preflight` | install backend venv + frontend deps |
| `make local` | run backend + frontend |
| `make verify` | read-only structural checks |
| `make smoke` | offline end-to-end HITL test (`LLM_MODE=mock`) |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make clean` | remove venv / node_modules / .next |

## Definition of Done

Not done until `make verify` **and** `make smoke` are green. See
`.agents/skills/forgewright/SKILL.md`.
