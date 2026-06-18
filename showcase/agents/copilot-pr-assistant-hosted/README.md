# Copilot PR Assistant — Foundry **hosted** agent (GitHub Copilot SDK)

This is the **hosted** counterpart of the gateway agent in
[`../copilot-pr-assistant/`](../copilot-pr-assistant/). Same idea — a GitHub
Copilot SDK agent that reviews code changes and drafts a pull request — but here it
runs as a real **Azure AI Foundry hosted agent** speaking the **Responses**
protocol, instead of being self-hosted behind the showcase gateway.

It proves a non-trivial point: **a non-Agent-Framework agent (the GitHub Copilot
SDK) is hostable on Foundry** by implementing the duck-typed `SupportsAgentRun`
contract that `ResponsesHostServer` expects.

## How it works

```
Foundry Responses protocol  ──►  ResponsesHostServer(CopilotSDKAgent())
  POST /responses (stream|once)        │
                                       ▼
                          CopilotSDKAgent  (src/agent.py)
                          • id/name/description + run()/create_session()/get_session()
                          • run(stream=False) → AgentResponse(messages=[…])
                          • run(stream=True)  → yields AgentResponseUpdate(…)
                                       │
                                       ▼
                          copilot.CopilotClient (bundled CLI, in-process)
                          • mode="empty" + available_tools=ToolSet().add_custom("*")
                          • custom tools via define_tool(name=…, handler=(args, inv), …)
                          • provider → APIM / Copilot BYOM gateway (src/provider.py)
```

- **`src/agent.py`** — `CopilotSDKAgent`. Maps the Responses `messages` to the
  latest user turn, forwards it to a per-Foundry-session Copilot session, and
  bridges Copilot `AssistantMessageDeltaData` events to `AgentResponseUpdate`
  streaming deltas (and `AssistantMessageData` to the final `AgentResponse`).
- **`src/provider.py`** — model provider. The Copilot SDK can't send
  `Ocp-Apim-Subscription-Key`, so an in-process auth adapter fronts APIM
  host-only and injects the key. `wire_api="completions"` (Chat Completions).
- **`src/main.py`** — `ResponsesHostServer(CopilotSDKAgent()).run()` on `:8088`.

## HITL: hosted vs gateway — important

A Foundry **hosted** agent speaks the **Responses** protocol, **not AG-UI**. The
human-in-the-loop approval card (the `confirm_changes` flow) is an **AG-UI–layer**
feature driven by the browser. So:

| Variant | Protocol | HITL |
| --- | --- | --- |
| **Gateway** (`../copilot-pr-assistant/`) | AG-UI (SSE) | ✅ real Approve/Reject card before `propose_pull_request` opens the PR |
| **Hosted** (this dir) | Responses | tools run with `approve_all` (no interactive pause) |

If you need interactive approval, use the gateway variant. This hosted variant is
the right choice when the agent runs unattended inside Foundry and a human gate
isn't part of the request path.

## Run locally

```bash
# venv (uv — python -m venv is broken on some machines)
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python --prerelease=allow -r requirements.txt

# APIM / BYOM (only gpt-5 / o-series work with the Copilot SDK)
export APIM_GATEWAY="https://<your-apim>.azure-api.net"
export APIM_PATH_PREFIX="<your-openai-api-path>"
export APIM_KEY="<apim-subscription-key>"     # secret — never commit
export MODEL_NAME="gpt-5.4-mini"
export PORT=8088

PYTHONPATH=src .venv/bin/python src/main.py
```

Smoke it:

```bash
curl -s -X POST http://localhost:8088/responses -H 'Content-Type: application/json' \
  -d '{"model":"copilot-pr-assistant","stream":false,"input":[{"role":"user",
       "content":[{"type":"input_text","text":"List the changed files, get each diff, then draft a PR title and body."}]}]}'
```

Add `"stream":true` for token-by-token Responses SSE (`response.output_text.delta`).

## Deploy to Foundry (`azd` — direct code deploy, no Docker/ACR) ✅ verified

`agent.yaml` carries `code_configuration:` (runtime `python_3_13`, entry point
`app.py`, `remote_build`), so `azd deploy` zips the source and lets Foundry
remote-build the runtime — **no Docker, no ACR**. The `github-copilot-sdk` wheel is
`py3-none-<platform>`, so it resolves on the remote 3.13 runtime; the ~160 MB
Copilot CLI binary comes from that wheel.

Deploy **into an existing Foundry project** (no `azd provision`, no infra/):

```bash
az login                                       # to the Foundry tenant (the project owner)
azd config set auth.useAzCliAuth true          # make azd reuse the az CLI identity
azd env new <env-name>
azd env set AZURE_SUBSCRIPTION_ID  <sub-guid>
azd env set AZURE_LOCATION         <region>
azd env set AZURE_TENANT_ID        <tenant-guid>
azd env set AZURE_AI_PROJECT_ENDPOINT  https://<acct>.services.ai.azure.com/api/projects/<project>
azd env set AZURE_AI_PROJECT_ID    /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<acct>/projects/<project>
azd env set FOUNDRY_PROJECT_ENDPOINT  https://<acct>.services.ai.azure.com/api/projects/<project>
# agent runtime config (APIM_KEY is a secret — prefer Key Vault for production):
azd env set APIM_GATEWAY      https://<your-apim>.azure-api.net
azd env set APIM_PATH_PREFIX  <your-openai-api-path>
azd env set APIM_KEY          <apim-subscription-key>
azd env set MODEL_NAME        gpt-5.4-mini

azd deploy --no-prompt                         # direct code deploy → new immutable version
azd ai agent show  copilot-pr-assistant-hosted --output json   # expect "status":"active"
azd ai agent invoke copilot-pr-assistant-hosted "List the changed files and draft a PR title." --no-prompt
```

The `environment_variables` in `agent.yaml` resolve from the azd env at deploy
time and are injected into the hosted container. The Dockerfile remains a
**container fallback** (`azd deploy` uses it only if you remove `code_configuration`).

## Gotchas (verified)

- **Copilot SDK bundles a ~160 MB CLI binary** in the wheel. The wheel is
  `py3-none-<platform>`, so **direct code deploy** (`remote_build`) resolves it on
  Foundry's linux/amd64 runtime automatically; for **container** deploy, build for
  the runtime arch (ACR `remoteBuild` builds linux/amd64). No Node needed either way.
- **Only gpt-5 / o-series models** work — the Copilot SDK encrypts prompts;
  gpt-4.x returns *"Encrypted content not supported"*.
- **`wire_api` must be `"completions"`**, not `"responses"`.
- **Python `define_tool` ≠ Node**: `define_tool(name=…, description=…,
  handler=(args, invocation), params_type=PydanticModel, skip_permission=True)`.
- **`mode="empty"`** requires BOTH `base_directory` (COPILOT_HOME) AND
  `available_tools` (`ToolSet().add_custom("*")`).
- Event API: `session.on(handler)` takes ONE handler for ALL events — filter on
  `isinstance(event.data, AssistantMessageData | AssistantMessageDeltaData | …)`.
