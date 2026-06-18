"""Document Intelligence → Markdown extraction for the claim-intake agent.

This is the real OCR pipeline behind the demo: given an uploaded document, call
**Azure AI Document Intelligence** (`prebuilt-layout`) with Markdown output and
return the content as Markdown — ideal for feeding an LLM (tables, headings, and
key/value pairs survive as text).

Design notes
------------
* **Where it lives.** This is a *tool in the hosted agent's code* (see
  ``read_document_markdown`` in ``agent.py``), so the same logic runs both behind
  the local AG-UI/CopilotKit front door and in the Foundry **hosted agent**. It can
  equally be registered as a **Foundry Toolbox** tool — the function body is the
  same; only the registration surface differs.
* **Read-only → no HITL.** Extraction has no side effects, so it is NOT
  approval-gated. Only the consequential ``submit_claim`` pauses for approval.
* **Keyless by default.** Uses ``DefaultAzureCredential`` against the
  ``https://cognitiveservices.azure.com/.default`` audience. A key
  (``DOCUMENTINTELLIGENCE_API_KEY``) is supported as a fallback.
* **Offline fallback.** When ``DOCUMENTINTELLIGENCE_ENDPOINT`` is unset (e.g.
  ``make smoke`` / CI), it synthesizes Markdown from the demo document text so the
  whole stack runs with no Azure resources.

Set ``DOCUMENTINTELLIGENCE_ENDPOINT`` (and give the agent identity the *Cognitive
Services User* role) to use the real service. Add ``azure-ai-documentintelligence``
to requirements when you do.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger("forgewright.docintel")

_AUDIENCE = "https://cognitiveservices.azure.com/.default"


def _mock_markdown(doc: dict) -> str:
    """Deterministic Markdown stand-in derived from the demo document text."""
    title = doc.get("kind", "document").replace("_", " ").title()
    lines = (doc.get("text") or "").splitlines()
    body = "\n".join(f"> {ln}" for ln in lines if ln.strip())
    return f"# {title}\n\n_Source: {doc.get('id')}_ (mock extraction)\n\n{body}\n"


def extract_markdown(doc: dict) -> str:
    """Return the document's content as Markdown.

    ``doc`` is an intake-document record. If it carries a ``url`` or ``path`` and a
    real Document Intelligence endpoint is configured, the service is called;
    otherwise a deterministic mock is returned.
    """
    endpoint = os.environ.get("DOCUMENTINTELLIGENCE_ENDPOINT", "").rstrip("/")
    source_url = doc.get("url")
    source_path = doc.get("path")
    if not endpoint or not (source_url or source_path):
        return _mock_markdown(doc)

    try:
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        from azure.ai.documentintelligence.models import (
            AnalyzeDocumentRequest,
            AnalyzeResult,
            DocumentContentFormat,
        )

        key = os.environ.get("DOCUMENTINTELLIGENCE_API_KEY")
        if key:
            from azure.core.credentials import AzureKeyCredential

            credential = AzureKeyCredential(key)
        else:
            from azure.identity import DefaultAzureCredential

            credential = DefaultAzureCredential()

        client = DocumentIntelligenceClient(endpoint=endpoint, credential=credential)
        if source_url:
            request = AnalyzeDocumentRequest(url_source=source_url)
        else:
            with open(source_path, "rb") as fh:  # noqa: PTH123
                request = AnalyzeDocumentRequest(bytes_source=fh.read())
        poller = client.begin_analyze_document(
            "prebuilt-layout",
            request,
            output_content_format=DocumentContentFormat.MARKDOWN,
        )
        result: AnalyzeResult = poller.result()
        logger.info("[docintel] extracted %s as %s", doc.get("id"), result.content_format)
        return result.content or _mock_markdown(doc)
    except Exception as exc:  # noqa: BLE001 — never break the agent on extraction errors
        logger.warning("[docintel] falling back to mock for %s: %s", doc.get("id"), exc)
        return _mock_markdown(doc)
