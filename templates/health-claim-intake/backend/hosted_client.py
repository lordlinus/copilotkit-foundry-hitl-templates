"""Raw-REST driver for a deployed Foundry HOSTED agent (Responses protocol).

The bridge (`HostedProxyAgent`) forwards each AG-UI turn here; the deployed agent
runs the FULL loop server-side (orchestration + tools + HITL). We stream its
Responses SSE and normalise events for the proxy to translate to AG-UI.

Per-thread state (single Container App replica; in-memory cache): one Foundry
`conversation` (chat history/memory + Conversation ID in traces) + one
`agent_session_id` (persistent $HOME/journal + server-side tool execution).

Keyless via DefaultAzureCredential (audience https://ai.azure.com/.default).
Configure with FOUNDRY_PROJECT_ENDPOINT + HOSTED_AGENT_NAME (optional
HOSTED_AGENT_VERSION; blank => latest).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import httpx
from azure.identity.aio import DefaultAzureCredential

logger = logging.getLogger("hosted_client")

_PROJECT_ENDPOINT = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip().rstrip("/")
_AGENT_NAME = os.getenv("HOSTED_AGENT_NAME", "").strip()
_AGENT_VERSION = os.getenv("HOSTED_AGENT_VERSION", "").strip()  # blank → latest
_AI_SCOPE = "https://ai.azure.com/.default"
# Preview opt-in header required by the Foundry hosted-agent endpoints.
_FOUNDRY_FEATURES = "HostedAgents=V1Preview,AgentEndpoints=V1Preview"
# Offline / local: skip Entra auth entirely.
_NO_AUTH = os.getenv("HOSTED_AUTH", "").strip().lower() == "none"
# DIRECT mode: point at a raw ResponsesHostServer (e.g. `azd ai agent run` on
# :8088) — POST straight to {url}/responses with previous_response_id chaining, no
# Foundry platform version/session/conversation calls. This is the dev loop.
_DIRECT_URL = os.getenv("HOSTED_AGENT_DIRECT_URL", "").strip().rstrip("/")


class HostedAgentClient:
    """Async driver for a Foundry hosted agent (Responses protocol).

    Two modes: PLATFORM (a deployed agent — version/session/conversation +
    agent_reference) and DIRECT (a local `azd ai agent run` ResponsesHostServer —
    plain /responses + previous_response_id chaining), selected by
    `HOSTED_AGENT_DIRECT_URL`.
    """

    def __init__(self) -> None:
        self._cred = None if (_NO_AUTH or _DIRECT_URL) else DefaultAzureCredential()
        self._sessions: dict[str, str] = {}
        self._conversations: dict[str, str] = {}
        self._last_response: dict[str, str] = {}
        self._version: str | None = _AGENT_VERSION or None
        self._token: str | None = None
        self._token_exp: float = 0.0
        self._lock = asyncio.Lock()

    @property
    def _responses_url(self) -> str:
        if _DIRECT_URL:
            return f"{_DIRECT_URL}/responses"
        return (f"{_PROJECT_ENDPOINT}/agents/{_AGENT_NAME}"
                "/endpoint/protocols/openai/responses?api-version=v1")

    @property
    def _conversations_url(self) -> str:
        return (f"{_PROJECT_ENDPOINT}/agents/{_AGENT_NAME}"
                "/endpoint/protocols/openai/conversations?api-version=v1")

    async def _conversation_for(self, case_id: str) -> str:
        """One Foundry conversation per case. The conversation maintains the chat
        history server-side (so memory survives bridge restarts) and groups the
        turns under a Conversation ID in the Foundry traces. Distinct from the
        agent_session_id, which only shares the journal/$HOME."""
        conv = self._conversations.get(case_id)
        if conv:
            return conv
        async with self._lock:
            conv = self._conversations.get(case_id)
            if conv:
                return conv
            async with httpx.AsyncClient() as c:
                r = await c.post(self._conversations_url,
                                 headers={"Authorization": f"Bearer {await self._bearer()}",
                                          "Content-Type": "application/json"},
                                 json={}, timeout=30)
            if r.status_code >= 400:
                raise RuntimeError(f"create_conversation HTTP {r.status_code}: {r.text[:200]}")
            conv = r.json()["id"]
            self._conversations[case_id] = conv
            logger.info("[hosted] created conversation for case=%s -> %s", case_id, conv[:18])
            return conv

    async def _bearer(self) -> str:
        if _NO_AUTH or _DIRECT_URL:
            return "offline"
        if self._token and time.time() < self._token_exp - 120:
            return self._token
        tok = await self._cred.get_token(_AI_SCOPE)
        self._token = tok.token
        self._token_exp = tok.expires_on
        return self._token

    async def _latest_version(self) -> str:
        if self._version:
            return self._version
        url = f"{_PROJECT_ENDPOINT}/agents/{_AGENT_NAME}?api-version=v1"
        async with httpx.AsyncClient() as c:
            r = await c.get(url, headers={"Authorization": f"Bearer {await self._bearer()}"}, timeout=30)
            r.raise_for_status()
            self._version = str(r.json()["versions"]["latest"]["version"])
        logger.info("[hosted] resolved latest version=%s", self._version)
        return self._version

    async def _session_for(self, case_id: str) -> str:
        sid = self._sessions.get(case_id)
        if sid:
            return sid
        async with self._lock:
            sid = self._sessions.get(case_id)
            if sid:
                return sid
            version = await self._latest_version()
            url = f"{_PROJECT_ENDPOINT}/agents/{_AGENT_NAME}/endpoint/sessions?api-version=v1"
            headers = {
                "Authorization": f"Bearer {await self._bearer()}",
                "Content-Type": "application/json",
                "Foundry-Features": _FOUNDRY_FEATURES,
            }
            body = {"version_indicator": {"agent_version": version, "type": "version_ref"}}
            async with httpx.AsyncClient() as c:
                r = await c.post(url, headers=headers, json=body, timeout=60)
            if r.status_code >= 400:
                raise RuntimeError(f"create_session HTTP {r.status_code}: {r.text[:200]}")
            sid = r.json()["agent_session_id"]
            self._sessions[case_id] = sid
            logger.info("[hosted] created session for case=%s -> %s", case_id, sid[:18])
            return sid

    async def converse_stream(self, case_id: str, agui_input: Any,
                              previous_response_id: str | None = None):
        """STREAM a turn to the hosted agent and yield normalised events AS THEY
        happen, so the bridge can relay them to AG-UI in real time (no 60s silent
        wait). With an agent_session_id the hosted runtime executes tools
        server-side AND streams function_call → function_call_output → text deltas;
        the per-case `conversation` maintains chat history (memory) server-side AND
        groups the turns under a Conversation ID in the Foundry traces.

        Yields dicts:
          {"kind":"function_call", "call_id", "name", "arguments"}
          {"kind":"result", "call_id", "output"}
          {"kind":"text", "delta"}
          {"kind":"approval", "id", "name", "arguments"}
          {"kind":"error", "detail"}
        """
        if _DIRECT_URL:
            # DIRECT mode: a raw ResponsesHostServer (local `azd ai agent run`).
            # No platform version/session/conversation; chain previous_response_id
            # for memory + HITL approve-resume.
            body: dict[str, Any] = {"input": agui_input, "stream": True}
            prev = previous_response_id or self._last_response.get(case_id)
            if prev:
                body["previous_response_id"] = prev
            headers = {"Content-Type": "application/json"}
        else:
            version = await self._latest_version()
            session_id = await self._session_for(case_id)
            conversation = await self._conversation_for(case_id)
            body = {
                "input": agui_input,
                "stream": True,
                "conversation": conversation,        # chat history + Conversation ID grouping
                "agent_session_id": session_id,       # journal/$HOME + server-side tool execution
                "agent_reference": {"type": "agent_reference", "name": _AGENT_NAME, "version": version},
            }
            if previous_response_id:
                body["previous_response_id"] = previous_response_id
            headers = {"Authorization": f"Bearer {await self._bearer()}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as c:
            async with c.stream("POST", self._responses_url, headers=headers, json=body) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode("utf-8", "replace")[:200]
                    logger.error("[hosted] stream %s -> HTTP %s: %s", _AGENT_NAME, resp.status_code, detail)
                    yield {"kind": "error", "detail": f"HTTP {resp.status_code}: {detail}"}
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw:
                        continue
                    try:
                        d = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    t = d.get("type", "")
                    if t == "response.output_text.delta":
                        delta = d.get("delta", "")
                        if delta:
                            yield {"kind": "text", "delta": delta}
                    elif t == "response.output_item.done":
                        it = d.get("item", {}) or {}
                        itype = it.get("type")
                        if itype == "function_call":
                            yield {"kind": "function_call", "call_id": it.get("call_id") or it.get("id"),
                                   "name": it.get("name", ""), "arguments": it.get("arguments", "")}
                        elif itype == "function_call_output":
                            yield {"kind": "result", "call_id": it.get("call_id"),
                                   "output": it.get("output")}
                        elif itype == "mcp_approval_request":
                            yield {"kind": "approval", "id": it.get("id"),
                                   "name": it.get("name", ""), "arguments": it.get("arguments", "")}
                    elif t == "response.completed":
                        rid = (d.get("response", {}) or {}).get("id") or d.get("id")
                        if rid:
                            self._last_response[case_id] = rid
                    elif t == "response.failed" or (d.get("response", {}) or {}).get("error"):
                        err = (d.get("response", {}) or {}).get("error") or d.get("error")
                        if err:
                            yield {"kind": "error", "detail": str(err)[:200]}



_client: HostedAgentClient | None = None


def client() -> HostedAgentClient:
    global _client
    if _client is None:
        _client = HostedAgentClient()
    return _client
