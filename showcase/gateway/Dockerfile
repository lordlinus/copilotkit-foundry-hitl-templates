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

# Install deps first so source edits don't bust the dependency cache. These pin
# the templates' verified stack and cover BOTH the hosted-agent runtime
# (ResponsesHostServer) and the AG-UI bridge that every MAF agent runs.
COPY showcase/gateway/requirements.txt /tmp/gateway-requirements.txt
RUN pip install --no-cache-dir --pre -r /tmp/gateway-requirements.txt

# Each MAF agent runs <template>/app.py (the ResponsesHostServer runtime, which
# imports ../src) + backend/bridge_app.py (the AG-UI bridge). Copy app.py, src/
# and backend/ for every featured template.
COPY templates/agentic-copilot-foundry/app.py    ./templates/agentic-copilot-foundry/app.py
COPY templates/agentic-copilot-foundry/src/      ./templates/agentic-copilot-foundry/src/
COPY templates/agentic-copilot-foundry/backend/  ./templates/agentic-copilot-foundry/backend/
COPY templates/conversational-banking/app.py     ./templates/conversational-banking/app.py
COPY templates/conversational-banking/src/       ./templates/conversational-banking/src/
COPY templates/conversational-banking/backend/   ./templates/conversational-banking/backend/
COPY templates/health-claim-intake/app.py        ./templates/health-claim-intake/app.py
COPY templates/health-claim-intake/src/          ./templates/health-claim-intake/src/
COPY templates/health-claim-intake/backend/      ./templates/health-claim-intake/backend/

# Gateway + registry. Registry entries whose runtime is NOT in this image
# (e.g. the Node-based copilot-pr-assistant under showcase/agents/) are skipped
# by launcher.py at start and not advertised at /agents — to feature one, add
# its runtime + built output here.
COPY showcase/agents.json   ./showcase/agents.json
COPY showcase/gateway/      ./showcase/gateway/

RUN useradd --uid 1001 --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
CMD ["python", "showcase/gateway/launcher.py"]
