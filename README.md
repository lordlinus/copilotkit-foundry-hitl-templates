<div align="center">

# ⚒︎ forgewright

**Build a complete CopilotKit + AG-UI + Azure AI Foundry hosted-agent app — with human-in-the-loop approval that actually re-executes server-side.**

A template gallery for agentic apps on the **Microsoft Agent Framework + CopilotKit + Azure AI Foundry** stack.

</div>

---

## What is this?

forgewright is a **template gallery + agent skill**. Point a coding agent
(GitHub Copilot CLI, Claude Code, …) at this repo and ask for an app:

> *"Build me an assistant that can look up an order and issue a refund, but make
> the refund require my approval first."*

The agent reads `AGENTS.md` → loads `.agents/skills/forgewright/SKILL.md` →
scaffolds the canonical template → customizes the agent's tools and the chat UI →
and proves it with `make verify` + `make smoke` (the bridge against the REAL agent
run locally via `azd ai agent run`). You get a
**Next.js + CopilotKit v2** UI over an **AG-UI bridge** to an **Azure AI Foundry
HOSTED agent** that runs all tools, history, and **human-in-the-loop approval**
server-side — plus `azd` to deploy the hosted agent.

## Architecture

```
 Browser — Next.js + CopilotKit v2            Foundry HOSTED agent = the BRAIN
   useAgent / useRenderTool /                   build_hosted_agent(): FoundryChatClient
   useHumanInTheLoop                            ALL @tools + HITL + history (server-side)
   route.ts (CopilotSseRuntime + HttpAgent)            ▲ Responses (stream) +
        │  AG-UI / SSE                                 │ mcp_approval_response
        ▼                                              │
   BRIDGE  (backend/bridge_app.py)                     │
     HostedProxyAgent → forwards each turn, translates Responses → AG-UI
     (text, tool cards, confirm_changes), and forwards the HITL decision so
     the gated tool RE-EXECUTES server-side. Local dev: `azd ai agent run` runs
     the SAME agent on your machine; the bridge points at it (DIRECT mode) — no mock.
```

**Why a bridge? (and why it's the *minimum*)** You can't point a CopilotKit/AG-UI
client at a deployed Foundry hosted agent — its endpoint speaks the OpenAI
**Responses** protocol, not AG-UI.

We **do** use the framework's AG-UI adapter — `agent-framework-ag-ui`
(`add_agent_framework_fastapi_endpoint`) does all the AG-UI HTTP/SSE translation.
It adapts **AG-UI ↔ a `SupportsAgentRun` agent**, and works fully when you hand it
an **in-process `Agent`** (local tools). The catch is HITL: its approval path
executes the approved tool **in-process** (`_resolve_approval_responses`). A
**hosted** agent has no local tool bodies, so on approve nothing runs — verified on
the latest packages (agent-framework 1.9 / ag-ui rc5), even with
`FoundryAgent(allow_preview=True)`: the approval *request* surfaces, but the
*response* is never forwarded as `mcp_approval_response`, so the gated tool never
re-runs (state unchanged).

So we don't replace `agent-framework-ag-ui` — we **feed it** a tiny
`SupportsAgentRun` shim (`HostedProxyAgent` + `hosted_client`) that talks to the
hosted agent over Responses and forwards `mcp_approval_response`, plus one patch
that stops the adapter from resolving the approval locally (and a second,
CopilotKit-v1-only, multi-tool snapshot split). `make smoke` proves both patches
are load-bearing. See `references/architecture.md` for the full native-path matrix.

> **This is tracked upstream as [microsoft/agent-framework#6652](https://github.com/microsoft/agent-framework/issues/6652).**
> When it lands, `agent-framework-ag-ui` + `FoundryAgent` become a complete native
> pair — `add_agent_framework_fastapi_endpoint(app, FoundryAgent(..., allow_preview=True), "/")` —
> and the `HostedProxyAgent` shim + the HITL-routing patch can be retired (you keep
> using `agent-framework-ag-ui`, just without the custom shim).

## Quick start

```bash
# Scaffold a runnable app from the canonical template:
scripts/new-app.sh my-app ~/projects

cd ~/projects/my-app
make verify      # structural checks (no network)
make smoke       # end-to-end HITL — read works, action PAUSES, approve executes,
                 # reject doesn't. Runs the REAL agent locally via `azd ai agent run`
                 # (needs `az login` + a provisioned project — see `make up`)
make local       # dev loop: REAL agent (azd ai agent run) + bridge :8080 + frontend :3000
make up          # azd → deploy the Foundry hosted agent
```

Then edit `src/agent.py` (tools + instructions) and `frontend/components/` (v2
render cards). Keep the bridge, `build_hosted_agent()`, and the HITL contract as
shipped — see `.agents/skills/forgewright/SKILL.md`.

## Why these choices (validated live)

- **Foundry hosted agent uses `FoundryChatClient` (Responses).** This is what
  makes HITL approve **re-execute** the gated tool server-side
  (`mcp_approval_request` → `mcp_approval_response`). Verified live end-to-end
  (approve mutates state; reject doesn't).
- **The bridge forwards the approval.** The native
  `add_agent_framework_fastapi_endpoint(FoundryAgent(…))` path can't — it resolves
  `confirm_changes` locally. `HostedProxyAgent` routes the
  decision to the hosted agent.
- **Same agent locally and deployed.** `azd ai agent run` runs the REAL hosted
  agent (`FoundryChatClient`, Responses) on your machine, connected to your Foundry
  project's model; `make smoke` points the bridge at it (DIRECT mode), so the whole
  SSE + HITL path is exercised against the real agent — no mock.
- **CopilotKit v2** hooks (`useAgent`, `useRenderTool`, `useHumanInTheLoop`) for
  chat, tool-render cards, and the approval gate.

## Live showcase

[`showcase/`](showcase/) is a self-contained **portfolio demo**: a static gallery
(GitHub Pages) that talks over **AG-UI/SSE** to an always-on Container App
fronting the template agents — *Try it* to chat in your browser, *View source* to
land on the template here. See [`showcase/README.md`](showcase/README.md).

## Templates

<!-- TEMPLATES:START -->
| Template | Description | Stack |
| --- | --- | --- |
| **[Agentic CopilotKit + Foundry (HITL)](templates/agentic-copilot-foundry)** | A Next.js/CopilotKit chat UI over a FastAPI/AG-UI SSE backend hosting one Microsoft Agent Framework agent, connected keyless to Azure AI Foundry, with native human-in-the-loop approval on consequential tools. Also publishable as a Foundry hosted agent (Responses) via azd. | Next.js, CopilotKit, AG-UI, Microsoft Agent Framework, Azure AI Foundry |
| **[Conversational Banking (HITL)](templates/conversational-banking)** | A conversational banking assistant: check balances and recent activity freely, but every money movement (transfer, bill pay) pauses on an Approve/Reject widget before it executes. CopilotKit + AG-UI over one Microsoft Agent Framework agent, keyless to Azure AI Foundry; also publishable as a Foundry hosted agent via azd. | Next.js, CopilotKit, AG-UI, Microsoft Agent Framework, Azure AI Foundry |
| **[Health Insurance Claim Intake (HITL)](templates/health-claim-intake)** | Intake multiple claim documents, auto-fill the claim form, let the user review and edit, then submit to the insurer behind a human-in-the-loop approval gate. CopilotKit + AG-UI over one Microsoft Agent Framework agent, keyless to Azure AI Foundry; also publishable as a Foundry hosted agent via azd. | Next.js, CopilotKit, AG-UI, Microsoft Agent Framework, Azure AI Foundry |
<!-- TEMPLATES:END -->

## Repository layout

```text
.agents/skills/forgewright/   the single-prompt build skill (SKILL.md + references/)
AGENTS.md                     how a coding agent builds an app from one prompt
.mcp.json                     Microsoft Learn MCP (Foundry + Agent Framework docs)
templates/<name>/             each template: bridge + hosted agent + CopilotKit v2 UI + manifest.json
scripts/                      new-app.sh, new-template.sh, generate-manifest.mjs
docs/                         template guidelines + the single-prompt workflow
forgewright-template.yml      generated gallery manifest (do not hand-edit)
```

## Make targets (gallery)

```text
make new-app NAME=x [DIR=.]        scaffold a runnable app from the canonical template
make new-template NAME=x ...       add a new template variant to the gallery
make manifest                      regenerate forgewright-template.yml + README table
make check                         verify generated manifests are in sync
make list                          list templates
make verify-template               run the canonical template's structural checks
```

## How it's proven

- `make verify` — structural: the bridge mounts `HostedProxyAgent`, forwards
  `mcp_approval_response`, `build_hosted_agent` uses `FoundryChatClient`, names are
  consistent, MCR base images.
- `make smoke` — end-to-end against the REAL agent run locally via `azd ai agent
  run`: read works, the consequential prompt PAUSES, approve executes, reject doesn't,
  snapshot/replay OK.
- **Live** — deploy with `azd`, run the bridge against the hosted agent, and confirm
  HITL approve re-executes (state changes) and reject doesn't, in a real browser.

## License

[MIT](LICENSE)
