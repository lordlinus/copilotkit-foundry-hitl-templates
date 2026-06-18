#!/usr/bin/env bash
# Deploy the CopilotKit runtime (Next.js frontend) to Azure Container Apps.
# The Spark UI will call https://<this-app>/api/copilotkit.
set -euo pipefail

RG="${AZURE_RESOURCE_GROUP:-rg-forgewright-showcase}"
SUB="${AZURE_SUBSCRIPTION_ID:-75f2a33a-540e-4d0f-bd91-5681b79baa70}"
LOCATION="${AZURE_LOCATION:-southeastasia}"
APP_NAME="${RUNTIME_APP_NAME:-ca-copilotkit-runtime}"
ENV_NAME="${CONTAINER_APPS_ENV:-cae-forgewright}"
REGISTRY="${ACR_NAME:-acrforgewrightshowcase}"

# The AG-UI backend URL this runtime bridges to. Point at the gateway agent endpoint.
AG_UI_BACKEND_URL="${AG_UI_BACKEND_URL:-https://ca-forgewright-showcase.graysky-9f334ef2.southeastasia.azurecontainerapps.io/agents/agentic-copilot-foundry}"

# Allow the Spark app origin to call /api/copilotkit cross-origin.
SPARK_ORIGIN="${SPARK_ORIGIN:-https://forgewright-chat--lordlinus.github.app}"

echo "──────────────────────────────────────────────────────────────"
echo "  Deploying CopilotKit runtime (Next.js frontend) to ACA"
echo "  Resource Group : $RG"
echo "  App Name       : $APP_NAME"
echo "  AG-UI Backend  : $AG_UI_BACKEND_URL"
echo "  CORS Origin    : $SPARK_ORIGIN"
echo "──────────────────────────────────────────────────────────────"

az account set --subscription "$SUB"

# Ensure RG and ACR exist
az group show --name "$RG" --query id -o tsv >/dev/null 2>&1 || \
  az group create --name "$RG" --location "$LOCATION"

# Build image in ACR (remoteBuild on linux/amd64)
IMAGE="$REGISTRY.azurecr.io/copilotkit-runtime:$(date +%s)"
cd "$(dirname "$0")/.."
az acr build --registry "$REGISTRY" --image "$IMAGE" \
  --platform linux/amd64 --file frontend/Dockerfile frontend/

# Deploy to Container Apps
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --environment "$ENV_NAME" \
  --image "$IMAGE" \
  --registry-server "$REGISTRY.azurecr.io" \
  --registry-identity system \
  --target-port 3000 \
  --ingress external \
  --cpu 0.5 --memory 1Gi \
  --min-replicas 1 --max-replicas 2 \
  --env-vars \
    "AG_UI_BACKEND_URL=$AG_UI_BACKEND_URL" \
    "COPILOT_ALLOWED_ORIGINS=$SPARK_ORIGIN,http://localhost:5173" \
  --query properties.configuration.ingress.fqdn -o tsv

echo "✓ Deployed. Set VITE_COPILOT_RUNTIME_URL in Spark to:"
echo "  https://$(az containerapp show -n "$APP_NAME" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)/api/copilotkit"
