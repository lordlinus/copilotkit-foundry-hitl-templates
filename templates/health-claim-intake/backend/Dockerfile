# AG-UI bridge (FastAPI + SSE). Serves the agent_framework_ag_ui endpoint at /,
# backed by HostedProxyAgent (the thin AG-UI↔Responses bridge) with its two
# resilience patches applied in bridge_app.py.
#
# MCR base image (NOT Docker Hub) — `az acr build` / ACR Tasks hit Docker Hub's
# anonymous pull rate limit ("toomanyrequests") constantly.
FROM mcr.microsoft.com/devcontainers/python:3.12

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PORT=8080

WORKDIR /app

# Install deps separately so source edits don't bust the dependency cache.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# src/ is imported by the backend (sys.path insert in hosted_proxy / bridge_app).
COPY src/ ./src/
COPY backend/ ./

RUN useradd --uid 1001 --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
# Entrypoint = the light AG-UI↔Responses bridge (no LLM/tools). All logic lives in
# the Foundry hosted agent; the bridge forwards turns + mcp_approval_response to it.
CMD ["uvicorn", "bridge_app:app", "--host", "0.0.0.0", "--port", "8080"]
