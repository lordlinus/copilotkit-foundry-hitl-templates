#!/usr/bin/env bash
# Canonical list of Azure regions where Microsoft Foundry Agent Service HOSTED
# agents are available (what `hosted/azure.yaml`'s `microsoft.foundry` provider
# provisions). This is a STRICT SUBSET of where Foundry itself or Azure OpenAI
# models are available — deploying to a region outside this list fails deep in
# the ARM/agent-creation step, minutes into `azd up`, with a confusing error.
# Source: https://learn.microsoft.com/azure/foundry/agents/concepts/hosted-agents#region-availability
# This list grows over time — if `make up` rejects a region Microsoft Learn now
# lists as supported, update this array (all 3 templates + this canonical copy).
# Last checked: 2026-07-16.
FOUNDRY_HOSTED_AGENT_REGIONS=(
  eastus2 northcentralus swedencentral canadacentral canadaeast southeastasia
  polandcentral southafricanorth koreacentral southindia brazilsouth westus
  westus3 norwayeast japaneast francecentral germanywestcentral switzerlandnorth
  spaincentral australiaeast
)

foundry_region_is_supported() {
  local loc="${1,,}" r  # lowercase, tolerate "East US 2" / "eastus2" / "EastUS2"
  loc="${loc// /}"
  for r in "${FOUNDRY_HOSTED_AGENT_REGIONS[@]}"; do
    [ "$r" = "$loc" ] && return 0
  done
  return 1
}

foundry_region_list() {
  printf '%s\n' "${FOUNDRY_HOSTED_AGENT_REGIONS[@]}" | paste -sd' ' -
}
