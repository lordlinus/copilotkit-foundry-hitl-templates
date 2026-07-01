---
name: forgewright
description: "Use when customizing, running, verifying, or deploying THIS forgewright app — a Next.js/CopilotKit v2 UI over an AG-UI bridge (HostedProxyAgent) to a deployed Azure AI Foundry HOSTED agent (FoundryChatClient), with rich generative UI: tool cards, HITL approval (forwarded via mcp_approval_response). Triggers: agent.py build_hosted_agent, FoundryChatClient, HostedProxyAgent, bridge_app, hosted_proxy, hosted_client, mcp_approval_response, azd ai agent run, confirm_changes, approval_mode always_require, useAgent/useFrontendTool/useRenderTool/useHumanInTheLoop, make smoke, make verify, make up. Also for traps — HITL approve-resume 400, cards vanishing, [[...slug]] Threads 404/422, useSingleEndpoint, keyless Foundry 401 audience, Entra isolation 400, Docker Hub rate-limit."
metadata:
  author: forgewright
  version: "0.5.0"
---

# forgewright app — customize, verify, deploy

Goal: a Foundry HOSTED agent (all tools + HITL + history server-side) + a CopilotKit
UI with rich generative UI. The bridge (`backend/bridge_app.py` → `HostedProxyAgent`)
forwards each turn to the hosted agent over Responses, translates to AG-UI, and
forwards `mcp_approval_response` on HITL approve so the gated tool **re-executes
server-side**. (The native `add_agent_framework_fastapi_endpoint(FoundryAgent)` path
can't: even with `allow_preview=True` it never sends `mcp_approval_response`, so
approve doesn't re-execute — re-verified live, matrix in references/architecture.md.) For local dev,
`azd ai agent run` runs the REAL agent on your machine (connected to your Foundry
project) and `make smoke`/`make local` point the bridge at it (DIRECT mode), so smoke
drives the SAME bridge code path as production — no mock.

**Golden rule:** a dev server starting or `azd` SUCCESS is **not** proof. Done =
`make verify` + `make smoke` green AND a **live browser E2E** against the deployed
agent (HITL approve re-executes; reject doesn't).

## 0. Orient

- `LOAD references/architecture.md` — the bridge topology + live findings.
- `LOAD references/patterns-7.md` — the 7 AG-UI patterns on this stack.
- `LOAD references/troubleshooting.md` — every known trap → symptom → fix.

## 1. Customize — extension points

`src/agent.py` (the single brain, `build_hosted_agent()` → FoundryChatClient):
- `_INSTRUCTIONS` — behavior for your domain.
- Tools — keep >=1 read tool and >=1 `@tool(approval_mode="always_require")` gated tool.
- Update `scripts/smoke.py`'s domain prompts (`READ_PROMPT`/`ACTION_PROMPT`/`STATE_FIELD`/`READ_TOOL`) so `make smoke` still exercises HITL.

`frontend/components/` (CopilotKit **v2** hooks):
- `useRenderTool` (tool cards), `useHumanInTheLoop` (keep `{ accepted, steps }` —
  this exact shape is this app's own convention matched in `hosted_proxy.py`'s
  `_find_approval_decision`, not something CopilotKit enforces; keep both sides
  in sync if you ever change it), `useFrontendTool`, `useAgent`.

**Do NOT touch:** `backend/{bridge_app,hosted_proxy,hosted_client}.py`,
`build_hosted_agent()` (FoundryChatClient) in `src/agent.py`, or the CopilotKit
bridge in `frontend/app/api/copilotkit/[[...slug]]/route.ts`.

## 2. Prove it

```bash
make verify     # structural: HostedProxyAgent, mcp_approval_response, FoundryChatClient, DIRECT mode, names, MCR
make smoke      # bridge → REAL agent (azd ai agent run) — read; PAUSE; approve executes; reject doesn't; C9; C10
```

## 3. Run / deploy

```bash
make local      # frontend :3000 + bridge :8080 → REAL agent local (azd ai agent run)
make up         # azd → deploy the Foundry HOSTED agent (build_hosted_agent / FoundryChatClient)
```

Deployed UI: run the bridge with `FOUNDRY_PROJECT_ENDPOINT` + `HOSTED_AGENT_NAME` →
`HostedProxyAgent` drives the deployed agent. Then a **live browser E2E** (the real DoD).

## Load-bearing rules

- **`build_hosted_agent()` → `FoundryChatClient` (Responses)** — the single brain,
  SAME code local (`azd ai agent run`) and deployed (`azd up`). Required so the hosted
  `mcp_approval_request`/`mcp_approval_response` re-executes the gated tool (verified
  live: 100→125 deployed, 100→110 local). No mock client.
- **Bridge = `HostedProxyAgent`** (`hosted_proxy.py` + `hosted_client.py`), forwarding
  turns + `mcp_approval_response`; `bridge_app.py` neutralises ag-ui's local approval
  interception + splits multi-tool snapshots (`DISABLE_C9_SPLIT=1` on a v2 frontend).
- **Local dev = `azd ai agent run`** runs the REAL agent (`ResponsesHostServer` +
  `FoundryChatClient`) on your machine; `make smoke`/`make local` point the bridge at
  it via DIRECT mode (`HOSTED_AGENT_DIRECT_URL`, `HOSTED_AUTH=none`). The deployed
  bridge image stays lean (no foundry/openai/hosting — it runs no model).
- The bridge must NOT send `x-ms-user-isolation-key` (deployed agents use Entra isolation
  → 400). `SSEKeepAliveMiddleware` keeps the SSE alive during silent server-side tools.
- **CopilotKit:** v2 hooks; catch-all `[[...slug]]`; `@copilotkit/runtime/v2`;
  `createCopilotHonoHandler`; export POST/GET/PATCH/DELETE; `useSingleEndpoint={false}`.
- **MCR base images** only (Docker Hub rate-limits ACR builds).

## Definition of Done

- [ ] `make verify` green (HostedProxyAgent + mcp_approval_response; build_hosted_agent uses FoundryChatClient; DIRECT mode wired).
- [ ] `make smoke` green: bridge → REAL agent (azd ai agent run) — read; PAUSE; approve executes; reject doesn't; C9; C10.
- [ ] >=1 read tool + >=1 `approval_mode="always_require"` tool.
- [ ] Agent name consistent across `agent.py`, route, provider, hosted yaml.
- [ ] No secrets / endpoints / app-specific hard-coding committed.
- [ ] **Live** browser E2E against the deployed agent — HITL approve (re-executes, state changes) AND reject (no change), plus tool-render cards.
