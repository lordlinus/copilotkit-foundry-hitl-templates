"""The ONE Microsoft Agent Framework agent — the single source of truth.

`build_hosted_agent()` builds the agent (tools + instructions) on a
**FoundryChatClient** (Responses). It is the brain everywhere — the SAME code runs:
  * **local dev:** `azd ai agent run` runs it on your machine (hot reload),
    connected to your Foundry project's model;
  * **deployed:** `azd up` publishes it as a Foundry HOSTED agent.

Either way `ResponsesHostServer` (`app.py` / `hosted/responses/main.py`) serves the
Responses protocol, and the bridge (`backend/bridge_app.py` → `HostedProxyAgent`)
forwards each AG-UI turn to it and forwards `mcp_approval_response` on HITL approve,
so the gated tool re-executes server-side. There is **no mock** — `make local` and
`make smoke` drive the real agent via `azd ai agent run`.

This is a **domain-agnostic starter**. Replace the demo store + two tools with
your own. Keep the shape:

  * one or more *read* tools (no side effects),
  * one or more *consequential* tools decorated `@tool(approval_mode="always_require")`
    so the runtime pauses for human approval before the body runs.

Connection to Azure AI Foundry is **keyless** (DefaultAzureCredential).
"""

from __future__ import annotations

import json
import logging
import os

from agent_framework import tool

logger = logging.getLogger("app.agent")

# MUST match <CopilotKit agent="..."> in the frontend and the hosted name.
AGENT_NAME = "conversational_banking"


# ── Demo state (replace with your core-banking / ledger system) ───────────────
class _Bank:
    """Tiny in-memory bank so the starter runs with zero external deps."""

    def __init__(self) -> None:
        self.accounts = {"checking": 4200.00, "savings": 15750.50}
        self.transactions: list[dict] = []
        self.transfers_count = 0

    # ── reads ────────────────────────────────────────────────────────────────
    def overview(self) -> dict:
        return {
            "accounts": [
                {"name": n, "balance": round(b, 2)} for n, b in self.accounts.items()
            ],
            "transfers_count": self.transfers_count,
        }

    def balance(self, account: str) -> dict:
        if account not in self.accounts:
            return {"error": f"unknown account '{account}'", "accounts": list(self.accounts)}
        return {"account": account, "balance": round(self.accounts[account], 2)}

    def recent(self, limit: int = 5) -> dict:
        return {"transactions": self.transactions[-limit:], "count": len(self.transactions)}

    # ── consequential ─────────────────────────────────────────────────────────
    def transfer(self, amount: float, to_account: str, from_account: str) -> dict:
        amount = round(float(amount), 2)
        if from_account not in self.accounts or to_account not in self.accounts:
            return {"status": "error", "reason": "unknown account", "accounts": list(self.accounts)}
        if amount <= 0:
            return {"status": "error", "reason": "amount must be positive"}
        if self.accounts[from_account] < amount:
            return {"status": "error", "reason": "insufficient funds",
                    "available": round(self.accounts[from_account], 2)}
        self.accounts[from_account] -= amount
        self.accounts[to_account] += amount
        self.transfers_count += 1
        ref = f"TXN-{self.transfers_count:06d}"
        self.transactions.append(
            {"ref": ref, "type": "transfer", "amount": amount,
             "from": from_account, "to": to_account}
        )
        return {
            "status": "ok",
            "reference": ref,
            "type": "transfer",
            "amount": amount,
            "from_account": from_account,
            "to_account": to_account,
            "transfers_count": self.transfers_count,
            "balances": {n: round(b, 2) for n, b in self.accounts.items()},
        }

    def bill(self, payee: str, amount: float, from_account: str) -> dict:
        amount = round(float(amount), 2)
        if from_account not in self.accounts:
            return {"status": "error", "reason": "unknown account", "accounts": list(self.accounts)}
        if amount <= 0:
            return {"status": "error", "reason": "amount must be positive"}
        if self.accounts[from_account] < amount:
            return {"status": "error", "reason": "insufficient funds",
                    "available": round(self.accounts[from_account], 2)}
        self.accounts[from_account] -= amount
        self.transfers_count += 1
        ref = f"TXN-{self.transfers_count:06d}"
        self.transactions.append(
            {"ref": ref, "type": "bill_pay", "amount": amount,
             "from": from_account, "payee": payee}
        )
        return {
            "status": "ok",
            "reference": ref,
            "type": "bill_pay",
            "amount": amount,
            "payee": payee,
            "from_account": from_account,
            "transfers_count": self.transfers_count,
            "balances": {n: round(b, 2) for n, b in self.accounts.items()},
        }


BANK = _Bank()


_INSTRUCTIONS = """\
You are a concise, careful conversational banking assistant for a single \
customer with a `checking` and a `savings` account.

Reading is free:
- Use `list_accounts` to show accounts and balances.
- Use `get_balance(account)` for one account.
- Use `get_recent_transactions` for recent activity.
Always read live values with these tools — never invent balances.

Moving money requires approval:
- Use `transfer_funds(amount, to_account, from_account)` to move money between \
the customer's accounts.
- Use `pay_bill(payee, amount, from_account)` to pay a bill.
Both are gated by human approval: the system shows the customer an \
Approve/Reject widget with the transaction details and only executes if they \
approve. Do NOT ask "are you sure?" in text first — just call the tool and let \
the approval widget do its job.

After a transaction executes, state the reference and the new balance plainly \
(quote the tool result). If the user only chats, answer briefly without calling \
tools.
"""


# ── Read tools (no side effects) ──────────────────────────────────────────────
@tool
async def list_accounts() -> str:
    """List the customer's accounts and balances."""
    return json.dumps(BANK.overview(), ensure_ascii=False)


@tool
async def get_balance(account: str) -> str:
    """Return the balance of one account ('checking' or 'savings')."""
    return json.dumps(BANK.balance(account), ensure_ascii=False)


@tool
async def get_recent_transactions() -> str:
    """Return the most recent transactions on the customer's accounts."""
    return json.dumps(BANK.recent(), ensure_ascii=False)


# ── Consequential tools — body runs ONLY after the user approves ─────────────
@tool(approval_mode="always_require")
async def transfer_funds(amount: float, to_account: str = "savings", from_account: str = "checking") -> str:
    """Move money between the customer's accounts. Requires human approval."""
    return json.dumps(BANK.transfer(amount, to_account, from_account), ensure_ascii=False)


@tool(approval_mode="always_require")
async def pay_bill(payee: str, amount: float, from_account: str = "checking") -> str:
    """Pay a bill to a payee from an account. Requires human approval."""
    return json.dumps(BANK.bill(payee, amount, from_account), ensure_ascii=False)


AGENT_TOOLS = [
    list_accounts,
    get_balance,
    get_recent_transactions,
    transfer_funds,
    pay_bill,
]


# ── Shared/predictive state config (override per template; see patterns-7.md) ──
# When a tool writes a state key, map it here so the AG-UI adapter natively emits
# StateSnapshot/StateDelta to CopilotKit's useAgent. Empty = no shared state demo.
AGENT_STATE_SCHEMA: dict | None = None
AGENT_PREDICT_STATE: dict | None = None


def build_hosted_agent():
    """The agent — the single brain. Served by `ResponsesHostServer`
    (`app.py` / `hosted/responses/main.py`): deployed via `azd up`, and run locally
    for development via `azd ai agent run` (the same code, connected to the env's
    Foundry resources). Uses **`FoundryChatClient` (Responses)** — REQUIRED for HITL:
    the runtime emits an `mcp_approval_request` and the bridge resumes with an
    `mcp_approval_response`, which re-executes the gated tool server-side (verified
    live: approve → tool runs, state changes). `store=False` — hosting manages history.
    """
    from agent_framework import Agent
    from agent_framework.foundry import FoundryChatClient
    from azure.identity import DefaultAzureCredential

    project = os.environ["FOUNDRY_PROJECT_ENDPOINT"].rstrip("/")
    model = os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"]
    logger.info("[agent] keyless Foundry FoundryChatClient (Responses) | model=%s", model)
    client = FoundryChatClient(project_endpoint=project, model=model,
                               credential=DefaultAzureCredential())

    agent = Agent(client=client, name=AGENT_NAME, instructions=_INSTRUCTIONS,
                  tools=AGENT_TOOLS, default_options={"store": False})
    logger.info("[agent] built hosted %s (Responses) | tools=%d", AGENT_NAME, len(AGENT_TOOLS))
    return agent
