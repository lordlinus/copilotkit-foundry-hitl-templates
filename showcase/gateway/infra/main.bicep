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

// Grant the Container App's managed identity access to the deployed Foundry
// HOSTED agents. "Foundry Agent Consumer" (interact/action only) is NOT
// sufficient: hosted_client.py first resolves the latest agent version via
// GET /api/projects/{project}/agents/{name}, which needs the
// Microsoft.CognitiveServices/accounts/AIServices/agents/read data action —
// Agent Consumer returns 403 on that call. "Foundry User" is the narrowest
// built-in role covering both (dataActions: Microsoft.CognitiveServices/*),
// scoped here to the single Foundry account.
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

module roleFoundryUser 'role-assignment.bicep' = {
  scope: resourceGroup(foundryRgName)
  name: 'role-foundry-user'
  params: {
    foundryAccountName: foundryAccountName
    principalId: workload.outputs.identityPrincipalId
    roleDefinitionId: foundryUserRoleId
  }
}

output SERVICE_GATEWAY_FQDN string = workload.outputs.containerAppFqdn
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = workload.outputs.acrLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = workload.outputs.acrName
