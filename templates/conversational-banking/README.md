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
make verify       # read-only structural checks — green before you touch anything

# One-time setup — everything below needs Azure (azd keeps its own credential,
# so BOTH logins are needed):
az login && azd auth login

# Provision + deploy the hosted Foundry agent. The first run prompts for an
# env name, subscription, and location, and creates hosted/.azure/:
make up

# One-time: create the LOCAL azd env (./.azure at the app root) that
# smoke/e2e/local run against — answer the prompts, Ctrl-C once it's serving:
azd ai agent run

# Prove it — the REAL agent running locally, no mock:
make smoke        # bridge → REAL agent via `azd ai agent run`; asserts the HITL flow
make e2e          # built CopilotKit UI in Chromium: read/reject/approve/follow-up

# Local dev loop:
make local        # REAL agent (azd ai agent run) + bridge :8080 + frontend :3000

# Deploy the bridge + frontend as two Container Apps, wired keyless to the
# agent `make up` deployed, then prove the deployment is real:
make up-app
make verify-deployed   # a REAL active Foundry agent answers a live invoke
```

`make doctor` checks every prerequisite (tools, logins, azd envs, ports) with the
fix for each failure — run it first when anything fails. If `make smoke` fails on
assertions with no visible error, the agent's own log is
`/tmp/forge-agent.log` — a 403 `…agents/write` there means the signed-in identity
lacks the **Azure AI User** role on the Foundry project. "Already in use" / "bridge
not ready" means stale processes: `fuser -k 8080/tcp 8088/tcp 3000/tcp`.

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
| `make doctor` | check tools, logins, azd envs, ports — with the fix for each failure |
| `make preflight` | install backend venv + frontend deps |
| `make local` | run bridge + frontend |
| `make verify` | read-only structural checks |
| `make smoke` | end-to-end HITL test against the REAL agent (`azd ai agent run`) |
| `make e2e` | real-browser HITL journey against the REAL agent |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make up-app` / `make deploy-app` | `azd up` / `azd deploy` the bridge + frontend Container Apps (`deploy/`) |
| `make verify-deployed` | deployment gate: the hosted agent is `active` in Foundry and a live invoke reaches it |
| `make clean` | remove venv / node_modules / .next |

## Definition of Done

Not done until `make verify`, `make smoke`, **and** `make e2e` are green, and — for the deployed
path — `make verify-deployed` passes and a live browser E2E shows HITL approve
re-executing and reject not. See
`.agents/skills/copilotkit-foundry-hitl/SKILL.md`.
