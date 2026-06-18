"""CopilotSDKAgent — run the GitHub Copilot SDK as a Foundry HOSTED agent.

Foundry's hosting adapter ``ResponsesHostServer`` accepts any object that
satisfies the **structural** ``SupportsAgentRun`` protocol (``id``/``name``/
``description`` + ``run()``/``create_session()``/``get_session()``) — it does NOT
require an Agent Framework ``Agent`` subclass. So this thin adapter wraps a
``copilot.CopilotClient`` session and exposes it as a hostable agent.

Mapping:
  • Foundry passes the conversation history in ``messages``; the Copilot session
    keeps its OWN history, so we forward only the latest user turn and rely on the
    per-session Copilot session for continuity.
  • ``run(stream=True)`` yields ``AgentResponseUpdate(contents=[Content.from_text])``
    bridged from Copilot ``assistant.message_delta`` events via an asyncio queue.
  • ``run(stream=False)`` returns ``AgentResponse(messages=[assistant Message])``.

HITL note: a Foundry hosted agent speaks the **Responses** protocol, not AG-UI, so
this hosted variant uses ``approve_all`` for tools. The human-in-the-loop
(``confirm_changes`` approval) lives in the self-hosted **gateway** variant where
AG-UI drives the approval card. See README.
"""
from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Mapping
from typing import Any
from uuid import uuid4

from agent_framework import AgentResponse, AgentResponseUpdate, AgentSession, Content, Message
from copilot import CopilotClient, ToolSet, define_tool
from copilot.session import PermissionHandler
from copilot.generated.session_events import (
    AssistantMessageData,
    AssistantMessageDeltaData,
    SessionIdleData,
)
from pydantic import BaseModel, Field

from provider import build_provider, MODEL_NAME

logger = logging.getLogger("copilot_hosted")

# ── Tools (mirror the gateway PR agent's read tools) ──────────────────────────
_CHANGED_FILES = [
    {"path": "src/auth/session.ts", "summary": "Add Secure + SameSite=Strict to the session cookie",
     "diff": "- res.cookie('sid', token, { httpOnly: true });\n+ res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'strict' });"},
    {"path": "src/auth/session.test.ts", "summary": "Test the cookie security flags",
     "diff": "+ it('sets Secure + SameSite=Strict', () => { expect(setCookie).toMatch(/Secure/); });"},
]


class _DiffParams(BaseModel):
    path: str = Field(description="File path from list_changed_files")


def _build_tools() -> list[Any]:
    async def _list(_args: Any, _inv: Any) -> dict:
        return {"files": [{"path": f["path"], "summary": f["summary"]} for f in _CHANGED_FILES],
                "count": len(_CHANGED_FILES)}

    async def _diff(args: _DiffParams, _inv: Any) -> dict:
        f = next((x for x in _CHANGED_FILES if x["path"] == args.path), None)
        return {"path": f["path"], "diff": f["diff"]} if f else {"error": "no such file"}

    return [
        define_tool(name="list_changed_files",
                    description="List files changed on the working branch.",
                    handler=_list, skip_permission=True),
        define_tool(name="get_file_diff",
                    description="Get the unified diff for one changed file.",
                    handler=_diff, params_type=_DiffParams, skip_permission=True),
    ]


_SYSTEM = (
    "You are a senior engineer that reviews code changes and drafts pull requests. "
    "Call list_changed_files, then get_file_diff for each file, then summarize a clear "
    "PR title and description (what changed and why; mention security impact). Be concise."
)


class CopilotSDKAgent:
    """Adapter exposing a Copilot SDK session as a Foundry-hostable SupportsAgentRun."""

    def __init__(self) -> None:
        self.id: str = "copilot-pr-assistant-hosted"
        self.name: str | None = "Copilot PR Assistant (hosted)"
        self.description: str | None = "GitHub Copilot SDK agent, hosted on Foundry (Responses protocol)."
        self._client: CopilotClient | None = None
        self._sessions: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    # ── SupportsAgentRun: sessions ────────────────────────────────────────────
    def create_session(self, *, session_id: str | None = None) -> AgentSession:
        return AgentSession(session_id=session_id)

    def get_session(self, service_session_id: str, *, session_id: str | None = None) -> AgentSession:
        return AgentSession(session_id=session_id, service_session_id=service_session_id)

    # ── internals ─────────────────────────────────────────────────────────────
    async def _ensure_client(self) -> CopilotClient:
        if self._client is None:
            self._client = CopilotClient(
                mode="empty",
                base_directory=os.environ.get("COPILOT_HOME", "/tmp/.copilot-home"),
                log_level="error",
            )
            await self._client.start()
        return self._client

    async def _copilot_session(self, key: str):
        async with self._lock:
            if key in self._sessions:
                return self._sessions[key]
            client = await self._ensure_client()
            sess = await client.create_session(
                session_id=f"foundry-{key}",
                model=MODEL_NAME,
                provider=await build_provider(),
                tools=_build_tools(),
                available_tools=ToolSet().add_custom("*"),
                system_message={"mode": "replace", "content": _SYSTEM},
                on_permission_request=PermissionHandler.approve_all,
                streaming=True,
            )
            self._sessions[key] = sess
            return sess

    @staticmethod
    def _latest_user_text(messages: Any) -> str:
        if isinstance(messages, str):
            return messages
        if not messages:
            return ""
        seq = messages if isinstance(messages, list) else [messages]
        for m in reversed(seq):
            role = getattr(m, "role", None)
            if str(role) == "user" or role == "user":
                for c in getattr(m, "contents", []) or []:
                    if getattr(c, "type", None) == "text" and getattr(c, "text", None):
                        return c.text
        # fall back to the last message's text
        last = seq[-1]
        for c in getattr(last, "contents", []) or []:
            if getattr(c, "text", None):
                return c.text
        return ""

    # ── SupportsAgentRun: run ─────────────────────────────────────────────────
    def run(
        self,
        messages: Any = None,
        *,
        stream: bool = False,
        session: AgentSession | None = None,
        function_invocation_kwargs: Mapping[str, Any] | None = None,
        client_kwargs: Mapping[str, Any] | None = None,
        **_: Any,
    ) -> Awaitable[AgentResponse] | Any:
        key = (session.service_session_id or session.session_id) if session else "default"
        key = key or "default"
        prompt = self._latest_user_text(messages)
        if stream:
            return self._run_stream(key, prompt)
        return self._run_once(key, prompt)

    async def _run_once(self, key: str, prompt: str) -> AgentResponse:
        sess = await self._copilot_session(key)
        chunks: list[str] = []

        def handler(event: Any) -> None:
            data = getattr(event, "data", None)
            if isinstance(data, AssistantMessageData) and data.content:
                chunks.append(data.content)

        unsub = sess.on(handler)
        try:
            await sess.send_and_wait(prompt, timeout=120.0)
        finally:
            unsub()
        text = chunks[-1] if chunks else ""
        return AgentResponse(messages=[Message(role="assistant", contents=[Content.from_text(text)])])

    async def _run_stream(self, key: str, prompt: str):
        sess = await self._copilot_session(key)
        queue: asyncio.Queue = asyncio.Queue()
        mid = uuid4().hex

        def handler(event: Any) -> None:
            data = getattr(event, "data", None)
            if isinstance(data, AssistantMessageDeltaData) and data.delta_content:
                queue.put_nowait(("delta", data.delta_content))
            elif isinstance(data, SessionIdleData):
                queue.put_nowait(("done", None))

        unsub = sess.on(handler)
        try:
            await sess.send(prompt)
            while True:
                kind, payload = await queue.get()
                if kind == "done":
                    break
                yield AgentResponseUpdate(
                    contents=[Content.from_text(payload)], role="assistant", message_id=mid,
                )
        finally:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                pass
