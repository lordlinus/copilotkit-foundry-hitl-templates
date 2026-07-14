targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Environment name used for resource naming (azd env).')
param environmentName string

@description('Azure region for new resources.')
param location string

@description('Resource group name.')
param resourceGroupName string = 'rg-${environmentName}-app'

@description('Existing Foundry / Azure AI Services account resource ID (parent of the project the hosted agent was deployed into). The bridge managed identity is granted agent-interaction access on it.')
param foundryAccountResourceId string

@description('Foundry project endpoint the hosted agent was deployed into, e.g. https://<account>.services.ai.azure.com/api/projects/<project>. Passed to the bridge as FOUNDRY_PROJECT_ENDPOINT.')
param foundryProjectEndpoint string

@description('Name of the deployed Foundry hosted agent (see hosted/agent.yaml `name:` / `make up` output). Passed to the bridge as HOSTED_AGENT_NAME.')
param hostedAgentName string

var tags = {
  'azd-env-name': environmentName
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
    hostedAgentName: hostedAgentName
  }
}

// Grant the bridge's managed identity the least-privilege role for interacting
// with agent endpoints (NOT "Azure AI User"/"Cognitive Services OpenAI User" —
// those are for direct model inference, a different data-plane permission; see
// https://learn.microsoft.com/azure/foundry/agents/concepts/hosted-agent-permissions).
// Scoped to the whole Foundry ACCOUNT for simplicity; scope to the project or
// the specific agent instead for tighter least-privilege in production.
var foundryAgentConsumerRoleId = 'eed3b665-ab3a-47b6-8f48-c9382fb1dad6'

module roleAgentConsumer 'role-assignment.bicep' = {
  scope: resourceGroup(foundryRgName)
  name: 'role-foundry-agent-consumer'
  params: {
    foundryAccountName: foundryAccountName
    principalId: workload.outputs.bridgeIdentityPrincipalId
    roleDefinitionId: foundryAgentConsumerRoleId
  }
}

output SERVICE_BRIDGE_FQDN string = workload.outputs.bridgeFqdn
output SERVICE_FRONTEND_FQDN string = workload.outputs.frontendFqdn
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = workload.outputs.acrLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = workload.outputs.acrName
