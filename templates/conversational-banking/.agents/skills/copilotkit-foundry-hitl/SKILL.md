---
name: copilotkit-foundry-hitl
description: "Use when DEVELOPING, extending, debugging, or upgrading an existing app on the CopilotKit + AG-UI + Azure AI Foundry hosted-agent stack — a Next.js/CopilotKit v2 UI over an AG-UI (SSE) bridge (HostedProxyAgent) that forwards each turn to a deployed/local Microsoft Agent Framework agent running in Foundry (FoundryChatClient, Responses), with human-in-the-loop approval forwarded via mcp_approval_response. This is the Day-2 skill: add/modify a tool, wire a new HITL approval, add shared/predictive state, debug why approve doesn't re-execute, and upgrade agent-framework while re-checking/removing bridge patches. Triggers: agent.py build_hosted_agent, FoundryChatClient, HostedProxyAgent, bridge_app, hosted_proxy, hosted_client, mcp_approval_response, confirm_changes, approval_mode always_require, useAgent/useFrontendTool/useRenderTool/useHumanInTheLoop, add a tool, add approval, shared state, predictive state, approve doesn't re-execute, upgrade agent-framework, protocol 2.0, azd ai agent run, make smoke, make verify. Also for traps — HITL approve-resume 400 'No tool output found', cards vanishing at RUN_FINISHED, [[...slug]] Threads 404/422, useSingleEndpoint, keyless Foundry 401 audience, Entra isolation 400, fetch Illegal invocation, Docker Hub ACR rate-limit."
metadata:
  author: lordlinus
  version: "0.1.0"
---

# copilotkit-foundry-hitl — developing on the hosted-agent + HITL bridge stack

The **continual-development** skill for apps built on this stack. Scaffolding a new
app is the `copilotkit-foundry-scaffold` skill's job; this skill is everything after: **evolve,
debug, and upgrade** an app whose intelligence lives in an **Azure AI Foundry HOSTED
agent** (FoundryChatClient + tools + HITL + history, Responses protocol) reached
through a **light AG-UI bridge** (`HostedProxyAgent`) from a **CopilotKit v2** UI.

```
 Next.js + CopilotKit v2 (frontend/)          Foundry HOSTED agent = the BRAIN
   useAgent / useFrontendTool /                 src/agent.py build_hosted_agent():
   useRenderTool / useHumanInTheLoop              FoundryChatClient (Responses)
   route.ts (CopilotSseRuntime + HttpAgent)       ALL @tools + HITL + history
        │  AG-UI / SSE                                    ▲ Responses (stream) +
        ▼                                                 │ mcp_approval_response
   BRIDGE (backend/bridge_app.py → HostedProxyAgent) ─────┘
     forwards each turn, translates Responses→AG-UI, forwards the HITL decision
     as mcp_approval_response on approve (gated tool re-executes server-side).
     Same code: LOCAL (`azd ai agent run`, DIRECT mode) and DEPLOYED (platform).
```

**Golden rule (unchanged from scaffold):** `azd` SUCCESS, a dev server starting, or
one chat reply is **not** proof. Because all logic is server-side, a change is done
only when `make verify` (structural) + `make smoke` (the bridge against the REAL
agent run locally via `azd ai agent run`) pass, and — for the deployed path — a
**live browser E2E** covers the patterns you touched (HITL approve **and** reject).
Apps scaffolded from this gallery expose that gate as `make e2e`.

## Orient (read before changing anything)

- `LOAD references/architecture.md` — bridge topology, the native-path test matrix
  (why the bridge is the minimum), live findings, protocol v2.0, the file map.
- `LOAD references/patterns-7.md` — the 7 AG-UI patterns on this stack and how each
  maps to a hosted-agent side + a CopilotKit v2 hook + what the bridge does.
- `LOAD references/troubleshooting.md` — every known trap → symptom → fix, each
  encoded as a check in `verify.sh`/`smoke.py`.
- `LOAD references/hosted-deploy.md` — publishing the hosted agent + wiring the
  deployed bridge with `azd`.

Do not reinvent the bridge, the patches, or the state machinery — reuse the proven
`HostedProxyAgent` (`hosted_proxy.py` + `hosted_client.py`). External refs when a
detail isn't covered above: `https://docs.ag-ui.com/llms-full.txt` (AG-UI wire
protocol) and `https://github.com/CopilotKit/CopilotKit` (v2 hook usage). CopilotKit
also ships official skills via `npx copilotkit@latest skills install` — install
alongside this one for CopilotKit-specific (not bridge/hosted-agent) debugging.

## Pick your workflow

Route by intent — each playbook is a focused, verifiable procedure:

| I want to… | Playbook |
| --- | --- |
| Add or modify an agent tool (read and/or approval-gated) | `LOAD workflows/add-tool.md` |
| Wire a new human-in-the-loop approval correctly | `LOAD workflows/wire-hitl.md` |
| Debug: I approve but the tool doesn't re-execute | `LOAD workflows/debug-hitl.md` |
| Add shared / predictive state or generative UI | `LOAD workflows/shared-state.md` |
| Upgrade agent-framework and re-check / remove patches | `LOAD workflows/upgrade-loop.md` |

## Load-bearing rules (never regress these)

- **`build_hosted_agent()` → `FoundryChatClient` (Responses)** — the single brain,
  SAME code local (`azd ai agent run`) and deployed (`azd up`). Required so the
  hosted `mcp_approval_request`/`mcp_approval_response` re-executes the gated tool.
  Chat Completions (`OpenAIChatClient`) 500s / 400s "No tool output found" on resume.
- **Bridge = `HostedProxyAgent`**, NOT the native
  `add_agent_framework_fastapi_endpoint(FoundryAgent)` — the native FoundryAgent
  client has no client-side `mcp_approval_response`, so HITL approve never
  re-executes (matrix in `references/architecture.md`). `bridge_app.py` also (a)
  neutralises ag-ui's LOCAL approval interception so the decision reaches the agent,
  and (b) splits multi-tool snapshot messages (CopilotKit v1 renders only
  `toolCalls[0]`). Both proven load-bearing by `make smoke`.
- **HITL contract:** a `@tool(approval_mode="always_require")` tool surfaces as a
  `confirm_changes` call; the UI (`useHumanInTheLoop`) resolves `{ accepted, steps }`
  (NOT `{ approved }`). This shape is the template's own convention, matched on both
  sides — keep `hosted_proxy.py`'s `_find_approval_decision` and the frontend
  `respond(...)` in sync if you ever change it.
- **CopilotKit v2:** catch-all `app/api/copilotkit/[[...slug]]/route.ts`;
  `@copilotkit/runtime/v2`; `createCopilotHonoHandler`; export POST/GET/PATCH/DELETE;
  `<CopilotKit useSingleEndpoint={false}>`. Any miss → Threads 404/405/422.
- **Local dev = `azd ai agent run`** runs the REAL agent (`ResponsesHostServer` +
  `FoundryChatClient`) on your machine; the bridge points at it in DIRECT mode
  (`HOSTED_AGENT_DIRECT_URL`). No mock anywhere.
- **MCR base images** only (Docker Hub anonymous pulls hit `toomanyrequests` on ACR).
- **Framework patches are temporary.** Tracked upstream: #6652 (HITL forwarding),
  #6828 / #6851 (duplicate re-execution). Re-check every upgrade via
  `workflows/upgrade-loop.md`; delete a patch the moment its issue closes AND
  `make smoke` stays green without it — not on a version bump alone.

## Anti-patterns

- Hand-rolling a NEW Responses→AG-UI proxy — reuse `HostedProxyAgent`.
- Putting business logic the agent should own into the bridge (it runs no model).
- `OpenAIChatClient` for `build_hosted_agent` (use `FoundryChatClient`).
- Resolving approval with `{ approved }` instead of `{ accepted, steps }`.
- A consequential tool without `approval_mode="always_require"` (no HITL gate).
- `useSingleEndpoint` left at its default `true` (Threads/Info 404).
- Removing a bridge patch because a package version bumped (re-run the matrix first).
- Declaring done because a server started — run `make verify` + `make smoke`, and a
  live browser E2E for the deployed (server-side) path.

## Definition of Done (for any change)

- [ ] `make verify` green (bridge wiring, `FoundryChatClient`, HITL contract, names, MCR).
- [ ] `make smoke` green against the REAL agent (via `azd ai agent run`): read works;
      the consequential prompt PAUSES; approve executes; reject doesn't; C9 + C10;
      and for shared/predictive patterns in scope, state flows.
- [ ] `make e2e` green in real Chromium: read, reject, approve, and a same-thread
      post-approval follow-up without duplicate execution.
- [ ] No secrets, endpoints, or app-specific hard-coding committed.
- [ ] **Live** browser E2E for any touched pattern on the deployed path — HITL
      approve **and** reject, plus any shared/predictive state round-trip and cards.
