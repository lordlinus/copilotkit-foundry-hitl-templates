"""The ONE Microsoft Agent Framework agent — imported by both front doors.

`backend/ag_ui_app.py` (local AG-UI/SSE behind CopilotKit) and
`hosted/responses/main.py` (Foundry hosted Responses agent) both import
`build_agent()` from here, so your business logic lives in exactly one place.

This template is a **conversational banking** assistant. Read tools run freely;
every money movement is decorated `@tool(approval_mode="always_require")`, so the
runtime PAUSES and the UI shows an Approve/Reject **widget the user must press
before the transaction executes**:

  * read tools (no side effects): `list_accounts`, `get_balance`,
    `get_recent_transactions`,
  * consequential tools (gated by approval): `transfer_funds`, `pay_bill`.

Keep the shape: one or more read tools plus one or more approval-gated tools.
Replace the demo in-memory bank with your core-banking / ledger integration.

Connection to Azure AI Foundry is **keyless** by default (DefaultAzureCredential):
we build an ``OpenAIChatCompletionClient`` against ``{FOUNDRY_PROJECT_ENDPOINT}/openai/v1``
with the ``https://ai.azure.com/.default`` audience. We use **Chat Completions, NOT
the Responses API**, because HITL approve-resume returns HTTP 400
("No tool output found for function call") on the Responses path. ``LLM_MODE=mock``
swaps in a deterministic offline client so the whole stack (SSE + HITL) runs with
no Azure resources — used by `make smoke` and CI.
"""

from __future__ import annotations

import json
import logging
import os

from agent_framework import tool

logger = logging.getLogger("forgewright.agent")

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


def build_chat_client():
    """Build the chat client. Three modes, in priority order:

    1. ``LLM_MODE=mock`` — deterministic offline client (no Azure). For tests/CI.
    2. ``LLM_API_KEY`` set — OpenAI-compatible gateway via key (e.g. APIM).
    3. default — **keyless Foundry** via DefaultAzureCredential.

    Modes 2 and 3 both use ``OpenAIChatCompletionClient`` (Chat Completions),
    never the Responses API, so HITL approve-resume does not 400.
    """
    mode = os.environ.get("LLM_MODE", "").strip().lower()
    if mode == "mock":
        logger.info("[agent] LLM_MODE=mock — deterministic offline client")
        from mock_client import MockChatClient

        return MockChatClient()

    from agent_framework_openai import OpenAIChatCompletionClient

    key = os.environ.get("LLM_API_KEY")
    if key:
        base_url = os.environ["LLM_BASE_URL"]
        header = os.environ.get("LLM_AUTH_HEADER", "Ocp-Apim-Subscription-Key")
        model = os.environ.get("AZURE_AI_MODEL_DEPLOYMENT_NAME") or os.environ.get("MODEL", "gpt-4.1")
        logger.info("[agent] key-based OpenAIChatCompletionClient | model=%s", model)
        return OpenAIChatCompletionClient(
            model=model, api_key=key, base_url=base_url, default_headers={header: key}
        )

    from azure.identity import DefaultAzureCredential, get_bearer_token_provider

    project = os.environ["FOUNDRY_PROJECT_ENDPOINT"].rstrip("/")
    model = os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"]
    logger.info("[agent] keyless Foundry OpenAIChatCompletionClient | model=%s", model)
    return OpenAIChatCompletionClient(
        model=model,
        base_url=f"{project}/openai/v1",
        credential=get_bearer_token_provider(
            DefaultAzureCredential(), "https://ai.azure.com/.default"
        ),
    )


def build_agent():
    agent = build_chat_client().as_agent(
        name=AGENT_NAME, instructions=_INSTRUCTIONS, tools=AGENT_TOOLS
    )
    logger.info("[agent] built %s | tools=%d", AGENT_NAME, len(AGENT_TOOLS))
    return agent
