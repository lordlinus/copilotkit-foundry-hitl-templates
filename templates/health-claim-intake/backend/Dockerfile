# AG-UI backend (FastAPI + SSE). Serves the agent_framework_ag_ui endpoint at /
# with the four resilience patches baked into ag_ui_app.py.
#
# MCR base image (NOT Docker Hub) — `az acr build` / ACR Tasks hit Docker Hub's
# anonymous pull rate limit ("toomanyrequests") constantly.
FROM mcr.microsoft.com/devcontainers/python:3.12

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PORT=8080

WORKDIR /app

# Install deps separately so source edits don't bust the dependency cache.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# src/ is imported by the backend (sys.path insert in ag_ui_app.py).
COPY src/ ./src/
COPY backend/ ./

RUN useradd --uid 1001 --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
CMD ["uvicorn", "ag_ui_app:app", "--host", "0.0.0.0", "--port", "8080"]
