# Copilot PR Assistant — AG-UI backend on the GitHub Copilot SDK (Node/TS).
# MCR base (NOT Docker Hub) to avoid ACR Tasks rate limits. The SDK bundles the
# Copilot CLI runtime; no separate install needed.
FROM mcr.microsoft.com/devcontainers/typescript-node:20

ENV NODE_ENV=production PORT=8104
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# A writable COPILOT_HOME for per-session state (mode:"empty" requires it).
ENV COPILOT_HOME=/app/.copilot-home
RUN mkdir -p /app/.copilot-home && chown -R node:node /app
USER node

EXPOSE 8104
CMD ["node", "dist/index.js"]
