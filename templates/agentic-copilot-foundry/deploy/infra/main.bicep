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

@description('Name of the deployed Foundry hosted agent (see the inline `name:` in hosted/azure.yaml / `make up` output). Passed to the bridge as HOSTED_AGENT_NAME.')
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

// Grant the bridge's managed identity access to the hosted agents. "Foundry
// Agent Consumer" (interact/action only) is NOT sufficient: hosted_client.py
// resolves the latest agent version via GET /api/projects/{project}/agents/{name},
// which needs the Microsoft.CognitiveServices/accounts/AIServices/agents/read
// data action — Agent Consumer returns 403 on that call. "Foundry User" is the
// narrowest built-in role covering both (dataActions: Microsoft.CognitiveServices/*).
// Scoped to the whole Foundry ACCOUNT for simplicity; scope to the project or
// the specific agent instead for tighter least-privilege in production.
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

module roleFoundryUser 'role-assignment.bicep' = {
  scope: resourceGroup(foundryRgName)
  name: 'role-foundry-user'
  params: {
    foundryAccountName: foundryAccountName
    principalId: workload.outputs.bridgeIdentityPrincipalId
    roleDefinitionId: foundryUserRoleId
  }
}

output SERVICE_BRIDGE_FQDN string = workload.outputs.bridgeFqdn
output SERVICE_FRONTEND_FQDN string = workload.outputs.frontendFqdn
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = workload.outputs.acrLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = workload.outputs.acrName
