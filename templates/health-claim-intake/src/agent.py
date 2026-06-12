"""The ONE Microsoft Agent Framework agent — imported by both front doors.

`backend/ag_ui_app.py` (local AG-UI/SSE behind CopilotKit) and
`hosted/responses/main.py` (Foundry hosted Responses agent) both import
`build_agent()` from here, so your business logic lives in exactly one place.

This template is a **health insurance claim intake** assistant. It:

  * intakes multiple claim documents (claim form, hospital invoice, discharge
    summary, insurance card) — `list_documents` (read),
  * auto-fills a structured claim form from those documents —
    `extract_claim_form` (read/compute),
  * lets the user review and edit individual fields — `update_claim_field`
    (a non-consequential draft edit, no approval needed),
  * submits the finalized claim to the insurer — `submit_claim`, decorated
    `@tool(approval_mode="always_require")` so the runtime PAUSES for explicit
    human Approve/Reject before the body runs.

Keep the shape: one or more *read* tools (no side effects) plus one or more
*consequential* tools gated by approval. Replace the demo documents + extraction
with a real OCR / document-intelligence pipeline for production.

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
    extract_claim_form,
    get_claim,
    update_claim_field,
    submit_claim,
]


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
