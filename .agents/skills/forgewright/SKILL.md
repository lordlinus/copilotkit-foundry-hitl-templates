---
name: forgewright
description: "Use when building a complete agentic web app from a single prompt with the CopilotKit + AG-UI + Azure AI Foundry hosted-agent stack — a Next.js/CopilotKit chat UI over a FastAPI/AG-UI SSE backend hosting ONE Microsoft Agent Framework agent, with native human-in-the-loop approval on consequential tools. Triggers: forgewright, build an agentic app, CopilotKit app, AG-UI backend, Microsoft Agent Framework agent, Foundry hosted agent, human-in-the-loop / HITL approval, approval_mode always_require, confirm_changes, new-app.sh, make smoke, make verify. Also use when fixing the known traps — HITL approve-resume 400 'No tool output found', confirm_changes mis-wired, AG-UI snapshot cards vanishing, [[...slug]] Threads 404/422, useSingleEndpoint, keyless Foundry 401 audience, Docker Hub rate-limit on ACR build."
metadata:
  author: forgewright
  version: "0.1.0"
---

# forgewright — one prompt → a full CopilotKit + AG-UI + Foundry HITL app

Build a **new** agentic app: a Next.js/CopilotKit chat UI talking to a
FastAPI/AG-UI (SSE) backend that hosts **one** Microsoft Agent Framework agent,
connected to **Azure AI Foundry** keyless (DefaultAzureCredential), with **native
human-in-the-loop approval** on every consequential tool. The same agent code can
also be published as a **Foundry hosted agent** (Responses protocol) via `azd`.

```
 Next.js + CopilotKit (frontend/)            ONE MAF agent (src/agent.py)
   app/api/copilotkit/[[...slug]]/route.ts     @tool(approval_mode="always_require")
   CopilotSseRuntime + HttpAgent  ──SSE──▶    backend/ag_ui_app.py  (FastAPI + AG-UI
   confirm_changes HITL card                   + 4 resilience patches)
                                              hosted/responses/main.py (azd → Foundry)
```

**Golden rule:** `azd` SUCCESS, a dev server starting, or one chat reply is **not**
proof. You are done only when `make verify` AND `make smoke` pass. See the
Definition of Done. Never declare success on an unverified build.

## 0. Orient

- `LOAD references/architecture.md` — what lives where and why.
- `LOAD references/troubleshooting.md` — every known trap → symptom → fix.
- The canonical, **already-working** template is `templates/agentic-copilot-foundry/`.
  Read it before changing anything; do not reinvent the patches or the bridge.

## 1. Scaffold (always start here)

```bash
scripts/new-app.sh <app-name> [target-dir]    # lowercase-hyphen name
```

This copies the canonical template into `<target-dir>/<app-name>/` and rewrites
the agent-name tokens (`AGENT_NAME`, `<CopilotKit agent>`, route, hosted yaml) so
they stay consistent. The result already runs and already passes `make smoke`.

## 2. Customize to the user's prompt — ONLY these extension points

Edit `src/agent.py`:
- `_INSTRUCTIONS` — the agent's behavior for the requested domain.
- Tools — keep **at least one read tool** (no side effects) and **at least one
  consequential tool** decorated `@tool(approval_mode="always_require")`. Map the
  user's "needs approval before X" to the gated tool. Put real domain state in
  the demo `_Store` or your own module.
- If you rename the demo tools, update `src/mock_client.py` (READ_TOOL /
  ACTION_TOOL / keyword lists) and `scripts/smoke.py` (READ_PROMPT / ACTION_PROMPT
  / STATE_FIELD / READ_TOOL) so `make smoke` still exercises the HITL gate.

Edit `frontend/components/Chat.tsx`:
- Add/adjust `useCopilotAction` render cards for your tools. Keep the
  `confirm_changes` action exactly as shipped (it is the HITL gate).

**Do NOT touch** (these are load-bearing and proven):
- the four AG-UI resilience patches in `backend/ag_ui_app.py`;
- the CopilotKit bridge in `frontend/app/api/copilotkit/[[...slug]]/route.ts`;
- the keyless Chat-Completions client construction in `build_chat_client()`.

## 3. Prove it (no Azure required)

```bash
make verify     # structural: patches, bridge, HITL contract, names, MCR base
make smoke      # offline end-to-end: LLM_MODE=mock starts the backend and asserts
                # read works, action PAUSES, approve executes, reject doesn't,
                # snapshot has no >1-toolcall assistant msg (C9), orphan replay ok (C10)
```

Both must be green. Then optionally `make local` (dev loop on :3000) and, in a
Foundry-enabled tenant, `make up` (azd → hosted agent).

## Load-bearing rules (why the template is shaped this way)

### Foundry connection
- Keyless: `DefaultAzureCredential` + `get_bearer_token_provider(cred,
  "https://ai.azure.com/.default")` → `OpenAIChatCompletionClient(base_url=
  "{FOUNDRY_PROJECT_ENDPOINT}/openai/v1")`. The `ai.azure.com` audience is
  required; the SDK default `cognitiveservices.azure.com` 401s the project path.
- **Chat Completions, NOT the Responses API.** With the Responses client, HITL
  approve-resume returns 400 "No tool output found for function call". `make verify`
  fails the build if it sees `OpenAIChatClient` (the Responses client).

### HITL contract
- A `@tool(approval_mode="always_require")` tool surfaces to CopilotKit as a
  synthetic `confirm_changes` tool call (with `function_name`,
  `function_arguments`, `steps`). The frontend resolves it with
  `{ accepted: boolean, steps }` (NOT `{ approved }`) — the backend's detection is
  literally `"accepted" in parsed`.
- Register the action `available: "disabled"` with `renderAndWaitForResponse`.

### AG-UI resilience (all four patches are mandatory with any HITL tool)
1. strip client/server tool-name collisions; 2. split multi-tool snapshot
assistant messages (CopilotKit renders only `toolCalls[0]`); 2b. fresh
`parent_message_id` for the live `confirm_changes` start event; 2c. journal the
executed HITL result + scrub stale `{accepted:…}` payloads; 3. repair orphaned
tool calls in replayed history (skip ones pending approval). Missing any one
causes vanished cards, looping approve/reject buttons, or a 400 on the next turn.

### CopilotKit bridge (five required choices)
Catch-all `app/api/copilotkit/[[...slug]]/route.ts`; import from
`@copilotkit/runtime/v2`; `createCopilotHonoHandler` (multi-route, not the
single-route Next endpoint); re-export POST/GET/PATCH/DELETE; and
`<CopilotKit useSingleEndpoint={false}>`. Any miss → Threads 404/405/422 or
"Agent not found".

### Mock client (offline)
`LLM_MODE=mock` swaps in `src/mock_client.py`, which subclasses
**`FunctionInvocationLayer, BaseChatClient`** (the Agent skips tool execution for a
plain `BaseChatClient`) and returns a `ResponseStream` when streaming. It routes
on keywords to emit the read or the gated tool call; the framework still does
real execution + approval. This is what makes `make smoke` Azure-free.

### Containers
Use **MCR** base images (`mcr.microsoft.com/devcontainers/python:3.12`,
`.../typescript-node:20`). Docker Hub anonymous pulls hit `toomanyrequests` on
`az acr build` / ACR Tasks.

## Anti-patterns

- Editing the four patches, the bridge, or the client construction "to simplify".
- Using the Responses-API `OpenAIChatClient` (breaks HITL approve-resume).
- Resolving approval with `{ approved }` instead of `{ accepted, steps }`.
- `useSingleEndpoint` left at its default `true` (Threads/Info 404).
- A consequential tool **without** `approval_mode="always_require"` (no HITL gate).
- Docker Hub base images in any Dockerfile.
- Declaring success because the server started — run `make verify` + `make smoke`.

## Definition of Done

The app is **not** done until all are true (evidence-backed):

- [ ] `make verify` is green (all structural checks).
- [ ] `make smoke` is green: read works; the consequential prompt PAUSES and does
      not execute; approve executes (state changes); reject does not; C9 + C10 pass.
- [ ] `src/agent.py` has ≥1 read tool and ≥1 `approval_mode="always_require"` tool.
- [ ] Agent name is consistent across `src/agent.py`, the route, the CopilotKit
      provider, and the hosted yaml (verify checks this).
- [ ] No secrets, endpoints, or app-specific hard-coding committed.
- [ ] (If deploying) `make up` succeeds AND a live smoke against the hosted agent
      shows one consequential action pausing for approval.
