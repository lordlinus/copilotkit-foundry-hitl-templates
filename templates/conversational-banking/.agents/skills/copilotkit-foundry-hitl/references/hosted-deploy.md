# Hosted deploy — publish the agent as a Foundry hosted agent (azd)

The `build_hosted_agent()` that backs the deployed brain (FoundryChatClient,
Responses) is published as an **Azure AI Foundry hosted agent**. This runs from
`hosted/` and needs an Azure subscription + a Foundry-enabled tenant. The SAME
`build_hosted_agent()` runs locally for development via `azd ai agent run`.

## Prerequisites

- `az login` into the **tenant that owns the Foundry project** (a 403 on
  `Microsoft.MachineLearningServices/workspaces/agents/action` means the wrong
  tenant).
- The azd `azure.ai.agents` extension:
  `azd extension install azure.ai.agents` (the template pins `>=0.1.0-preview`).
- An `azd` environment with a region/model selected.

> **Note for anyone starting a brand-new template from scratch** (not
> customizing this one): `azd ai agent sample list` / `azd ai agent init -m
> <manifest-url>` can scaffold a fresh `hosted/`-style project (`main.py`,
> `agent.yaml`, `azure.yaml`, `Dockerfile`, `infra/`) for whatever `azd`
> Foundry extension version you have installed. This template's `hosted/`
> predates that tool and has since been hand-tuned for the dual root+`hosted/`
> project layout below — don't regenerate it wholesale over an existing,
> working template; only use the generator as a starting point for something
> genuinely new.

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
  `https://ai.azure.com/.default` audience (the template's `build_hosted_agent`
  already does).

## Prove the hosted agent (live)

Deployment SUCCESS is not proof. Run the agent (e.g. via the VS Code Foundry
toolkit `azd ai agent run`, or the Foundry portal playground) and confirm that
**one consequential action pauses for human approval** before executing — the
same HITL contract you verified locally with `make smoke`.

## Connecting a frontend to the hosted agent (the light bridge)

In production the chat UI does NOT run the agent — it talks to the deployed Foundry
hosted agent through the **light bridge** (`backend/bridge_app.py`). Deploy the
bridge + the Next.js frontend as **two Container Apps** with the bundled `deploy/`
azd project (Bicep, not hand-run `az containerapp` commands):

```bash
cd deploy
azd env new <env-name>-app            # a separate azd env from hosted/'s
azd env set AZURE_LOCATION <region>
azd env set FOUNDRY_ACCOUNT_RESOURCE_ID <the Foundry account resource ID>
azd env set FOUNDRY_PROJECT_ENDPOINT <the project endpoint from `make up`>
azd env set HOSTED_AGENT_NAME <the deployed agent name — same as hosted/agent.yaml `name:`>
make up-app       # == azd up : provisions ACR + Container Apps env + both apps
```

What `make up-app` provisions (`deploy/infra/`):
- **bridge** Container App — `backend/Dockerfile`, **internal-only ingress** (never
  exposed to the internet), a user-assigned managed identity granted the
  **`Foundry Agent Consumer`** role (role ID `eed3b665-ab3a-47b6-8f48-c9382fb1dad6`
  — the least-privilege role for *interacting* with agent endpoints; NOT the
  "Azure AI User"/"Cognitive Services OpenAI User" roles, which are for direct
  model inference and won't authorize hosted-agent calls) on the Foundry account.
  `FOUNDRY_PROJECT_ENDPOINT` + `HOSTED_AGENT_NAME` + `AZURE_CLIENT_ID` (the
  identity) are injected as env vars — matching `backend/.env.example`'s "drive a
  DEPLOYED hosted agent" contract, keyless.
- **frontend** Container App — `frontend/Dockerfile`, externally exposed, with
  `AG_UI_BACKEND_URL` set to the bridge's *internal* FQDN (reachable only inside
  the same Container Apps environment — the browser never talks to the bridge
  directly, only to the frontend, matching `frontend/.env.example`).

Run a single replica of the bridge (already pinned in the Bicep: `minReplicas:
maxReplicas: 1`) — its per-thread conversation/session cache is in-memory; scaling
it out or to zero would split or drop that state.

For the local dev loop, `make local` runs the SAME agent locally via
`azd ai agent run` and points the bridge (`bridge_app:app`) at it — no mock.

