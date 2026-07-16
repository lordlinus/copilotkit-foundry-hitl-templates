# CopilotKit + Foundry HITL Templates — the details

Everything behind the [README](README.md) quick start: what the stack is, why the
bridge exists, why these choices were made, the full setup walkthrough,
troubleshooting, and how every claim is verified.

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

## The full setup walkthrough

The [README quick start](README.md#quick-start) is the short version. Details that
matter once you're past it:

### Customizing with a coding agent

From the scaffolded app, start the Copilot CLI (or any coding agent) and describe
the app you want:

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

### The Day-2 skill

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

### Two azd environments

`make up` creates `hosted/.azure/` (the deployed agent). `make smoke` / `make
local` / `make e2e` run the same agent locally via `azd ai agent run`, which
needs `FOUNDRY_PROJECT_ENDPOINT` in the LOCAL azd env at the app root
(`./.azure/`) — `azd ai agent run` does **not** prompt for or provision a
project on its own. `scripts/lib-agentrun.sh` auto-heals this on first run by
reusing the project `make up` already provisioned in `hosted/.azure/`, so no
extra manual step is normally needed; `make doctor` shows the fix
(`azd env set FOUNDRY_PROJECT_ENDPOINT <endpoint>`) if it can't.

### Definition of done

The app is **dev-done** when `make verify`, `make smoke`, and `make e2e` are all
green — a dev server starting or one chat reply is not proof — and **deployed**
only after `make up-app` + `make verify-deployed` pass. For everything after —
adding tools, wiring new approvals, shared state, debugging, upgrades — use the
Day-2 skill's workflows.

## If something fails

`make doctor` (inside a scaffolded app) checks every prerequisite — tools, both
Azure logins, both azd envs, ports — and prints the fix next to each failure.
Run it first. Beyond that:

- `make smoke` assertion failures with no visible error — the agent's own log is
  `/tmp/forge-agent.log`. A 403 `…agents/write` there means the signed-in identity
  lacks the **Azure AI User** role on the Foundry project (log in with the account
  that provisioned it, or grant the role).
- "already in use" / "bridge not ready" — stale processes from an interrupted run:
  `fuser -k 8080/tcp 8088/tcp 3000/tcp`.
- `make up` fails on quota — the default deploy requests `gpt-4.1`
  (GlobalStandard, capacity 100); lower `capacity` in `hosted/azure.yaml` or pick
  a subscription/region with quota.

## Live showcase

[`showcase/`](showcase/) is a self-contained **portfolio demo**: a static gallery
(GitHub Pages) that talks over **AG-UI/SSE** to an always-on Container App
fronting the template agents — *Try it* to chat in your browser, *View source* to
land on the template here. See [`showcase/README.md`](showcase/README.md).

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
