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

This mock exercises the two tools the offline smoke needs: the read tool
(`get_claim`) and the approval-gated action (`submit_claim`). The richer tools
(`list_documents`, `extract_claim_form`, `update_claim_field`) are driven by a
real model online. If you rename tools in `agent.py`, update READ_TOOL /
ACTION_TOOL and the keyword lists below to match.
"""

from __future__ import annotations

import json
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
READ_TOOL = "get_claim"
ACTION_TOOL = "submit_claim"
STATE_FIELD = "submitted_count"

_READ_WORDS = ("claim", "form", "fields", "summary", "status", "state", "show", "current", "what", "review", "read")
_ACTION_WORDS = ("submit", "send", "finalize", "finalise", "file the", "lodge")


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
            return Content.from_function_call(
                call_id=f"mock-{uuid.uuid4().hex[:8]}",
                name=ACTION_TOOL,
                arguments={},
            )
        return Content.from_text("The claim was submitted (it cleared the approval gate).")

    if is_read:
        if not read_attempted:
            return Content.from_function_call(
                call_id=f"mock-{uuid.uuid4().hex[:8]}", name=READ_TOOL, arguments={}
            )
        if last_state_value is not None:
            return Content.from_text(f"This claim has been submitted {last_state_value} time(s).")

    return Content.from_text(
        "Hi! Ask me to extract the claim form from the documents, edit a field, "
        "or submit the claim."
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
