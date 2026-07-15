# Deploying the showcase gateway

The showcase gateway (`showcase/gateway/`) is one always-on Container App that
hosts every gallery agent's thin AG-UI<->Responses **bridge**, fronted by GitHub
Pages (`showcase/ui/`). It deploys via `azd` and GitHub Actions
(`.github/workflows/showcase-deploy.yml`), authenticating with **keyless GitHub
OIDC federated credentials** — no stored client secret.

**The gateway does NOT run any agent logic itself.** Every featured agent must
first be deployed as a REAL Foundry **hosted agent** — that's where tools, HITL,
history, tracing, evaluations, and Optimize actually live:

```bash
# one per MAF template, into the SAME Foundry project as the gateway
cd templates/agentic-copilot-foundry/hosted && azd up
cd templates/conversational-banking/hosted   && azd up
cd templates/health-claim-intake/hosted      && azd up
# the GitHub Copilot SDK agent, deployed the same way
cd showcase/agents/copilot-pr-assistant-hosted && azd up
```

Each `hosted/` (or `copilot-pr-assistant-hosted/`) azd environment needs
`AZURE_AI_PROJECT_ID` / `FOUNDRY_PROJECT_ENDPOINT` pointed at that SAME project
so all agents land together, not scattered across separate auto-created
projects. Only once an agent shows up under Foundry **Build → Agents** as
`type: hosted` is it ready for the gateway to bridge to.

## One-time setup

**Easiest — let `azd` do it for you:**

```bash
cd showcase/gateway
azd pipeline config --provider github
```

This creates the Entra app registration, adds a federated credential scoped to
this repository, and writes the required GitHub Actions secrets for you.

**Manual, if you'd rather not grant `azd` access to configure the pipeline:**

1. Create an Entra app registration (or reuse one) and add a federated
   credential for `repo:<owner>/<repo>:ref:refs/heads/main` (or the branch you
   deploy from).
2. Grant that app's service principal **Contributor** + **User Access
   Administrator** on the target subscription *and* on the resource group that
   owns the Foundry account (the role assignment in `infra/main.bicep` needs to
   create a role assignment scoped to that resource group).
3. Set the repository **secrets**: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`.
4. Set the repository **variables**: `AZURE_ENV_NAME`, `AZURE_LOCATION`,
   `FOUNDRY_ACCOUNT_RESOURCE_ID`, `FOUNDRY_PROJECT_ENDPOINT`,
   `AZURE_AI_MODEL_DEPLOYMENT_NAME`, `ALLOWED_ORIGINS`. `FOUNDRY_ACCOUNT_RESOURCE_ID`
   and `FOUNDRY_PROJECT_ENDPOINT` must point at the SAME project the hosted
   agents above were deployed into — the gateway's managed identity is granted
   `Cognitive Services OpenAI User` + `Azure AI User` (now shown as `Foundry
   User`) on that account so it can call the deployed agents' endpoints keylessly.

Until `FOUNDRY_PROJECT_ENDPOINT` (a repo *variable*) is set, the `deploy` job in
`showcase-deploy.yml` skips itself (`if: vars.FOUNDRY_PROJECT_ENDPOINT != ''`) —
that is expected on a fork or a repo that hasn't been configured yet, not a
failure.

## Ongoing deploys

Pushing to `main` under `showcase/gateway/**`, `showcase/agents.json`, or any
featured template's `src/`/`backend/` re-runs the workflow automatically. You
can also trigger it manually (`workflow_dispatch`) or run it yourself:

```bash
cd showcase/gateway
azd auth login --client-id "$AZURE_CLIENT_ID" \
  --federated-credential-provider github --tenant-id "$AZURE_TENANT_ID"
azd provision --no-prompt
azd deploy --no-prompt
```

After a successful deploy, set the GitHub repo variable `API_BASE` to the
printed gateway URL and re-run the **Deploy showcase to Pages** workflow so the
UI points at the new gateway.

