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

If you rename the demo tools in `agent.py`, update READ_TOOL / ACTION_TOOL and
the keyword lists below to match.
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
READ_TOOL = "get_value"
ACTION_TOOL = "apply_delta"
ACTION_ARG = "delta"

_READ_WORDS = ("value", "current", "status", "state", "what", "show", "read", "how much")
_ACTION_WORDS = ("apply", "delta", "change", "increase", "decrease", "add", "subtract", "set", "update", "adjust")


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
    last_result_value = None
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
                    if isinstance(parsed, dict) and "value" in parsed:
                        last_result_value = parsed["value"]
                except Exception:
                    pass

    text = last_user_text.lower()
    is_action = any(w in text for w in _ACTION_WORDS)
    is_read = any(w in text for w in _READ_WORDS)

    if is_action:
        if not action_attempted:
            m = re.search(r"-?\d+(?:\.\d+)?", last_user_text)
            delta = float(m.group(0)) if m else 10.0
            return Content.from_function_call(
                call_id=f"mock-{uuid.uuid4().hex[:8]}",
                name=ACTION_TOOL,
                arguments={ACTION_ARG: delta},
            )
        if last_result_value is not None:
            return Content.from_text(f"Done — the change was applied. The value is now {last_result_value}.")
        return Content.from_text("The change was not applied (it was rejected or skipped).")

    if is_read:
        if not read_attempted:
            return Content.from_function_call(
                call_id=f"mock-{uuid.uuid4().hex[:8]}", name=READ_TOOL, arguments={}
            )
        if last_result_value is not None:
            return Content.from_text(f"The current value is {last_result_value}.")

    return Content.from_text("Hello! Ask me for the current value, or to apply a change.")


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
