"""The ONE Microsoft Agent Framework agent — the single source of truth.

`build_hosted_agent()` builds the agent (tools + instructions) on a
**FoundryChatClient** (Responses). It is the brain everywhere — the SAME code runs:
  * **local dev:** `azd ai agent run` runs it on your machine (hot reload),
    connected to your Foundry project's model;
  * **deployed:** `azd up` publishes it as a Foundry HOSTED agent.

Either way `ResponsesHostServer` (`app.py` / `hosted/responses/main.py`) serves the
Responses protocol, and the bridge (`backend/bridge_app.py` → `HostedProxyAgent`)
forwards each AG-UI turn to it and forwards `mcp_approval_response` on HITL approve,
so the gated tool re-executes server-side. There is **no mock** — `make local` and
`make smoke` drive the real agent via `azd ai agent run`.

This is a **domain-agnostic starter**. Replace the demo store + two tools with
your own. Keep the shape:

  * one or more *read* tools (no side effects),
  * one or more *consequential* tools decorated `@tool(approval_mode="always_require")`
    so the runtime pauses for human approval before the body runs.

Connection to Azure AI Foundry is **keyless** (DefaultAzureCredential).
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


# ── Shared/predictive state config (override per template; see patterns-7.md) ──
# When a tool writes a state key, map it here so the AG-UI adapter natively emits
# StateSnapshot/StateDelta to CopilotKit's useAgent. Empty = no shared state demo.
AGENT_STATE_SCHEMA: dict | None = None
AGENT_PREDICT_STATE: dict | None = None


def build_hosted_agent():
    """The agent — the single brain. Served by `ResponsesHostServer`
    (`app.py` / `hosted/responses/main.py`): deployed via `azd up`, and run locally
    for development via `azd ai agent run` (the same code, connected to the env's
    Foundry resources). Uses **`FoundryChatClient` (Responses)** — REQUIRED for HITL:
    the runtime emits an `mcp_approval_request` and the bridge resumes with an
    `mcp_approval_response`, which re-executes the gated tool server-side (verified
    live: approve → tool runs, state changes). `store=False` — hosting manages history.
    """
    from agent_framework import Agent
    from agent_framework.foundry import FoundryChatClient
    from azure.identity import DefaultAzureCredential

    project = os.environ["FOUNDRY_PROJECT_ENDPOINT"].rstrip("/")
    model = os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"]
    logger.info("[agent] keyless Foundry FoundryChatClient (Responses) | model=%s", model)
    client = FoundryChatClient(project_endpoint=project, model=model,
                               credential=DefaultAzureCredential())

    agent = Agent(client=client, name=AGENT_NAME, instructions=_INSTRUCTIONS,
                  tools=AGENT_TOOLS, default_options={"store": False})
    logger.info("[agent] built hosted %s (Responses) | tools=%d", AGENT_NAME, len(AGENT_TOOLS))
    return agent
