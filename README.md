<div align="center">

# CopilotKit + Foundry HITL Templates

**Build a complete CopilotKit + AG-UI + Azure AI Foundry hosted-agent app — with human-in-the-loop approval that actually re-executes server-side.**

A template gallery for agentic apps on the **Microsoft Agent Framework + CopilotKit + Azure AI Foundry** stack.

</div>

---

## What is this?

**copilotkit-foundry-hitl-templates** is a **template gallery + self-contained agent skills**. Point a coding agent
(GitHub Copilot CLI, Claude Code, …) at this repo and ask for an app:

> *"Build me an assistant that can look up an order and issue a refund, but make
> the refund require my approval first."*

The agent reads `AGENTS.md` → loads `.agents/skills/copilotkit-foundry-scaffold/SKILL.md` →
scaffolds the canonical template → customizes the agent's tools and the chat UI →
proves it with `make verify` + `make smoke` + `make e2e` (protocol and real-browser
checks against the REAL agent run locally via `azd ai agent run`) → and continues development via the
`copilotkit-foundry-hitl` skill. You get a
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
the latest tested packages (agent-framework-core 1.11.0 /
agent-framework-foundry 1.10.1 / ag-ui rc8), even with
`FoundryAgent(allow_preview=True)`: the approval *request* surfaces, but the
*response* is never forwarded as `mcp_approval_response`, so the gated tool never
re-runs (state unchanged).

So we don't replace `agent-framework-ag-ui` — we **feed it** a tiny
`SupportsAgentRun` shim (`HostedProxyAgent` + `hosted_client`) that talks to the
hosted agent over Responses and forwards `mcp_approval_response`, plus one patch
that stops the adapter from resolving the approval locally (and a second,
CopilotKit-v1-only, multi-tool snapshot split). `make smoke` proves both patches
are load-bearing. See
[`.agents/skills/copilotkit-foundry-hitl/references/architecture.md`](.agents/skills/copilotkit-foundry-hitl/references/architecture.md)
for the full native-path matrix.

> **This is tracked upstream as [microsoft/agent-framework#6652](https://github.com/microsoft/agent-framework/issues/6652).**
> When it lands, `agent-framework-ag-ui` + `FoundryAgent` become a complete native
> pair — `add_agent_framework_fastapi_endpoint(app, FoundryAgent(..., allow_preview=True), "/")` —
> and the `HostedProxyAgent` shim + the HITL-routing patch can be retired (you keep
> using `agent-framework-ag-ui`, just without the custom shim).

## Getting started

The path from zero to a running app: install the prerequisites, bootstrap a
scaffold, install the Day-2 skill, then let GitHub Copilot build your
application on top.

### Prerequisites

| Tool | Needed for | Install |
| --- | --- | --- |
| `git`, `make` | cloning the gallery and driving every workflow | system package manager |
| [`uv`](https://docs.astral.sh/uv/) | the bundled Cookiecutter scaffolder (`uvx cookiecutter`) and the bridge's Python 3.12 venv — no separate Python install needed | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js ≥ 22 + `npm` | the Next.js/CopilotKit frontend, Playwright E2E, and the Copilot CLI (which needs 22+) | [nodejs.org](https://nodejs.org) |
| [GitHub CLI (`gh`)](https://cli.github.com) | installing the published Day-2 skill | `brew install gh` / package manager |
| [GitHub Copilot CLI (`copilot`)](https://github.com/github/copilot-cli) | the coding agent that customizes the scaffold to your prompt — any Copilot plan (incl. Free) | `npm install -g @github/copilot` |
| Azure CLI (`az`) + [Azure Developer CLI (`azd`)](https://aka.ms/azd) | running the REAL agent locally (`azd ai agent run`) and deploying — needed from `make smoke` onward, not for scaffolding | [learn.microsoft.com](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) |
| An Azure subscription with **Azure AI Foundry** access | the hosted agent (a paid service) | [ai.azure.com](https://ai.azure.com) |

### 1. Bootstrap the app

```bash
git clone https://github.com/lordlinus/copilotkit-foundry-hitl-templates
cd copilotkit-foundry-hitl-templates
scripts/new-app.sh my-app ~/projects   # uvx cookiecutter under the hood
cd ~/projects/my-app
make verify                            # structural gate — green before you touch anything
```

The scaffold is a complete, runnable app: Next.js + CopilotKit v2 UI, the AG-UI
bridge, the Foundry hosted agent, `azd` deploys, and both agent skills embedded
under `.agents/skills/`.

### 2. Install the Day-2 skill

The development skill is published on **awesome-copilot** as
[`foundry-hosted-agent-copilotkit`](https://awesome-copilot.github.com/skill/foundry-hosted-agent-copilotkit/):

```bash
gh skills install github/awesome-copilot foundry-hosted-agent-copilotkit
```

That skill develops an *existing* app on this stack — it does not scaffold.
This gallery is the scaffolder that produces the bridge wiring the skill
recognizes. (Every scaffolded app also embeds a copy at
`.agents/skills/copilotkit-foundry-hitl/`, so this step is optional inside an
app scaffolded here — install it to get the same guidance in any other project.)

### 3. Build your application with GitHub Copilot

From the scaffolded app, start the Copilot CLI and describe the app you want:

```bash
cd ~/projects/my-app
copilot          # first run: authenticate with /login
```

> *Turn this scaffold into an assistant that can look up an order and issue a
> refund, but require my approval before any refund is executed.*

Copilot reads `AGENTS.md`, loads the embedded skills, and customizes only the
marked extension points: `src/agent.py` (instructions + tools — it keeps ≥1 read
tool and ≥1 `@tool(approval_mode="always_require")` consequential tool),
`frontend/components/Chat.tsx` (render cards), and the matching prompts in
`scripts/smoke.py` and `frontend/e2e/hitl.spec.ts`. The bridge,
`build_hosted_agent()`, and the HITL contract stay as shipped.

### 4. Prove it, run it, ship it

```bash
az login                               # once — smoke/e2e/local/deploy need Azure
make smoke       # end-to-end HITL — read works, action PAUSES, approve executes,
                 # reject doesn't. Runs the REAL agent locally via `azd ai agent run`
                 # (needs a provisioned project — `make up` once)
make e2e         # Chromium journey: read + approve + reject + post-approval follow-up
make local       # dev loop: REAL agent (azd ai agent run) + bridge :8080 + frontend :3000
make up          # azd → deploy the Foundry hosted agent
make up-app      # azd → deploy the bridge + frontend as Container Apps
```

The app is done when `make verify`, `make smoke`, and `make e2e` are all green —
a dev server starting or one chat reply is not proof. For everything after —
adding tools, wiring new approvals, shared state, debugging, upgrades — use the
Day-2 skill's workflows (step 2).

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
.agents/skills/copilotkit-foundry-scaffold/            publishable scaffold skill (SKILL.md + script + template asset)
.agents/skills/copilotkit-foundry-hitl/  the Day-2 dev skill (SKILL.md + references/ + workflows/)
AGENTS.md                     how a coding agent builds an app from one prompt
.mcp.json                     Microsoft Learn MCP (Foundry + Agent Framework docs)
templates/<name>/             each template: bridge + hosted agent + CopilotKit v2 UI + manifest.json
scripts/                      scaffold/package/sync/release helpers
docs/                         template guidelines + the single-prompt workflow
template-manifest.yml      generated gallery manifest (do not hand-edit)
```

## Make targets (gallery)

```text
make new-app NAME=x [DIR=.]        scaffold a runnable app from the canonical template
make new-template NAME=x ...       add a new template variant to the gallery
make manifest                      regenerate template-manifest.yml + README table
make package-skill                 rebuild the self-contained scaffold skill asset
make check                         verify generated manifests are in sync
make release-check                 verify all templates + a fresh bundled scaffold
make list                          list templates
make verify-template               run the canonical template's structural checks
```

## How it's proven

- `make verify` — structural: the bridge mounts `HostedProxyAgent`, forwards
  `mcp_approval_response`, `build_hosted_agent` uses `FoundryChatClient`, names are
  consistent, MCR base images.
- `make smoke` — end-to-end against the REAL agent run locally via `azd ai agent
  run`: read works, the consequential prompt PAUSES, approve executes, reject doesn't,
  snapshot/replay and post-approval card persistence are OK.
- `make e2e` — drives the built CopilotKit UI in Chromium through read, approve,
  reject, and same-thread follow-up flows.
- **Live** — deploy with `azd`, run the bridge against the hosted agent, and confirm
  HITL approve re-executes (state changes) and reject doesn't, in a real browser.

## License

[MIT](LICENSE)
