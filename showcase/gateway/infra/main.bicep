targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Environment name used for resource naming (azd env).')
param environmentName string

@description('Azure region for new resources.')
param location string

@description('Resource group name.')
param resourceGroupName string = 'rg-copilotkit-foundry-showcase'

@description('Existing Foundry / Azure AI Services account resource ID (the project the deployed hosted agents live in). The gateway managed identity is granted the Foundry Agent Consumer role on it to call those agents.')
param foundryAccountResourceId string

@description('Foundry project endpoint, e.g. https://<account>.services.ai.azure.com/api/projects/<project>')
param foundryProjectEndpoint string

@description('Model deployment name the agents call (e.g. gpt-4.1).')
param modelDeploymentName string

@description('Comma-separated browser origins allowed to call the gateway (your GitHub Pages URL + localhost).')
param allowedOrigins string

var tags = {
  'azd-env-name': environmentName
  project: 'copilotkit-foundry-showcase'
}

var foundryRgName = split(foundryAccountResourceId, '/')[4]
var foundryAccountName = split(foundryAccountResourceId, '/')[8]

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module workload 'workload.bicep' = {
  scope: rg
  name: 'workload'
  params: {
    location: location
    environmentName: environmentName
    tags: tags
    foundryProjectEndpoint: foundryProjectEndpoint
    modelDeploymentName: modelDeploymentName
    allowedOrigins: allowedOrigins
  }
}

// Grant the Container App's managed identity access to call the deployed
// Foundry HOSTED agents' Responses endpoints (the gateway forwards every turn
// to them; it makes no direct model-inference calls). "Foundry Agent Consumer"
// is the least-privilege role for this — the same role each template's own
// `deploy/` bicep grants its bridge identity (see
// templates/agentic-copilot-foundry/deploy/infra/main.bicep).
var foundryAgentConsumerRoleId = 'eed3b665-ab3a-47b6-8f48-c9382fb1dad6'

module roleAgentConsumer 'role-assignment.bicep' = {
  scope: resourceGroup(foundryRgName)
  name: 'role-foundry-agent-consumer'
  params: {
    foundryAccountName: foundryAccountName
    principalId: workload.outputs.identityPrincipalId
    roleDefinitionId: foundryAgentConsumerRoleId
  }
}

output SERVICE_GATEWAY_FQDN string = workload.outputs.containerAppFqdn
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = workload.outputs.acrLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = workload.outputs.acrName
