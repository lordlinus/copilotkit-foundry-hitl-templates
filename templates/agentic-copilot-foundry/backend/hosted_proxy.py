"""HostedProxyAgent — a thin SupportsAgentRun that makes the Container App a pure
AG-UI↔Responses BRIDGE. It runs NO LLM and NO tools: it forwards each turn to the
deployed Foundry HOSTED agent (which does ALL orchestration + tool execution +
HITL server-side) and translates the hosted agent's Responses output into Agent
Framework Content so agent-framework-ag-ui emits the AG-UI events CopilotKit
expects (text, tool-call cards, and the confirm_changes approval card).

HITL: the hosted agent emits an ``mcp_approval_request`` for approval-gated tools;
we surface it as a ``confirm_changes`` tool call (the frontend's
``useHumanInTheLoop`` renders Approve/Reject). On the next turn the decision comes
back and is routed to the hosted agent as an ``mcp_approval_response``
(``bridge_app`` neutralises ag-ui's local approval interception inline so it
reaches us — proven load-bearing: disabling it means approve never re-executes).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from agent_framework import AgentResponse, AgentResponseUpdate, AgentSession, Content, Message

import hosted_client

logger = logging.getLogger("hosted_proxy")

# AG-UI agent name the CopilotKit frontend talks to (<CopilotKit agent="...">),
# distinct from the deployed hosted agent name used for the Responses calls.
_AGUI_AGENT_NAME = __import__("os").getenv("AGENT_NAME", "forgewright_app")


def _latest_user_text(messages: Any) -> str:
    if isinstance(messages, str):
        return messages
    seq = messages if isinstance(messages, list) else ([messages] if messages else [])
    for m in reversed(seq):
        if str(getattr(m, "role", "")) in ("user", "Role.USER"):
            for c in getattr(m, "contents", None) or []:
                if getattr(c, "type", None) == "text" and getattr(c, "text", None):
                    return c.text
    return ""


def _find_approval_decision(messages: Any) -> tuple[str, bool] | None:
    """Detect a confirm_changes / approval result the user JUST answered.

    Returns (call_id, approved) or None. Scans newest→oldest and stops at the first
    DECISIVE message: an approval result → it's an approval turn; a user text →
    it's a normal turn (any earlier approval in the history is already resolved, so
    we must NOT re-fire it — that sent an mcp_approval_response with an empty/stale
    id, "Approval request with ID '' does not exist").
    """
    seq = messages if isinstance(messages, list) else ([messages] if messages else [])
    for m in reversed(seq):
        role = str(getattr(m, "role", ""))
        for c in getattr(m, "contents", None) or []:
            ctype = getattr(c, "type", None)
            if ctype == "function_approval_response":
                fc = getattr(c, "function_call", None)
                cid = getattr(fc, "call_id", None) or getattr(c, "id", None)
                return (str(cid or ""), bool(getattr(c, "approved", True)))
            if ctype == "function_result":
                payload = _arguments_to_dict(getattr(c, "result", None))
                if "accepted" in payload:
                    return (str(getattr(c, "call_id", "") or ""), bool(payload.get("accepted")))
            if ctype == "text" and getattr(c, "text", None):
                payload = _arguments_to_dict(c.text)
                if "accepted" in payload and "steps" in payload:
                    ap = getattr(c, "additional_properties", None) or {}
                    return (str(ap.get("tool_call_id") or ap.get("call_id") or ""),
                            bool(payload.get("accepted")))
        # A newer user message means any earlier approval is already resolved.
        if role in ("user", "Role.USER"):
            for c in getattr(m, "contents", None) or []:
                if getattr(c, "type", None) == "text" and getattr(c, "text", None):
                    return None
    return None


def _arguments_to_dict(arguments: Any) -> dict:
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str) and arguments.strip():
        try:
            return json.loads(arguments)
        except Exception:
            return {}
    return {}


class HostedProxyAgent:
    """Forward AG-UI turns to the deployed hosted agent; translate output back."""

    def __init__(self) -> None:
        self.id: str = _AGUI_AGENT_NAME
        self.name: str | None = _AGUI_AGENT_NAME
        self.description: str | None = "Bridge to the Foundry hosted agent."
        # case_id -> mcp_approval_request id pending the user's decision
        self._pending_mcpr: dict[str, str] = {}
        # The gated function_call is suppressed while approval is pending. Keep it
        # so an approved result-only resume can replay the call before its result,
        # allowing CopilotKit useRenderTool to render the completed action card.
        self._pending_calls: dict[str, dict] = {}
        self._approved_calls: dict[str, dict] = {}
        # mcp_approval_request ids we've already answered (approve/reject/supersede).
        # Guards against re-sending a stale approval ("Approval request with ID ...
        # does not exist") when the frontend's lingering sign-off card is clicked
        # after the approval was already superseded by a free-text turn.
        self._resolved_mcpr: set[str] = set()

    def create_session(self, *, session_id: str | None = None) -> AgentSession:
        return AgentSession(session_id=session_id)

    def get_session(self, service_session_id: str, *, session_id: str | None = None) -> AgentSession:
        return AgentSession(session_id=session_id, service_session_id=service_session_id)

    @staticmethod
    def _case(session: AgentSession | None) -> str:
        if session is not None:
            return session.session_id or session.service_session_id or "default"
        return "default"

    def run(self, messages: Any = None, *, stream: bool = False,
            session: AgentSession | None = None, **_: Any):
        case = self._case(session)
        if stream:
            return self._run_stream(case, messages)
        return self._run_once(case, messages)

    def _stream_input(self, case: str, messages: Any):
        """Resolve the hosted-agent input for this turn. The per-case `conversation`
        (in hosted_client) maintains chat history + HITL state server-side, so no
        previous_response_id chaining is needed."""
        decision = _find_approval_decision(messages)
        if decision is not None:
            call_id, approved = decision
            mcpr = self._pending_mcpr.pop(case, None) or call_id
            pending_call = self._pending_calls.pop(case, None)
            if mcpr and mcpr not in self._resolved_mcpr:  # never send empty/stale id
                self._resolved_mcpr.add(mcpr)
                if approved and pending_call is not None:
                    self._approved_calls[case] = pending_call
                logger.info("[proxy] case=%s approval=%s mcpr=%s", case, approved, mcpr[:14])
                return [{"type": "mcp_approval_response", "approval_request_id": mcpr, "approve": approved}]
            # mcpr empty, or already answered (e.g. the user clicked the lingering
            # sign-off card AFTER a free-text turn already superseded it) → don't
            # re-fire it; fall through and treat this as a normal turn.
            logger.info("[proxy] case=%s approval for resolved/empty mcpr=%s — normal turn",
                        case, (mcpr or "")[:14])
        text = _latest_user_text(messages)
        pending = self._pending_mcpr.pop(case, None)
        if pending and pending not in self._resolved_mcpr:
            self._pending_calls.pop(case, None)
            # An approval is still pending server-side but the user sent a normal
            # message instead of approving. The conversation is BLOCKED awaiting an
            # mcp_approval_response — sending plain text 400s ("invalid_payload").
            # Decline the superseded approval (the gated tool never runs) and deliver
            # the user's message in the SAME input list so the question is answered.
            self._resolved_mcpr.add(pending)
            logger.info("[proxy] case=%s pending approval %s superseded by user msg — decline+forward",
                        case, pending[:14])
            unblock = [{"type": "mcp_approval_response", "approval_request_id": pending, "approve": False}]
            if text:
                unblock.append({"type": "message", "role": "user", "content": text})
            return unblock
        logger.info("[proxy] case=%s user=%r", case, text[:80])
        return text

    async def _events(self, case: str, messages: Any):
        """Stream the hosted agent and translate each event → (Content, new_msg).

        A function_call that is immediately gated by an mcp_approval_request is
        SUPPRESSED — we surface only the `confirm_changes` approval (the gated tool
        didn't execute; showing it as a second tool call in the same turn makes
        CopilotKit render only the first and the approval card never opens). So we
        buffer each function_call and drop it if the next event is its approval.
        """
        agui_input = self._stream_input(case, messages)
        approved_call = self._approved_calls.pop(case, None)
        approved_original_id = approved_call.get("call_id") if approved_call else None
        approved_ui_call_id: str | None = None
        approved_result_seen = False
        approval_error: str | None = None
        last_call_id = ""
        pending_fc: dict | None = None  # a function_call awaiting its next event

        def _fc_content(fc):
            return Content.from_function_call(call_id=fc["call_id"], name=fc.get("name", ""),
                                              arguments=fc.get("arguments", ""))

        if approved_call is not None:
            approved_call = dict(approved_call)
            approved_ui_call_id = f"{approved_call['call_id']}-approved-{uuid4().hex[:8]}"
            approved_call["call_id"] = approved_ui_call_id
            yield (_fc_content(approved_call), True)

        async for ev in hosted_client.client().converse_stream(case, agui_input):
            kind = ev.get("kind")
            # An approval right after a function_call → drop the call, show only the card.
            if kind == "approval" and pending_fc is not None:
                self._pending_calls[case] = pending_fc
                pending_fc = None
            elif pending_fc is not None:
                # the buffered call was NOT gated → flush it as a real tool call
                last_call_id = pending_fc["call_id"]
                yield (_fc_content(pending_fc), True)
                pending_fc = None

            if kind == "function_call":
                if approved_original_id and ev.get("call_id") == approved_original_id:
                    continue
                pending_fc = {"call_id": ev.get("call_id") or uuid4().hex,
                              "name": ev.get("name", ""), "arguments": ev.get("arguments", "")}
            elif kind == "result":
                cid = approved_ui_call_id or ev.get("call_id") or last_call_id or uuid4().hex
                if approved_ui_call_id:
                    approved_result_seen = True
                yield (Content.from_function_result(call_id=cid, result=ev.get("output")), False)
            elif kind == "approval":
                mcpr = ev.get("id") or uuid4().hex
                self._pending_mcpr[case] = mcpr
                yield (Content.from_function_call(
                    call_id=mcpr, name="confirm_changes",
                    arguments={"steps": [{"description": f"Execute {ev.get('name','')}", "status": "enabled"}],
                               "function_name": ev.get("name", ""),
                               "function_arguments": _arguments_to_dict(ev.get("arguments"))}), True)
            elif kind == "text":
                yield (Content.from_text(ev.get("delta", "")), False)
            elif kind == "error":
                if approved_ui_call_id:
                    approval_error = str(ev.get("detail") or "Hosted tool execution failed")
                yield (Content.from_text(f"\n\n_(hosted agent error: {ev.get('detail')})_"), True)

        if approved_ui_call_id and not approved_result_seen:
            result = (
                {"status": "error", "reason": approval_error}
                if approval_error
                else {"status": "ok", "executed": True}
            )
            yield (Content.from_function_result(
                call_id=approved_ui_call_id,
                result=json.dumps(result, ensure_ascii=False),
            ), False)

        if pending_fc is not None:  # trailing function_call with no following event
            yield (_fc_content(pending_fc), True)

    async def _run_once(self, case: str, messages: Any) -> AgentResponse:
        contents = [c async for c, _ in self._events(case, messages)]
        return AgentResponse(messages=[Message(role="assistant", contents=contents)])

    async def _run_stream(self, case: str, messages: Any):
        # Relay hosted-agent events to AG-UI as they arrive (real-time SSE, no
        # silent wait). C9: each tool call starts a fresh assistant message_id;
        # text deltas accumulate under one message_id between tool calls.
        text_mid = uuid4().hex
        async for content, new_msg in self._events(case, messages):
            ctype = getattr(content, "type", None)
            if ctype == "function_call":
                yield AgentResponseUpdate(contents=[content], role="assistant", message_id=uuid4().hex)
                text_mid = uuid4().hex
            elif ctype == "function_result":
                yield AgentResponseUpdate(contents=[content], role="assistant", message_id=uuid4().hex)
            else:
                if new_msg:
                    text_mid = uuid4().hex
                yield AgentResponseUpdate(contents=[content], role="assistant", message_id=text_mid)
