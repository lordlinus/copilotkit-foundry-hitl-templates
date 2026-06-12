"""AG-UI host — serves the agent for a CopilotKit frontend over FastAPI + SSE.

`add_agent_framework_fastapi_endpoint` mounts the Microsoft Agent Framework agent
at `/` so the CopilotKit runtime (the Next.js API route) can stream tokens, render
tool calls as generative cards, and drive native human-in-the-loop approval.

Run locally:
    uvicorn ag_ui_app:app --host 0.0.0.0 --port 8080

This module installs **four** proven AG-UI resilience patches BEFORE mounting the
endpoint. They are mandatory whenever any tool uses
`approval_mode="always_require"` — without them, HITL turns lose generative cards,
re-render approve/reject buttons forever, or crash on replay with HTTP 400
("No tool output found for function call"). See references/agui-resilience-patches.md.
"""

from __future__ import annotations

import json as _json
import logging
import os
import sys
from contextvars import ContextVar

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv

load_dotenv(override=False)

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import APIKeyHeader

from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint

from agent import AGENT_NAME, AGENT_TOOLS, build_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("forgewright.ag_ui")

_agent = build_agent()


# ── Patch 1: drop client tools that collide with server tool names ────────────
import agent_framework_ag_ui._agent_run as _agent_run  # noqa: E402

_SERVER_TOOL_NAMES = {getattr(t, "name", None) for t in AGENT_TOOLS if getattr(t, "name", None)}
_orig_convert_agui_tools = _agent_run.convert_agui_tools_to_agent_framework


def _convert_agui_tools_without_collisions(agui_tools):
    converted = _orig_convert_agui_tools(agui_tools)
    if not converted:
        return converted
    kept = [t for t in converted if getattr(t, "name", None) not in _SERVER_TOOL_NAMES]
    dropped = [getattr(t, "name", "?") for t in converted
               if getattr(t, "name", None) in _SERVER_TOOL_NAMES]
    if dropped:
        logger.warning("[ag-ui] Stripped colliding client tool(s): %s", dropped)
    return kept or None


_agent_run.convert_agui_tools_to_agent_framework = _convert_agui_tools_without_collisions


# ── Patch 2: keep every generative card after the run finishes ────────────────
# CopilotKit react-core renders only message.toolCalls[0] per assistant message,
# so any assistant message carrying >1 tool call silently drops the rest. Split
# such messages into one-per-tool-call, interleaved with the matching tool result.
_orig_build_snapshot = _agent_run._build_messages_snapshot


def _split_multi_tool_assistant_messages(flow, snapshot_messages):
    event = _orig_build_snapshot(flow, snapshot_messages)
    msgs = list(getattr(event, "messages", None) or [])
    tool_by_id = {getattr(m, "tool_call_id", None): m for m in msgs
                  if getattr(m, "role", None) == "tool"}
    consumed: set[int] = set()
    out = []
    for m in msgs:
        role = getattr(m, "role", None)
        tcs = getattr(m, "tool_calls", None)
        if role == "assistant" and tcs and len(tcs) > 1:
            for i, tc in enumerate(tcs):
                new_id = m.id if i == 0 else f"{m.id}-tc{i}"
                out.append(m.model_copy(update={"tool_calls": [tc], "id": new_id, "content": ""}))
                tmsg = tool_by_id.get(getattr(tc, "id", None))
                if tmsg is not None and id(tmsg) not in consumed:
                    out.append(tmsg)
                    consumed.add(id(tmsg))
        elif role == "tool" and id(m) in consumed:
            continue
        else:
            out.append(m)
    event.messages = out
    return event


_agent_run._build_messages_snapshot = _split_multi_tool_assistant_messages


# ── Patch 2b: emit confirm_changes under a NEW parent_message_id ──────────────
# During the live stream both the gated tool call and confirm_changes share
# flow.message_id, so CopilotKit again renders only the first. Rewrite the
# confirm_changes TOOL_CALL_START to a fresh parent_message_id so the approval
# card appears immediately. Do NOT overwrite flow.message_id (that breaks the
# end-of-run TEXT_MESSAGE_END with INCOMPLETE_STREAM).
from ag_ui.core import ToolCallStartEvent as _ToolCallStartEvent  # noqa: E402
import agent_framework_ag_ui._run_common as _run_common  # noqa: E402

_orig_emit_approval = _run_common._emit_approval_request


def _emit_approval_request_separate_message(content, flow, predictive_handler=None,
                                            require_confirmation=True):
    events = _orig_emit_approval(content, flow, predictive_handler, require_confirmation)
    if not require_confirmation:
        return events
    new_message_id = _run_common.generate_event_id()
    for ev in events:
        if isinstance(ev, _ToolCallStartEvent) and getattr(ev, "tool_call_name", "") == "confirm_changes":
            ev.parent_message_id = new_message_id
            break
    return events


_run_common._emit_approval_request = _emit_approval_request_separate_message
if hasattr(_agent_run, "_emit_approval_request"):
    _agent_run._emit_approval_request = _emit_approval_request_separate_message


# ── Patch 2c: persist HITL tool result + scrub stale approval payloads ────────
# After approve, the runtime executes the gated tool and emits a TOOL_CALL_RESULT
# event but never appends it to flow.tool_results, so the post-run snapshot keeps
# only the raw {accepted: true} approval payload. On the next run CopilotKit
# re-sends that payload, the registry rejects it, the assistant call is orphaned
# → OpenAI 400 "tool_call_ids did not have response messages". Fix: (a) journal
# the executed result into flow.tool_results; (b) replace any leftover approval
# payload with a plain "Confirmed"/"Rejected" string.
from agent_framework_ag_ui._utils import normalize_agui_role as _normalize_agui_role  # noqa: E402

_approval_results_var: ContextVar[list[dict] | None] = ContextVar("approval_results", default=None)


def _ensure_approval_queue() -> list[dict]:
    q = _approval_results_var.get()
    if q is None:
        q = []
        _approval_results_var.set(q)
    return q


_orig_make_approval_events = _agent_run._make_approval_tool_result_events


def _make_approval_events_and_journal(resolved_approval_results):
    events = _orig_make_approval_events(resolved_approval_results)
    queue = _ensure_approval_queue()
    for ev in events:
        call_id = getattr(ev, "tool_call_id", None)
        if not call_id:
            continue
        queue.append({
            "id": getattr(ev, "message_id", _run_common.generate_event_id()),
            "role": "tool",
            "toolCallId": call_id,
            "content": getattr(ev, "content", ""),
        })
    return events


_agent_run._make_approval_tool_result_events = _make_approval_events_and_journal


_orig_clean_resolved = _agent_run._clean_resolved_approvals_from_snapshot


def _clean_resolved_approvals_aggressively(snapshot_messages, resolved_messages):
    _orig_clean_resolved(snapshot_messages, resolved_messages)
    for snap_msg in snapshot_messages:
        if _normalize_agui_role(snap_msg.get("role", "")) != "tool":
            continue
        raw = snap_msg.get("content")
        if not isinstance(raw, str):
            continue
        try:
            parsed = _json.loads(raw)
        except (_json.JSONDecodeError, TypeError):
            continue
        if not (isinstance(parsed, dict) and "accepted" in parsed):
            continue
        snap_msg["content"] = "Confirmed" if parsed.get("accepted") else "Rejected"


_agent_run._clean_resolved_approvals_from_snapshot = _clean_resolved_approvals_aggressively


_split_wrapped = _agent_run._build_messages_snapshot


def _build_snapshot_with_approval_results(flow, snapshot_messages):
    queue = _approval_results_var.get()
    if queue:
        existing = {m.get("toolCallId") for m in flow.tool_results}
        for r in queue:
            if r["toolCallId"] not in existing:
                flow.tool_results.append(r)
        queue.clear()
    return _split_wrapped(flow, snapshot_messages)


_agent_run._build_messages_snapshot = _build_snapshot_with_approval_results


# ── Patch 3: repair orphaned tool calls in replayed history ───────────────────
# A replayed assistant function_call with no matching tool result (an interrupted
# prior turn) makes the provider 400. Inject a synthetic result for any such call,
# but SKIP calls still pending HITL approval (function_approval_response present).
from agent_framework import Content, Message  # noqa: E402
from agent_framework_ag_ui._utils import get_role_value  # noqa: E402

_orig_normalize = _agent_run.normalize_agui_input_messages


def _repair_orphaned_tool_calls(messages):
    answered: set[str] = set()
    approval_pending: set[str] = set()
    for m in messages:
        for c in getattr(m, "contents", None) or []:
            ctype = getattr(c, "type", None)
            if ctype == "function_result" and getattr(c, "call_id", None):
                answered.add(str(c.call_id))
            elif ctype == "function_approval_response":
                fc = getattr(c, "function_call", None)
                if fc is not None and getattr(fc, "call_id", None):
                    approval_pending.add(str(fc.call_id))
    skip = answered | approval_pending
    out = []
    injected = 0
    for m in messages:
        out.append(m)
        if get_role_value(m) != "assistant":
            continue
        for c in getattr(m, "contents", None) or []:
            if getattr(c, "type", None) == "function_call" and getattr(c, "call_id", None):
                cid = str(c.call_id)
                if cid in skip:
                    continue
                out.append(Message(role="tool", contents=[Content.from_function_result(
                    call_id=cid,
                    result=("Tool execution skipped — the prior turn was interrupted; "
                            "continue without this result."),
                )]))
                skip.add(cid)
                injected += 1
    if injected:
        logger.warning("[ag-ui] Repaired %d orphaned tool call(s)", injected)
    return out


def _normalize_with_orphan_repair(raw_messages, **kwargs):
    provider_messages, snapshot_messages = _orig_normalize(raw_messages, **kwargs)
    return _repair_orphaned_tool_calls(provider_messages), snapshot_messages


_agent_run.normalize_agui_input_messages = _normalize_with_orphan_repair


# ── Optional API-key auth ─────────────────────────────────────────────────────
_API_KEY = os.getenv("AG_UI_API_KEY", "").strip()
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _verify_api_key(api_key: str | None = Security(_api_key_header)) -> None:
    if not _API_KEY:
        return
    if api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


_dependencies = [Depends(_verify_api_key)] if _API_KEY else []

app = FastAPI(title=f"{AGENT_NAME} (AG-UI)")


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "agent": AGENT_NAME, "tools": len(AGENT_TOOLS)}


add_agent_framework_fastapi_endpoint(app, _agent, "/", dependencies=_dependencies)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8080")))
