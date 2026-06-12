"""The ONE Microsoft Agent Framework agent — imported by both front doors.

`backend/ag_ui_app.py` (local AG-UI/SSE behind CopilotKit) and
`hosted/responses/main.py` (Foundry hosted Responses agent) both import
`build_agent()` from here, so your business logic lives in exactly one place.

This is a **domain-agnostic starter**. Replace the demo store + two tools with
your own. Keep the shape:

  * one or more *read* tools (no side effects),
  * one or more *consequential* tools decorated `@tool(approval_mode="always_require")`
    so the runtime pauses for human approval before the body runs.

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

# MUST match <CopilotKit agent="..."> in the frontend and the hosted name. The
# new-app.sh scaffolder rewrites this token when it instantiates the template.
AGENT_NAME = "forgewright_app"


# ── Demo state (replace with your domain) ─────────────────────────────────────
class _Store:
    """Tiny in-memory store so the starter runs with zero external deps."""

    def __init__(self) -> None:
        self.value = 100

    def snapshot(self) -> dict:
        return {"value": self.value}

    def apply_delta(self, delta: float) -> dict:
        self.value = round(self.value + float(delta), 4)
        return {"status": "ok", "value": self.value}


STORE = _Store()


_INSTRUCTIONS = """\
You are a concise, helpful assistant for a demo workspace that holds a single \
numeric value.

Rules:
- Always call `get_value` to read the current value before answering any \
question about it — never invent or recompute it yourself.
- To change the value, call `apply_delta(delta)`. This tool is gated by human \
approval: the system shows the user an Approve/Reject card and only runs the \
change if they approve. Do NOT ask "are you sure?" in text first — just call the \
tool and let the approval gate do its job.
- After a change is applied, state the new value plainly (quote the tool result).
- If the user only chats, answer briefly without calling tools.
"""


# ── Read tool (no side effects) ───────────────────────────────────────────────
@tool
async def get_value() -> str:
    """Return the current value of the workspace. Call before answering."""
    return json.dumps(STORE.snapshot(), ensure_ascii=False)


# ── Consequential tool — body runs ONLY after the user approves ──────────────
@tool(approval_mode="always_require")
async def apply_delta(delta: float) -> str:
    """Change the workspace value by `delta`. Requires human approval."""
    return json.dumps(STORE.apply_delta(delta), ensure_ascii=False)


AGENT_TOOLS = [get_value, apply_delta]


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
