targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Environment name used for resource naming (azd env).')
param environmentName string

@description('Azure region for new resources.')
param location string

@description('Resource group name.')
param resourceGroupName string = 'rg-copilotkit-foundry-showcase'

@description('Existing Foundry / Azure AI Services account resource ID (parent of the project endpoint). The gateway managed identity is granted model-inference roles on it.')
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

// Grant the Container App's managed identity model-inference access on the
// Foundry account so the agents can call Chat Completions keyless.
// "Cognitive Services OpenAI User" — data-plane access to OpenAI deployments.
var cogSvcOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
// "Azure AI User" — runtime access to AI projects (belt-and-braces).
var azureAiUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

module roleOpenAi 'role-assignment.bicep' = {
  scope: resourceGroup(foundryRgName)
  name: 'role-foundry-openai-user'
  params: {
    foundryAccountName: foundryAccountName
    principalId: workload.outputs.identityPrincipalId
    roleDefinitionId: cogSvcOpenAiUserRoleId
  }
}

module roleAiUser 'role-assignment.bicep' = {
  scope: resourceGroup(foundryRgName)
  name: 'role-foundry-ai-user'
  params: {
    foundryAccountName: foundryAccountName
    principalId: workload.outputs.identityPrincipalId
    roleDefinitionId: azureAiUserRoleId
  }
}

output SERVICE_GATEWAY_FQDN string = workload.outputs.containerAppFqdn
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = workload.outputs.acrLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = workload.outputs.acrName
