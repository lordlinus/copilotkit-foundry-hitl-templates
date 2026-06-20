# Architecture — Foundry hosted agent + CopilotKit, via a HITL-forwarding bridge

**Goal:** an Azure AI Foundry HOSTED agent (all tools + HITL + history server-side)
with a CopilotKit UI showing rich generative UI — tool-render cards, human-in-the-
loop approval, shared/predictive state.

**Why a bridge at all:** you **cannot** point `@ag-ui/client` at a deployed hosted
agent — its endpoint speaks the OpenAI **Responses** protocol, not AG-UI. AND the
framework's *native* path (`add_agent_framework_fastapi_endpoint(FoundryAgent(...))`)
resolves the HITL `confirm_changes` **locally** and never forwards the approval, so
the gated tool **does not re-execute** (verified live). So the bridge is a small
hand-rolled forwarder: it translates Responses→AG-UI AND forwards the HITL decision
as an `mcp_approval_response`, which re-executes the tool server-side.

```
 Browser — Next.js + CopilotKit (v2 hooks)
   useAgent / useFrontendTool / useRenderTool / useHumanInTheLoop
   app/api/copilotkit/[[...slug]]/route.ts  (CopilotSseRuntime + HttpAgent)
        │  AG-UI / SSE
        ▼
 BRIDGE  (Container App — backend/bridge_app.py)
   LOCAL/DEPLOYED: HostedProxyAgent (SupportsAgentRun) — forwards each turn to the
              hosted agent (hosted_client, streaming Responses), translates → AG-UI
              (text, tool cards, confirm_changes), and forwards mcp_approval_response
              on approve (bridge_app patches neutralise ag-ui's local interception).
   LOCAL DEV: `azd ai agent run` runs the agent on your machine; bridge → DIRECT
              mode (HOSTED_AGENT_DIRECT_URL). DEPLOYED: bridge → platform mode. No mock.
        │  POST .../agents/<name>/endpoint/protocols/openai/responses (stream)
        ▼
 FOUNDRY HOSTED AGENT  (the brain — azd → host: azure.ai.agent)
   src/agent.py build_hosted_agent(): FoundryChatClient (Responses), store=False
   ALL @tools + @tool(approval_mode="always_require") HITL + history server-side
```

## Validated live (deployed agent agentic-copilot-foundry, swec-proj-default)

- Read tool → runs server-side; tool-render card in AG-UI.
- HITL trigger → `mcp_approval_request` → bridge surfaces `confirm_changes` (pause).
- **Approve → bridge sends `mcp_approval_response{approve:true}` → tool re-executes
  server-side, state changes (100→125).** No "No tool output found".
- Reject → `approve:false` → tool does NOT execute (state unchanged).
- Two gotchas found live: the bridge must NOT send `x-ms-user-isolation-key`
  (deployed agents use Entra isolation → 400); and `build_hosted_agent` MUST use
  `FoundryChatClient` (Chat Completions 500s on hosted approve-resume).

## Client choice (the load-bearing rule)

- **Hosted agent (`build_hosted_agent`) → `FoundryChatClient` (Responses).** Required
  so the hosted runtime's `mcp_approval_request`/`mcp_approval_response` re-executes
  the gated tool. Chat Completions 500s on resume here.
- **Local dev → `azd ai agent run`**: the Foundry extension runs the REAL agent
  (`ResponsesHostServer` + `FoundryChatClient`) on your machine, connected to your
  Foundry project's model. `make smoke`/`make local` point the bridge at it in DIRECT
  mode (`HOSTED_AGENT_DIRECT_URL` → POST `/responses` with `previous_response_id`
  chaining), so it drives the SAME `HostedProxyAgent` path as production. No mock —
  needs `az login` + a provisioned project (`make up` once).

## File map

```
<app>/
├── src/
│   └── agent.py        ONE agent. build_hosted_agent() → FoundryChatClient
│                       (the single brain — same code local + deployed). Read tools
│                       + ≥1 @tool(approval_mode="always_require").
├── backend/            THE BRIDGE (deployed Container App).
│   ├── bridge_app.py        AG-UI endpoint → HostedProxyAgent (DIRECT local /
│   │                        platform deployed). + SSE keepalive + optional API key.
│   ├── hosted_proxy.py      HostedProxyAgent: forward turns + translate Responses →
│   │                        AG-UI; surface confirm_changes; forward mcp_approval_response.
│   ├── hosted_client.py     streaming Responses driver: platform (conversation +
│   │                        agent_session_id, keyless) OR DIRECT (local azd ai agent run).
│   ├── requirements.txt     bridge deps only (httpx pin; no foundry/openai — runs no model).
│   └── Dockerfile           MCR base; deploys uvicorn bridge_app:app.
├── hosted/             azd → Foundry HOSTED agent (Responses) — the deployed brain.
│   ├── azure.yaml      host: azure.ai.agent; azure.ai.agents pinned; context=root.
│   └── responses/      main.py = ResponsesHostServer(build_hosted_agent()), …
├── frontend/           Next.js + CopilotKit v2 (useAgent/useFrontendTool/
│                       useRenderTool/useHumanInTheLoop).
├── scripts/            verify.sh (structural), smoke.py (E2E vs the real local agent),
│                       lib-agentrun.sh (azd ai agent run + bridge DIRECT).
└── Makefile(+.targets) preflight / local / verify / smoke / up / deploy / clean.
```

## Proving it (Definition of Done)

`azd` SUCCESS / a server starting is **not** proof. Done = `make verify` +
`make smoke` (the bridge against the REAL agent run locally via `azd ai agent run`)
green, AND — because the deployed path drives a server-side agent — a **live**
browser E2E: deploy with `azd`, run the bridge with `HOSTED_AGENT_NAME` set, and
confirm read + HITL approve (tool re-executes, state changes) **and** reject (no
change) in a real browser.
