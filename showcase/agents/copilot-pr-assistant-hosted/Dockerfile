# Use MCR base (NOT Docker Hub) — ACR Tasks hit Docker Hub anonymous pull limits.
# `pip install github-copilot-sdk` pulls a ~160 MB platform-specific Copilot CLI
# binary bundled in the wheel, so the image MUST be built for the runtime arch
# (ACR `remoteBuild: true` builds linux/amd64 — the wheel resolves to amd64).
FROM mcr.microsoft.com/devcontainers/python:3.12

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/

# The Copilot CLI server needs a writable COPILOT_HOME.
ENV COPILOT_HOME=/tmp/.copilot-home
WORKDIR /app/src
EXPOSE 8088
CMD ["python", "main.py"]
