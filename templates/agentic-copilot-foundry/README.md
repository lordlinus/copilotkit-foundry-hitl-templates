# Agentic CopilotKit + Foundry (HITL)

A domain-agnostic starter: a **Next.js + CopilotKit v2** chat UI over an **AG-UI
bridge** to an **Azure AI Foundry HOSTED agent** that runs all tools, history, and
**human-in-the-loop approval** server-side. The bridge (`backend/bridge_app.py` →
`HostedProxyAgent`) forwards each turn to the hosted agent over the Responses
protocol and forwards the HITL decision as an `mcp_approval_response`, so an
approved tool **re-executes server-side** (verified live). For local dev,
`azd ai agent run` runs the SAME agent on your machine and the bridge points at it
(DIRECT mode) — no mock.

The demo agent holds a single numeric value: `get_value` reads it (no approval);
`apply_delta` changes it (approval-gated). Replace these with your domain.

## Getting started

```bash
# Run the REAL agent locally (needs `az login` + a provisioned project — see `make up`):
make smoke        # bridge → REAL agent via `azd ai agent run`; asserts the HITL flow
make verify       # read-only structural checks

# Local dev loop:
make local        # REAL agent (azd ai agent run) + bridge :8080 + frontend :3000

# Deploy the Foundry HOSTED agent (needs az login to the Foundry tenant):
make up

# Drive the DEPLOYED agent from the bridge (rich UI + working HITL):
#   set FOUNDRY_PROJECT_ENDPOINT + HOSTED_AGENT_NAME, then run the bridge.
```

Open http://localhost:3000 and try: *"what's the current value?"* then
*"apply a delta of 25"* — the change pauses for your Approve/Reject.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent. `build_hosted_agent()` → **FoundryChatClient** (the single brain — same code local + deployed). **Edit tools + instructions.** |
| `backend/bridge_app.py` | The AG-UI server → `HostedProxyAgent` (DIRECT local / platform deployed). **Don't edit.** |
| `backend/hosted_proxy.py` | `HostedProxyAgent`: forward turns → hosted agent, translate Responses → AG-UI, forward `mcp_approval_response`. **Don't edit.** |
| `backend/hosted_client.py` | Streaming Responses driver (per-thread conversation + session). **Don't edit.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
| `frontend/app/page.tsx` | `<CopilotKit useSingleEndpoint={false} agent=...>`. |
| `frontend/components/Chat.tsx` | CopilotKit v2 cards: `useHumanInTheLoop` (HITL) + `useRenderTool`. **Edit render cards.** |
| `hosted/` | `azd` → Foundry hosted agent (Responses). `build_hosted_agent()`. |
| `scripts/verify.sh`, `scripts/smoke.py` | The proof: structural + end-to-end vs the real local agent. |

## Scripts (make targets)

| Target | Does |
| --- | --- |
| `make preflight` | install backend venv + frontend deps |
| `make local` | run bridge + frontend |
| `make verify` | read-only structural checks |
| `make smoke` | end-to-end HITL test against the REAL agent (`azd ai agent run`) |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make clean` | remove venv / node_modules / .next |

## Definition of Done

Not done until `make verify` **and** `make smoke` are green, and — for the deployed
path — a live browser E2E shows HITL approve re-executing (state changes) and reject
not. See `.agents/skills/forgewright/SKILL.md`.
