# Troubleshooting — known traps → symptom → fix

Each row is a real failure mode encoded as a check in `scripts/verify.sh` or
`scripts/smoke.py`. Fix the cause; do not work around it.

**Upstream status last checked: 2026-07-14**, against `agent-framework-core`
1.11.0, `agent-framework-foundry` 1.10.1, `agent-framework-ag-ui` 1.0.0rc8,
`agent-framework-foundry-hosting` 1.0.0a260709 (protocol v2.0 — see
`architecture.md`). All three tracked issues below (#6652, #6828, #6851) are still
**OPEN**; the fix PR for #6828 ([#6829](https://github.com/microsoft/agent-framework/pull/6829))
was closed **without merging**. Keep every patch/mitigation below until that changes.

## HITL / approval

| Symptom | Cause | Fix |
| --- | --- | --- |
| Approve a tool → `RUN_ERROR` 400/500 **"No tool output found for function call"** | the hosted agent uses Chat Completions (`OpenAIChatClient`/`OpenAIChatCompletionClient`) instead of Responses | `build_hosted_agent` MUST use `FoundryChatClient` (Responses) so the hosted `mcp_approval_response` re-executes the tool. `verify.sh` checks for `FoundryChatClient`. |
| Approval card never appears | `confirm_changes` not registered via the v2 `useHumanInTheLoop` hook | Keep the `confirm_changes` `useHumanInTheLoop({ name: "confirm_changes", ... })` from the template verbatim. |
| Clicking Approve does nothing / tool never runs | Resolving with `{ approved }` | Resolve with `{ accepted: boolean, steps }`. Backend detection is `"accepted" in parsed`. |
| Approve works once, next message 400s with orphaned `call_…` | (pre-rc5) stale approval payload re-sent | Handled NATIVELY on agent-framework-ag-ui rc5 — do not re-add the old hand-rolled patches. |
| Consequential tool runs WITHOUT asking | Tool missing `approval_mode="always_require"` | Decorate the consequential tool. `verify.sh` requires at least one. |
| ⚠️ **Upstream bug, MITIGATED in the bridge (DIRECT/local-dev mode only):** after one approve, a LATER unrelated turn in the SAME conversation (e.g. a plain follow-up question) could silently re-execute the SAME already-resolved gated tool again — its side effect applying more than once even though the user only clicked Approve once | Isolated by reproducing with **raw curl straight to the hosted agent's bare `/responses` endpoint**, in a process with `agent_framework_ag_ui` **not even installed** — so the earlier attribution to `agent_framework_ag_ui/_agent_run.py`'s `_clean_resolved_approvals_from_snapshot` was wrong. The real trigger is chaining `previous_response_id` THROUGH a response that itself resolved an `mcp_approval_response`; the hosted runtime then re-executes that approved tool call again on the very next turn regardless of that turn's own content. Root cause lives somewhere in `agent_framework_foundry_hosting`/`agent_framework_foundry`/`agent_framework_core`'s Responses-conversation handling, not in `agent_framework_ag_ui`. | `hosted_client.py`'s `converse_stream()` now tracks whether the CURRENT turn's own input resolves an approval (`_is_approval_turn`); if so, it does NOT chain `previous_response_id` forward from that turn's response — the next turn starts stateless instead, trading a small bit of conversational memory for the safety guarantee that the gated tool never silently re-executes. **This only covers DIRECT (local-dev, `azd ai agent run`) mode** — PLATFORM/deployed mode builds its request differently (a separate Foundry `conversation` object, not `previous_response_id` chaining) and is unverified; treat multi-turn conversations after approval in a real deployed agent as unproven until tested live. `smoke.py`'s **C11** test guards the DIRECT-mode fix (same-thread follow-ups after approval must not change state again). **Tracked upstream:** [microsoft/agent-framework#6828](https://github.com/microsoft/agent-framework/issues/6828) and [microsoft/agent-framework#6851](https://github.com/microsoft/agent-framework/issues/6851) — both still **OPEN** as of 2026-07-06; #6828's own fix PR ([#6829](https://github.com/microsoft/agent-framework/pull/6829)) was closed without merging, so nothing has shipped against either issue through `agent-framework-ag-ui` 1.0.0rc7. Remove the `hosted_client.py` workaround once those are fixed upstream and `agent-framework-*` is upgraded past the fix; re-check on every upgrade — do not remove it just because a package version bumped. |

## AG-UI rendering

| Symptom | Cause | Fix |
| --- | --- | --- |
| HITL approve doesn't re-execute the tool server-side (state unchanged after approve) | ag-ui resolves `confirm_changes` **locally** before the proxy sees it | `bridge_app.py` neutralises `_is_confirm_changes_response` + `_resolve_approval_responses`, so the decision reaches `HostedProxyAgent`, which forwards `mcp_approval_response` to the hosted agent. **Proven load-bearing: disabling it → approve doesn't change state.** |
| Approval/tool card vanishes at RUN_FINISHED when a turn made several tool calls | ag-ui's snapshot builder lumps multiple tool_calls into one assistant message; CopilotKit **v1** renders only `toolCalls[0]` | `bridge_app.py` splits multi-tool snapshot messages (`_build_messages_snapshot`); `smoke.py` C9 guards it. **Proven load-bearing: `DISABLE_C9_SPLIT=1` fails C9.** (v2 renders all tool calls, but the split keeps the snapshot correct for both frontends.) |
| Replayed history 400s / orphaned tool call (C10) | raw AG-UI history replayed to the hosted agent | the proxy does **not** replay raw history — `_find_approval_decision` / `_latest_user_text` derive the turn input (latest user text, or an `mcp_approval_response`). `smoke.py` C10 asserts no error. No `normalize_*` patch needed. |

## CopilotKit bridge

> **CopilotKit's API moves fast, even between minor versions** — the exact
> route-handler function name, whether the client defaults to single-route or
> multi-route mode, and the provider component name (`CopilotKit` vs
> `CopilotKitProvider`) have all changed across releases seen in the wild.
> This template currently pins `^1.61.2` and the rows below are verified
> against that resolved version (see `frontend/package-lock.json`). Before
> upgrading, re-verify each of these against the new version's own bundled
> `.d.ts`/docs rather than assuming the shape below still holds.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `GET /api/copilotkit/threads` 404 | missing catch-all dir | route lives in `app/api/copilotkit/[[...slug]]/route.ts`. |
| Threads 405 on every request | single-route endpoint | use `createCopilotHonoHandler` (multi-route) and re-export POST/GET/PATCH/DELETE. |
| Threads panel 422 "Missing CopilotKitIntelligence configuration" | lib `CopilotRuntime` wraps the runner in `TelemetryAgentRunner` | use the v2 `CopilotSseRuntime` with a raw `InMemoryAgentRunner`. |
| "Agent `<name>` not found" / Info 404 | `useSingleEndpoint` defaulted to `true` | set `<CopilotKit useSingleEndpoint={false}>`. |
| `<CopilotKit agent>` doesn't match | name drift | keep `AGENT_NAME` == route const == provider == hosted yaml. `verify.sh` checks it. |
| `next build` type error: `HttpAgent` missing `pendingInterrupts` | `@ag-ui/client` older than the version CopilotKit resolves | pin `@ag-ui/client` to the version `@copilotkit/runtime` depends on (e.g. `0.0.56`). |
| Browser console: "Failed to execute 'fetch' on 'Window': Illegal invocation" (`agent_run_failed_event`); the agent never runs | CopilotKit v2 (`ɵcreateThreadStore` + `@ag-ui/client` HttpAgent) captures the global `fetch` as a bare reference and calls it with the wrong `this`; `CopilotKitCore` exposes no `fetch` option | bind the global fetch to `window` before any module loads — an inline `<head>` script in `app/layout.tsx`: `if(!window.fetch.__bound){var f=window.fetch.bind(window);f.__bound=true;window.fetch=f;}`. `verify.sh` checks it; proven in a real browser (control reproduces, fix → 0 errors). |
| `useHumanInTheLoop`'s `respond(...)` payload isn't recognized by the bridge | assumed CopilotKit enforces a specific resolve shape | it doesn't — `respond(result)` accepts any value. `{ accepted, steps }` is a convention this template defines; keep the frontend `respond(...)` call and `hosted_proxy.py`'s parser in sync if you ever change it. |

## Foundry connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 "audience is incorrect" | default `cognitiveservices.azure.com` scope on the project path | request the `https://ai.azure.com/.default` audience. |
| 403 `workspaces/agents/action` — e.g. `make smoke`/`make local` fail with `Identity (object id: ...) does not have permissions for Microsoft.MachineLearningServices/workspaces/agents/action actions`, even though you ARE logged in | `az`'s **active subscription/tenant** doesn't match the Foundry project's (multi-tenant accounts: `az login` can leave a different subscription selected as default). `az role assignment list --assignee ... --scope <foundry-account-id>` can even fail to resolve the assignee under the wrong tenant context, which looks like a missing-role problem but isn't. | `az account show` and compare its `tenantId`/`id` against `AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID` in the app's `.azure/<env>/.env`. If they differ: `az account set --subscription <the project's subscription id>` (or `az login --tenant <foundry-tenant>`), then retry — no code/package change needed. Confirmed live: this exact 403 on `agent-framework-foundry-hosting` 1.0.0a260630/protocol v2.0 was the active-subscription mismatch, not the v2.0 bump; switching subscriptions fixed it and `make smoke` went 15/15. Don't mistake this for a dependency-bump regression. |
| Run the agent locally for dev | no deployed agent yet | `azd ai agent run` runs the REAL agent on your machine (what `make local`/`make smoke` use, via the bridge's DIRECT mode); needs `az login` + a provisioned project (`make up` once). |

## Containers / azd

| Symptom | Cause | Fix |
| --- | --- | --- |
| `az acr build` fails `toomanyrequests` | Docker Hub base image | use `mcr.microsoft.com/devcontainers/...` base images. |
| azd deploys the helloworld placeholder | ran `azd provision` only | run `make up` (= `azd up` = provision + deploy). |
| hosted image missing `src/agent.py` | build context too narrow | `hosted/azure.yaml` sets `context: ..` (template root). |
| ⚠️ **`make up`/`make deploy` fail at the Packaging step:** `invalid service path for <name>: relative path ".." must not contain '..'` | A newer `azd` (confirmed on 1.27.0) / `azure.ai.agents` extension (confirmed on 1.0.0-beta.4, "up to date") rejects `services.<name>.project: ..` outright — the exact setting this template's `hosted/azure.yaml` uses so the build context can reach the shared `src/agent.py` one level up. This reproduces with **no changes to `azure.yaml` at all** — it is an azd-tooling regression/behavior change, unrelated to any `agent-framework-*`/CopilotKit package version. Confirmed: `azd ai agent run` (what `make smoke`/`make local` use) does **not** hit this — only the real `azd deploy`/`azd up` packaging path does. Tried `project: .` instead: packaging then fails differently (`agent definition file not found ... in hosted`) because the `agent.yaml` lookup follows `project`, not `docker.path`'s directory. | **Resolved 2026-07-15** — the template now uses `project: .` with the agent definition declared INLINE on the `azure.ai.agent` service entry in `hosted/azure.yaml` (the unified shape, azd `azure.ai.agents` >=1.0.0-beta; `agent.yaml`/`agent.manifest.yaml` are deprecated upstream and deleted here). With the inline definition there is no on-disk `agent.yaml` lookup to fail, `docker.context: ..` still reaches the shared `src/`, and the full `azd up`/`azd deploy` path is live-verified (deploy + active agent + live invoke). If you see `agent definition file not found` on an older app, it predates this migration — move the definition inline (see architecture.md "The 3 azd projects"). |

## Local dev-loop gotchas (found running `make smoke`/`make local` repeatedly)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `smoke.py` fails (or passes for the wrong reason) when run twice in a row, or after an interrupted earlier attempt | the example agent's in-memory data store is **process-lifetime** state — every approve/reject call from any script mutates the SAME shared data | restart `azd ai agent run` between independent verification passes to reset to the seeded starting state. Don't assume a fresh `make smoke` run starts clean if a prior run (or an interrupted session) already approved/rejected the same record ids. |
| A new `azd ai agent run` fails with `Address already in use` (often a confusing hypercorn traceback, not a clear "port in use" message) | a previous local hosted-agent process wasn't killed cleanly and still holds the port | find and stop the old process before starting a new one (e.g. `lsof -i :8088` / `ss -ltnp \| grep 8088`). |
| The very first request to a freshly-started local hosted agent 404s with `DeploymentNotFound`, even though `az cognitiveservices account deployment list` confirms the deployment exists and is reachable | occasional local-dev warm-up flake in the hosted runtime/SDK, not a real config problem | retry once, or restart the hosted-agent process with the same env vars — this has been observed to resolve itself immediately on retry. |
| Approval card renders but shows the wrong/missing field after you rename a gated tool's parameter | the frontend's HITL card component parses `function_arguments` and casts to a specific field name — this must match whatever parameter name the Python tool actually takes; the bridge itself just forwards the model's raw arguments JSON verbatim | when you rename a gated tool's parameter, update the corresponding field name in the frontend's parsed-args cast to match. Presentation-only, not a bridge change. |

## Bridge (the framework-native AG-UI endpoint)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Approval card vanishes at RUN_FINISHED | multi-tool snapshot; CopilotKit v1 renders only `toolCalls[0]` | keep the snapshot-split in `bridge_app.py`; `make smoke` C9 guards it. |
| HITL approve does nothing / state doesn't change | ag-ui resolved the approval locally (the routing patch was removed/disabled) | the hosted bridge needs **two** patches — HITL approval routing **and** the snapshot split — both proven load-bearing on rc5 (disabling either fails smoke). Keep both. |
| Approve executes server-side and the assistant reports success, but the consequential `useRenderTool` result card never appears or vanishes at `RUN_FINISHED` | A hosted approval-resume may emit text only, with no second `function_call_output`; the bridge suppressed the original gated `function_call` while showing `confirm_changes`, so the UI has no call/result pair to render | Preserve the suppressed call per thread. On approved resume, emit a fresh UI-only call id before forwarding the hosted response; if no structured result arrives, close it with an honest `{\"status\":\"ok\",\"executed\":true}` marker (or an error marker). Keep C12 + real-browser E2E green. |
| `useAgent().state` stays empty | `state_schema`/`predict_state_config` not passed to the endpoint, or no tool writes the state key | set `AGENT_STATE_SCHEMA`/`AGENT_PREDICT_STATE` in `src/agent.py` and write the key from a tool. |
| Deployed bridge can't reach the agent | `FOUNDRY_PROJECT_ENDPOINT` / `HOSTED_AGENT_NAME` unset | set both; the bridge (`hosted_client`) reaches the deployed agent keyless. |
| Python `@tool` didn't run "in Foundry" | FoundryAgent runs Python `@tool` callables CLIENT-SIDE; only Foundry-native tools run server-side | expected — define server-side tools on the deployed agent; keep `@tool`s for client-side/HITL. |
| UI 500 mid-run on a long silent tool | a gateway dropped the idle SSE | keep `SSEKeepAliveMiddleware` (`: ping` ~10s). |
