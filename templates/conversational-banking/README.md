# Conversational Banking (HITL)

A conversational banking assistant: a **Next.js + CopilotKit** chat UI over a
**AG-UI bridge** to an **Azure AI Foundry HOSTED agent** that runs all tools and
HITL server-side. Balance and transaction
reads run freely, but **every money movement pauses on an Approve/Reject widget
the user must press before the transaction executes**. The same agent IS the deployed Foundry hosted agent (`build_hosted_agent`,
Responses); `azd up` publishes it.

- `list_accounts` — show accounts and balances (read).
- `get_balance` — balance of one account (read).
- `get_recent_transactions` — recent activity (read).
- `transfer_funds` — **approval-gated** (`approval_mode="always_require"`).
- `pay_bill` — **approval-gated**.

The approval widget (`confirm_changes` in `frontend/components/Chat.tsx`) shows
the pending transaction (amount, accounts/payee) and only executes after the
user clicks **Approve**. The demo uses a deterministic in-memory bank; replace
it in `src/agent.py` with your core-banking / ledger integration.

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

# Deploy the bridge + frontend as two Container Apps, wired keyless to the
# agent `make up` just deployed (needs `make up` first):
make up-app
```

> Uses **uv** for the Python venv — install it from https://docs.astral.sh/uv/.

Open http://localhost:3000 and try: *"what are my balances?"* →
*"transfer 250 from checking to savings"* → press **Approve**. Then
*"pay 80 to City Power"*.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent (in-memory bank, read tools + approval-gated transfer/pay). `build_hosted_agent()` → **FoundryChatClient** (the single brain — same code local + deployed). **Edit tools + instructions.** |
| `backend/bridge_app.py` | The AG-UI server → `HostedProxyAgent` (DIRECT local / platform deployed). **Don't edit.** |
| `backend/hosted_proxy.py` | `HostedProxyAgent`: forward turns → hosted agent, translate Responses → AG-UI, forward `mcp_approval_response`. **Don't edit.** |
| `backend/hosted_client.py` | Streaming Responses driver (per-thread conversation + session). **Don't edit.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
| `frontend/components/Chat.tsx` | CopilotKit v2 cards: `useHumanInTheLoop` (HITL) + `useRenderTool`. **Edit render cards.** |
| `hosted/` | `azd` → Foundry hosted agent (Responses). `build_hosted_agent()`. |
| `deploy/` | `azd` → the bridge + frontend as two Container Apps (`make up-app`), wired keyless to the deployed hosted agent. |
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
| `make up-app` / `make deploy-app` | `azd up` / `azd deploy` the bridge + frontend Container Apps (`deploy/`) |
| `make clean` | remove venv / node_modules / .next |

## Definition of Done

Not done until `make verify`, `make smoke`, **and** `make e2e` are green, and — for the deployed
path — a live browser E2E shows HITL approve re-executing and reject not. See
`.agents/skills/copilotkit-foundry-hitl/SKILL.md`.
