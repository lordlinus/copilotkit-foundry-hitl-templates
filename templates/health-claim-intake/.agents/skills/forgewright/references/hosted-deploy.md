# Hosted deploy — publish the agent as a Foundry hosted agent (azd)

The same `build_agent()` that the local AG-UI backend serves is also published as
an **Azure AI Foundry hosted agent** over the Responses protocol. This runs from
`hosted/` and needs an Azure subscription + a Foundry-enabled tenant.

## Prerequisites

- `az login` into the **tenant that owns the Foundry project** (a 403 on
  `Microsoft.MachineLearningServices/workspaces/agents/action` means the wrong
  tenant).
- The azd `azure.ai.agents` extension:
  `azd extension install azure.ai.agents` (the template pins `>=0.1.0-preview`).
- An `azd` environment with a region/model selected.

## Deploy

```bash
cd hosted
azd env new <env-name>            # first time
azd env set AZURE_LOCATION <region>
# (model deployment name comes from hosted/azure.yaml `deployments` + agent.yaml)
make up        # == azd up : provision + remote-build the image + publish the agent
```

`make up` builds the image with **remote build** (so no local Docker needed) from
the template root context (so the shared `src/agent.py` is included), provisions
the model deployment declared in `hosted/azure.yaml`, and publishes the hosted
agent described by `agent.yaml` / `agent.manifest.yaml`.

## Gotchas (also in troubleshooting.md)

- **Docker Hub rate limit** on build → the Dockerfiles use `mcr.microsoft.com`
  base images. Keep it that way.
- **helloworld placeholder deployed** → you ran `azd provision` only; run
  `make up` (provision + deploy).
- **401 "audience is incorrect"** at runtime → the agent must request the
  `https://ai.azure.com/.default` audience (the template's `build_chat_client`
  already does).

## Prove the hosted agent (live)

Deployment SUCCESS is not proof. Run the agent (e.g. via the VS Code Foundry
toolkit `azd ai agent run`, or the Foundry portal playground) and confirm that
**one consequential action pauses for human approval** before executing — the
same HITL contract you verified locally with `make smoke`.

## Connecting a frontend to the hosted agent

For local UI against the hosted agent, point the AG-UI backend's model at the
deployed project (`FOUNDRY_PROJECT_ENDPOINT` + `AZURE_AI_MODEL_DEPLOYMENT_NAME`)
and run `make local`. The CopilotKit bridge is unchanged.
