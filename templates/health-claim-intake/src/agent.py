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

# MUST match <CopilotKit agent="..."> in the frontend and the hosted name.
AGENT_NAME = "health_claim_intake"


# ── Demo state (replace with your claims backend + OCR pipeline) ──────────────
#
# A few realistic-looking intake documents stand in for uploaded files. In
# production these would be the raw text/structured output of an OCR / document
# intelligence service over the user's uploads.
_DEMO_DOCUMENTS = [
    {
        "id": "claim_form.pdf",
        "kind": "claim_form",
        "text": (
            "MEMBER CLAIM FORM\n"
            "Patient: Jordan Rivera   Member ID: M-4471209\n"
            "Policy No: HX-88213   Plan: PPO Gold\n"
            "Relationship to subscriber: Self"
        ),
    },
    {
        "id": "hospital_invoice.pdf",
        "kind": "invoice",
        "text": (
            "LAKESIDE GENERAL HOSPITAL — ITEMIZED INVOICE\n"
            "Provider: Lakeside General Hospital  NPI: 1093817465\n"
            "Date of service: 2026-05-18\n"
            "Total billed: USD 1842.50"
        ),
    },
    {
        "id": "discharge_summary.pdf",
        "kind": "clinical",
        "text": (
            "DISCHARGE SUMMARY\n"
            "Primary diagnosis: Pneumonia, unspecified organism (ICD-10 J18.9)\n"
            "Admitted 2026-05-16, discharged 2026-05-18."
        ),
    },
    {
        "id": "insurance_card.jpg",
        "kind": "insurance_card",
        "text": "HealthX PPO  Member: Jordan Rivera  ID: M-4471209  Group: HX-88213",
    },
]


class _ClaimStore:
    """Tiny in-memory claim store so the starter runs with zero external deps."""

    def __init__(self) -> None:
        self.documents = _DEMO_DOCUMENTS
        self.form: dict = {}
        self.status = "draft"
        self.reference: str | None = None
        self.submitted_count = 0

    # ── reads ────────────────────────────────────────────────────────────────
    def list_documents(self) -> dict:
        return {
            "documents": [
                {"id": d["id"], "kind": d["kind"]} for d in self.documents
            ],
            "count": len(self.documents),
        }

    def read_markdown(self, document_id: str) -> dict:
        """Extract one document's content as Markdown (Document Intelligence)."""
        from docintel import extract_markdown

        doc = next((d for d in self.documents if d["id"] == document_id), None)
        if doc is None:
            return {"error": f"No document with id '{document_id}'",
                    "available": [d["id"] for d in self.documents]}
        return {"id": doc["id"], "kind": doc["kind"], "markdown": extract_markdown(doc)}

    def extract(self) -> dict:
        """Derive the claim form from the intake documents (deterministic demo)."""
        self.form = {
            "patient_name": "Jordan Rivera",
            "member_id": "M-4471209",
            "policy_number": "HX-88213",
            "provider": "Lakeside General Hospital",
            "service_date": "2026-05-18",
            "diagnosis_code": "J18.9",
            "diagnosis": "Pneumonia, unspecified organism",
            "billed_amount": 1842.50,
            "currency": "USD",
        }
        return self.snapshot()

    def snapshot(self) -> dict:
        return {
            "status": self.status,
            "submitted_count": self.submitted_count,
            "reference": self.reference,
            "form": self.form,
            "document_count": len(self.documents),
        }

    # ── edit (non-consequential draft change) ─────────────────────────────────
    def update_field(self, field: str, value) -> dict:
        if not self.form:
            self.extract()
        self.form[field] = value
        return {"status": "ok", "field": field, "value": value, "form": self.form}

    # ── consequential ─────────────────────────────────────────────────────────
    def submit(self) -> dict:
        if not self.form:
            # In real usage the agent extracts first; auto-fill so submit is
            # always meaningful (and so the offline smoke can prove the gate).
            self.extract()
        self.submitted_count += 1
        self.status = "submitted"
        self.reference = f"CLM-{self.submitted_count:06d}"
        return {
            "status": "ok",
            "reference": self.reference,
            "submitted_count": self.submitted_count,
            "claim_status": self.status,
            "form": self.form,
        }


STORE = _ClaimStore()


_INSTRUCTIONS = """\
You are a careful health insurance claim intake assistant. You help a claims \
handler turn uploaded documents into a complete, accurate claim and submit it.

Workflow:
- Use `list_documents` to see which intake documents are available.
- Use `read_document_markdown(document_id)` to read a single document's full \
content as Markdown (Azure Document Intelligence) when you need detail or to \
verify a field.
- Use `extract_claim_form` to auto-fill the claim form from those documents. \
Never invent field values — only report what extraction returns.
- If the user wants to correct a value, call `update_claim_field(field, value)`. \
Editing the draft is safe and does NOT require approval.
- Use `get_claim` to read the current claim (form, status, reference) before \
answering questions about it.
- To submit the claim, call `submit_claim`. This tool is gated by human \
approval: the system shows the user an Approve/Reject card and only files the \
claim if they approve. Do NOT ask "are you sure?" in text first — just call the \
tool and let the approval gate do its job.

Rules:
- After a successful submission, state the claim reference plainly (quote the \
tool result).
- Be concise. If the user only chats, answer briefly without calling tools.
"""


# ── Read tools (no side effects) ──────────────────────────────────────────────
@tool
async def list_documents() -> str:
    """List the claim intake documents available for this case."""
    return json.dumps(STORE.list_documents(), ensure_ascii=False)


@tool
async def extract_claim_form() -> str:
    """Auto-fill the claim form by extracting fields from the intake documents."""
    return json.dumps(STORE.extract(), ensure_ascii=False)


@tool
async def read_document_markdown(document_id: str) -> str:
    """Read one intake document and return its content as Markdown.

    Uses Azure Document Intelligence (prebuilt-layout, Markdown output) when a
    `DOCUMENTINTELLIGENCE_ENDPOINT` is configured; otherwise returns a mock so the
    demo runs offline. Read-only — no approval needed.
    """
    return json.dumps(STORE.read_markdown(document_id), ensure_ascii=False)


@tool
async def get_claim() -> str:
    """Return the current claim: form fields, status, and submission reference."""
    return json.dumps(STORE.snapshot(), ensure_ascii=False)


# ── Edit tool (draft change — reversible, so NOT approval-gated) ──────────────
@tool
async def update_claim_field(field: str, value: str) -> str:
    """Update one field on the draft claim form (e.g. a user correction)."""
    return json.dumps(STORE.update_field(field, value), ensure_ascii=False)


# ── Consequential tool — body runs ONLY after the user approves ──────────────
@tool(approval_mode="always_require")
async def submit_claim() -> str:
    """Finalize and submit the claim to the insurer. Requires human approval."""
    return json.dumps(STORE.submit(), ensure_ascii=False)


AGENT_TOOLS = [
    list_documents,
    read_document_markdown,
    extract_claim_form,
    get_claim,
    update_claim_field,
    submit_claim,
]


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
