# Troubleshooting — known traps → symptom → fix

Each row is a real failure mode encoded as a check in `scripts/verify.sh` or
`scripts/smoke.py`. Fix the cause; do not work around it.

## HITL / approval

| Symptom | Cause | Fix |
| --- | --- | --- |
| Approve a tool → `RUN_ERROR` 400 **"No tool output found for function call"** | Using the Responses-API `OpenAIChatClient` | Use `OpenAIChatCompletionClient` (Chat Completions). `verify.sh` fails if it sees `OpenAIChatClient`. |
| Approval card never appears | `confirm_changes` action not registered, or not `available:"disabled"` with `renderAndWaitForResponse` | Keep the `confirm_changes` `useCopilotAction` from the template verbatim. |
| Clicking Approve does nothing / tool never runs | Resolving with `{ approved }` | Resolve with `{ accepted: boolean, steps }`. Backend detection is `"accepted" in parsed`. |
| Approve works once, next message 400s with orphaned `call_…` | Stale `{accepted:…}` payload re-sent; executed result never journaled | Patch 2c (journal result + scrub payload) + Patch 3 (orphan repair). Both ship in `ag_ui_app.py`. |
| Consequential tool runs WITHOUT asking | Tool missing `approval_mode="always_require"` | Decorate the consequential tool. `verify.sh` requires at least one. |

## AG-UI rendering

| Symptom | Cause | Fix |
| --- | --- | --- |
| Only the first generative card shows when a turn made several tool calls | CopilotKit renders only `message.toolCalls[0]` | Patch 2 splits multi-tool snapshot assistant messages; `smoke.py` C9 asserts no assistant snapshot msg has >1 toolCalls. |
| Approval card appears late (only after run ends) | live `confirm_changes` shares the parent message id | Patch 2b assigns a fresh `parent_message_id` to the live `confirm_changes` start event. |
| `INCOMPLETE_STREAM` "No active text message found" | someone also overwrote `flow.message_id` | Don't. Patch 2b only rewrites the event's `parent_message_id`. |
| Replayed history 400s on an interrupted prior turn | assistant function_call with no result | Patch 1+3 (`normalize_agui_input_messages`) inject a synthetic result, skipping calls pending approval. `smoke.py` C10 asserts this. |
| Server tool surfaces as a client/declaration-only call and never executes (mock) | mock client is a plain `BaseChatClient` | Mock must subclass `FunctionInvocationLayer, BaseChatClient` (the Agent skips tool execution otherwise). |

## CopilotKit bridge

| Symptom | Cause | Fix |
| --- | --- | --- |
| `GET /api/copilotkit/threads` 404 | missing catch-all dir | route lives in `app/api/copilotkit/[[...slug]]/route.ts`. |
| Threads 405 on every request | single-route endpoint | use `createCopilotHonoHandler` (multi-route) and re-export POST/GET/PATCH/DELETE. |
| Threads panel 422 "Missing CopilotKitIntelligence configuration" | lib `CopilotRuntime` wraps the runner in `TelemetryAgentRunner` | use the v2 `CopilotSseRuntime` with a raw `InMemoryAgentRunner`. |
| "Agent `<name>` not found" / Info 404 | `useSingleEndpoint` defaulted to `true` | set `<CopilotKit useSingleEndpoint={false}>`. |
| `<CopilotKit agent>` doesn't match | name drift | keep `AGENT_NAME` == route const == provider == hosted yaml. `verify.sh` checks it. |
| `next build` type error: `HttpAgent` missing `pendingInterrupts` | `@ag-ui/client` older than the version CopilotKit resolves | pin `@ag-ui/client` to the version `@copilotkit/runtime` depends on (e.g. `0.0.56`). |

## Foundry connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 "audience is incorrect" | default `cognitiveservices.azure.com` scope on the project path | request the `https://ai.azure.com/.default` audience. |
| 403 `workspaces/agents/action` | `az` logged into the wrong tenant for the project | `az login --tenant <foundry-tenant>` (or set the project's tenant). |
| Can't run without Azure | testing offline | `LLM_MODE=mock` (what `make smoke` uses). |

## Containers / azd

| Symptom | Cause | Fix |
| --- | --- | --- |
| `az acr build` fails `toomanyrequests` | Docker Hub base image | use `mcr.microsoft.com/devcontainers/...` base images. |
| azd deploys the helloworld placeholder | ran `azd provision` only | run `make up` (= `azd up` = provision + deploy). |
| hosted image missing `src/agent.py` | build context too narrow | `hosted/azure.yaml` sets `context: ..` (template root). |
