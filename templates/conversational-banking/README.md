# Conversational Banking (HITL)

A conversational banking assistant: a **Next.js + CopilotKit** chat UI over a
**FastAPI + AG-UI (SSE)** backend that hosts **one Microsoft Agent Framework
agent**, connected **keyless** to **Azure AI Foundry**. Balance and transaction
reads run freely, but **every money movement pauses on an Approve/Reject widget
the user must press before the transaction executes**. The same agent is also
publishable as a **Foundry hosted agent** (Responses protocol) via `azd`.

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
# Offline — no Azure, no real model (used by CI):
make smoke        # starts the backend with LLM_MODE=mock and asserts the HITL flow
make verify       # read-only structural checks

# Local dev loop (needs a Foundry project + `az login`, OR LLM_MODE=mock):
cp backend/.env.example backend/.env       # set FOUNDRY_PROJECT_ENDPOINT + model
make local                                 # backend :8080 + frontend :3000

# Deploy the hosted Foundry agent (needs az login to the Foundry tenant):
make up
```

> Uses **uv** for the Python venv — install it from https://docs.astral.sh/uv/.

Open http://localhost:3000 and try: *"what are my balances?"* →
*"transfer 250 from checking to savings"* → press **Approve**. Then
*"pay 80 to City Power"*.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent: in-memory bank, instructions, tools, `build_chat_client()` (mock / key / keyless-Foundry). **Edit this.** |
| `src/mock_client.py` | Deterministic offline client for `LLM_MODE=mock` (routes the read + transfer tools). |
| `backend/ag_ui_app.py` | FastAPI + AG-UI/SSE host + the four resilience patches. **Don't edit the patches.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
| `frontend/app/page.tsx` | `<CopilotKit useSingleEndpoint={false} agent=...>`. |
| `frontend/components/Chat.tsx` | `confirm_changes` approval widget + per-tool render cards (accounts, balances, transactions, transfer/bill results). **Edit render cards.** |
| `hosted/` | `azd` → Foundry hosted agent (Responses protocol). |
| `scripts/verify.sh`, `scripts/smoke.py` | The proof: structural + offline end-to-end. |

## Scripts (make targets)

| Target | Does |
| --- | --- |
| `make preflight` | install backend venv (uv) + frontend deps |
| `make local` | run backend + frontend |
| `make verify` | read-only structural checks |
| `make smoke` | offline end-to-end HITL test (`LLM_MODE=mock`) |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make clean` | remove venv / node_modules / .next |

## Customizing

- **Real bank:** replace `_Bank` in `src/agent.py` with your ledger / core-banking
  calls. Keep the tool shape (read tools + approval-gated money movements).
- **More transaction types** (e.g. `wire_transfer`, `open_account`): add another
  `@tool(approval_mode="always_require")` tool — the approval widget handles it.
- If you rename `list_accounts` / `transfer_funds`, update `src/mock_client.py`
  (`READ_TOOL` / `ACTION_TOOL` / `ACTION_ARG` / `STATE_FIELD`) and `scripts/smoke.py`
  (`READ_PROMPT` / `ACTION_PROMPT` / `STATE_FIELD` / `READ_TOOL`) so `make smoke`
  still exercises the gate.

## Definition of Done

Not done until `make verify` **and** `make smoke` are green. See
`.agents/skills/forgewright/SKILL.md`.
