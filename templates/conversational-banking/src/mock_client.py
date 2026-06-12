"""Deterministic offline chat client for `LLM_MODE=mock`.

Lets the whole stack — AG-UI/SSE, the function-invocation loop, and native HITL
approval — run with **no Azure resources and no real model**, so `make smoke`
and CI can prove behavior. It is intentionally dumb: it routes on keywords in
the latest user message and emits the right tool call or a final text answer.

Contract the runtime needs from any chat client:
  * emit assistant content of `type == "function_call"` to trigger a tool, OR
  * emit assistant text to finish the turn.
The framework handles executing tools, looping, and (for tools decorated
`approval_mode="always_require"`) pausing for human approval — none of that is
the client's job.

This mock exercises the read tool (`list_accounts`) and the approval-gated
action (`transfer_funds`) the offline smoke needs. The other tools (`get_balance`,
`get_recent_transactions`, `pay_bill`) are driven by a real model online. If you
rename tools in `agent.py`, update READ_TOOL / ACTION_TOOL / ACTION_ARG and the
keyword lists below to match.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Sequence
from typing import Any

from agent_framework import (
    BaseChatClient,
    ChatResponse,
    ChatResponseUpdate,
    Content,
    FunctionInvocationLayer,
    Message,
)

# Keep in sync with agent.py's tool names.
READ_TOOL = "list_accounts"
ACTION_TOOL = "transfer_funds"
ACTION_ARG = "amount"
STATE_FIELD = "transfers_count"

_READ_WORDS = ("balance", "balances", "account", "accounts", "show", "summary", "overview", "how much", "status", "what", "recent", "transactions")
_ACTION_WORDS = ("transfer", "move", "send", "wire", "pay", "withdraw")


def _role(m: Any) -> str:
    r = getattr(m, "role", "")
    return getattr(r, "value", r) or ""


def _text_of(m: Any) -> str:
    parts = []
    for c in getattr(m, "contents", None) or []:
        if getattr(c, "type", None) == "text" and getattr(c, "text", None):
            parts.append(c.text)
    return " ".join(parts)


def _decide(messages: Sequence[Any]) -> Content:
    """Return the single assistant Content to emit for this step."""
    last_user_idx = -1
    last_user_text = ""
    for i, m in enumerate(messages):
        if _role(m) == "user":
            last_user_idx = i
            last_user_text = _text_of(m)

    # What has already happened *this turn* (after the last user message)?
    action_attempted = read_attempted = False
    last_state_value = None
    for m in messages[last_user_idx + 1 :]:
        for c in getattr(m, "contents", None) or []:
            ctype = getattr(c, "type", None)
            if ctype == "function_call":
                if getattr(c, "name", None) == ACTION_TOOL:
                    action_attempted = True
                elif getattr(c, "name", None) == READ_TOOL:
                    read_attempted = True
            elif ctype == "function_result":
                try:
                    parsed = json.loads(getattr(c, "result", "") or "{}")
                    if isinstance(parsed, dict) and STATE_FIELD in parsed:
                        last_state_value = parsed[STATE_FIELD]
                except Exception:
                    pass

    text = last_user_text.lower()
    is_action = any(w in text for w in _ACTION_WORDS)
    is_read = any(w in text for w in _READ_WORDS)

    if is_action:
        if not action_attempted:
            m = re.search(r"-?\d+(?:\.\d+)?", last_user_text)
            amount = float(m.group(0)) if m else 100.0
            return Content.from_function_call(
                call_id=f"mock-{uuid.uuid4().hex[:8]}",
                name=ACTION_TOOL,
                arguments={ACTION_ARG: amount},
            )
        if last_state_value is not None:
            return Content.from_text(f"Done — the transfer cleared approval. Transfers so far: {last_state_value}.")
        return Content.from_text("The transfer was not made (it was rejected or skipped).")

    if is_read:
        if not read_attempted:
            return Content.from_function_call(
                call_id=f"mock-{uuid.uuid4().hex[:8]}", name=READ_TOOL, arguments={}
            )
        return Content.from_text("Here are your accounts and balances.")

    return Content.from_text(
        "Hi! Ask me for your balances, recent transactions, or to transfer money "
        "or pay a bill — money movements pause for your approval first."
    )


class MockChatClient(FunctionInvocationLayer, BaseChatClient):
    """Offline, deterministic. Inherits FunctionInvocationLayer so the Agent runs
    the tool-calling + approval loop (the Agent skips it for plain BaseChatClient
    subclasses). ``_inner_get_response`` mirrors the real clients' contract:
    returns a ``ResponseStream`` when streaming, a coroutine when not.
    """

    OTEL_PROVIDER_NAME = "mock"

    def _inner_get_response(self, *, messages, stream, options, **kwargs):  # type: ignore[override]
        content = _decide(messages)

        if stream:

            async def _gen():
                yield ChatResponseUpdate(role="assistant", contents=[content])

            return self._build_response_stream(_gen())

        async def _resp():
            return ChatResponse(
                messages=[Message(role="assistant", contents=[content])],
                response_id=f"mock-{uuid.uuid4().hex[:8]}",
            )

        return _resp()
