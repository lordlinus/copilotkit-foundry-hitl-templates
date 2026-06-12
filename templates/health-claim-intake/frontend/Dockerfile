# Next.js frontend. MCR base (NOT Docker Hub) — ACR Tasks hit Docker Hub limits.
FROM mcr.microsoft.com/devcontainers/typescript-node:20 AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/devcontainers/typescript-node:20
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
