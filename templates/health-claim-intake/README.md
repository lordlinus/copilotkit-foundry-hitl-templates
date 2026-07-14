# Health Insurance Claim Intake (HITL)

A claim intake assistant: a **Next.js + CopilotKit** chat UI over a
**AG-UI bridge** to an **Azure AI Foundry HOSTED agent** that runs all tools and
HITL server-side. The same agent IS the deployed Foundry hosted agent (`build_hosted_agent`,
Responses); `azd up` publishes it.

The agent intakes multiple claim documents, **auto-fills the claim form** from
them, lets the user **review and edit** fields, and **submits** the claim only
after the user approves:

- `list_documents` — show the intake documents (read).
- `extract_claim_form` — auto-fill the form from the documents (read/compute).
- `update_claim_field` — apply a user edit to a draft field (no approval).
- `get_claim` — read the current claim (form, status, reference).
- `submit_claim` — **approval-gated** (`approval_mode="always_require"`): files
  the claim only after the user clicks Approve.

The demo uses a deterministic in-memory store and canned documents. Replace the
extraction in `src/agent.py` with a real OCR / document-intelligence pipeline.

## Getting started

```bash
# Run the REAL agent locally (needs `az login` + a provisioned project — see `make up`):
make smoke        # bridge → REAL agent via `azd ai agent run`; asserts the HITL flow
make verify       # read-only structural checks
make e2e          # built CopilotKit UI in Chromium: read/reject/approve/follow-up

# Local dev loop (needs a Foundry project + `az login`):
cp backend/.env.example backend/.env       # set FOUNDRY_PROJECT_ENDPOINT + model
make local                                 # backend :8080 + frontend :3000

# Deploy the hosted Foundry agent (needs az login to the Foundry tenant):
make up
```

Open http://localhost:3000 and try: *"list the documents"* →
*"extract the claim form"* → *"change the billed amount to 1450"* →
*"submit the claim"* — submission pauses for your Approve/Reject.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent (claim store, read/extract tools + approval-gated submit). `build_hosted_agent()` → **FoundryChatClient** (the single brain — same code local + deployed). **Edit tools + instructions.** |
| `backend/bridge_app.py` | The AG-UI server → `HostedProxyAgent` (DIRECT local / platform deployed). **Don't edit.** |
| `backend/hosted_proxy.py` | `HostedProxyAgent`: forward turns → hosted agent, translate Responses → AG-UI, forward `mcp_approval_response`. **Don't edit.** |
| `backend/hosted_client.py` | Streaming Responses driver (per-thread conversation + session). **Don't edit.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
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
| `make e2e` | real-browser HITL journey against the REAL agent |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make clean` | remove venv / node_modules / .next |

## Definition of Done

Not done until `make verify`, `make smoke`, **and** `make e2e` are green, and — for the deployed
path — a live browser E2E shows HITL approve re-executing and reject not. See
`.agents/skills/copilotkit-foundry-hitl/SKILL.md`.
