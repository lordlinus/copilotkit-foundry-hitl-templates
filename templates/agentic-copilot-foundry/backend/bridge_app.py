"""AG-UI server for the CopilotKit frontend — a thin bridge to a Foundry HOSTED agent.

`HostedProxyAgent` (a `SupportsAgentRun`) forwards each AG-UI turn to the deployed
Foundry hosted agent over streaming Responses (`hosted_client`), translates the
output back to AG-UI (text, tool-render cards, `confirm_changes`), and forwards the
HITL decision as an `mcp_approval_response` so the gated tool RE-EXECUTES
server-side. This forwarding is the bridge's reason to exist — the framework's
native `add_agent_framework_fastapi_endpoint(FoundryAgent(...))` resolves
`confirm_changes` locally and never re-runs the tool.

Configure with `FOUNDRY_PROJECT_ENDPOINT` + `HOSTED_AGENT_NAME` (deployed), or
`HOSTED_AGENT_DIRECT_URL` (DIRECT mode) to point at the REAL agent running locally
via `azd ai agent run`. `make local` / `make smoke` use DIRECT mode, so they drive
this exact code path against the real agent — no mock. Run:
`uvicorn bridge_app:app --host 0.0.0.0 --port 8080`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv

load_dotenv(override=False)

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import APIKeyHeader

from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint

import agent_framework_ag_ui._agent_run as _agent_run

from hosted_proxy import HostedProxyAgent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("forgewright.bridge")


# ── HITL routing patches (apply once, before mounting the endpoint) ───────────
# agent-framework-ag-ui resolves a `confirm_changes` approval LOCALLY (a canned
# "confirmed" message via `_is_confirm_changes_response`, or a local tool call via
# `_resolve_approval_responses`). Our tools live in the hosted agent, so we
# neutralise both — the decision then flows to `HostedProxyAgent.run`, which sends
# an `mcp_approval_response` to the hosted agent (re-executing the tool server-side).
def _no_confirm_interception(_messages):
    return False


async def _passthrough_resolve(*_args, **_kwargs):
    return []


# CopilotKit v1 renders only `message.toolCalls[0]` per snapshot assistant message,
# so a turn with >1 tool call (e.g. a gated tool + its confirm_changes) drops the
# 2nd card at RUN_FINISHED. Split such messages one-tool-per-message. (Set
# DISABLE_C9_SPLIT=1 on a CopilotKit v2 frontend, which renders all tool calls.)
_orig_build_snapshot = _agent_run._build_messages_snapshot


def _split_multi_tool_snapshot(flow, snapshot_messages):
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


_agent_run._is_confirm_changes_response = _no_confirm_interception
_agent_run._resolve_approval_responses = _passthrough_resolve
if os.getenv("DISABLE_C9_SPLIT", "").strip() != "1":
    _agent_run._build_messages_snapshot = _split_multi_tool_snapshot
logger.info("[bridge] HITL routed to hosted agent; C9 split=%s",
            os.getenv("DISABLE_C9_SPLIT", "") != "1")


class SSEKeepAliveMiddleware:
    """Inject SSE keepalive comments (``: ping``) when a streaming response is idle
    for ``interval`` seconds, so a long silent server-side tool doesn't let a gateway
    in front (SWA/Vercel/nginx) drop the stream."""

    def __init__(self, app, interval: float = 10.0) -> None:
        self.app = app
        self.interval = interval

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        queue: asyncio.Queue = asyncio.Queue()
        _DONE = object()
        is_sse = False
        started = False

        async def _wrapped_send(message):
            await queue.put(message)

        async def _run():
            try:
                await self.app(scope, receive, _wrapped_send)
            finally:
                await queue.put(_DONE)

        task = asyncio.create_task(_run())
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=self.interval)
                except asyncio.TimeoutError:
                    if is_sse and started:
                        await send({"type": "http.response.body", "body": b": ping\n\n",
                                    "more_body": True})
                    continue
                if msg is _DONE:
                    break
                if msg.get("type") == "http.response.start":
                    started = True
                    for k, v in msg.get("headers") or []:
                        if k.lower() == b"content-type" and v.lower().startswith(b"text/event-stream"):
                            is_sse = True
                    await send(msg)
                elif msg.get("type") == "http.response.body":
                    await send(msg)
                    if not msg.get("more_body", False):
                        break
                else:
                    await send(msg)
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass


_agent = HostedProxyAgent()

# ── Optional API-key auth (the runtime injects X-API-Key server-side) ─────────
_API_KEY = os.getenv("AG_UI_API_KEY", "").strip()
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _verify_api_key(api_key: str | None = Security(_api_key_header)) -> None:
    if not _API_KEY:
        return
    if api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


_dependencies = [Depends(_verify_api_key)] if _API_KEY else []

app = FastAPI(title="forgewright AG-UI bridge")
app.add_middleware(SSEKeepAliveMiddleware, interval=float(os.getenv("SSE_KEEPALIVE_SECS", "10")))


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "hosted_agent": os.getenv("HOSTED_AGENT_NAME")}


add_agent_framework_fastapi_endpoint(app, _agent, "/", dependencies=_dependencies)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8080")))
