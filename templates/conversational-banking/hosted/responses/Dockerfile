# Use MCR base (NOT Docker Hub) — ACR Tasks hit Docker Hub anonymous pull limits.
FROM mcr.microsoft.com/devcontainers/python:3.12
WORKDIR /app
# Bring src/ (shared agent) + hosted/responses together.
COPY src/ ./src/
COPY hosted/responses/ ./hosted/responses/
WORKDIR /app/hosted/responses
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8088
CMD ["python", "main.py"]
