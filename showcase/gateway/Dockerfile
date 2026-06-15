# Showcase gateway container — hosts ALL gallery agents in one always-on image.
#
# Build context MUST be the repo root so the template backends can be copied:
#   docker build -f showcase/gateway/Dockerfile -t showcase-gateway .
#   az acr build -r <acr> -f showcase/gateway/Dockerfile .
#
# MCR base image (NOT Docker Hub) — `az acr build` / ACR Tasks hit Docker Hub's
# anonymous pull rate limit ("toomanyrequests") constantly.
FROM mcr.microsoft.com/devcontainers/python:3.12

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 REPO_ROOT=/app

WORKDIR /app

# Install deps first so source edits don't bust the dependency cache. The
# gateway requirements pin the LATEST agent-framework stack and satisfy every
# template backend (they import agent-framework / -openai / -ag-ui), so we do NOT
# install the templates' own pinned requirements.
COPY showcase/gateway/requirements.txt /tmp/gateway-requirements.txt
RUN pip install --no-cache-dir --pre -r /tmp/gateway-requirements.txt

# Each template backend imports its own ../src (sys.path insert in ag_ui_app.py),
# so copy both src/ and backend/ for every featured agent.
COPY templates/agentic-copilot-foundry/src/     ./templates/agentic-copilot-foundry/src/
COPY templates/agentic-copilot-foundry/backend/ ./templates/agentic-copilot-foundry/backend/
COPY templates/conversational-banking/src/      ./templates/conversational-banking/src/
COPY templates/conversational-banking/backend/  ./templates/conversational-banking/backend/
COPY templates/health-claim-intake/src/         ./templates/health-claim-intake/src/
COPY templates/health-claim-intake/backend/     ./templates/health-claim-intake/backend/

# Gateway + registry.
COPY showcase/agents.json   ./showcase/agents.json
COPY showcase/gateway/      ./showcase/gateway/

RUN useradd --uid 1001 --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
CMD ["python", "showcase/gateway/launcher.py"]
