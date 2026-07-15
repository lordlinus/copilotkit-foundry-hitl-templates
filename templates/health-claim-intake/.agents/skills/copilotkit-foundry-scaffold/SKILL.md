---
name: copilotkit-foundry-scaffold
description: "Use when customizing, running, verifying, or deploying THIS scaffolded app — a Next.js/CopilotKit v2 UI over an AG-UI bridge (HostedProxyAgent) to an Azure AI Foundry HOSTED agent (FoundryChatClient, Responses), with HITL approval forwarded via mcp_approval_response. This is the app-specific quick guide: where to make changes, what not to touch, and how to prove it. For deep Day-2 work — adding tools, wiring HITL, shared state, debugging why approve doesn't re-execute, upgrading agent-framework — use the sibling copilotkit-foundry-hitl skill. Triggers: this app, agent.py build_hosted_agent, FoundryChatClient, HostedProxyAgent, bridge_app, make smoke, make verify, make up, customize this app, deploy this app."
metadata:
  author: Sunil Sattiraju
  version: "0.6.0"
---

# This app — customize, verify, deploy

This app was scaffolded from the copilotkit-foundry-hitl-templates canonical template. Its intelligence
runs in an Azure AI Foundry **HOSTED agent** (all tools + HITL + history,
server-side); the CopilotKit v2 UI talks to it through a light AG-UI **bridge**
(`backend/bridge_app.py` → `HostedProxyAgent`) that forwards each turn over Responses
and forwards `mcp_approval_response` on HITL approve so the gated tool re-executes
server-side. For local dev, `azd ai agent run` runs the REAL agent on your machine
and `make smoke`/`make local` point the bridge at it (DIRECT mode) — no mock.

**Golden rule:** a dev server starting or `azd` SUCCESS is **not** proof. Done =
`make verify` + `make smoke` + `make e2e` green AND a **live browser E2E** against the deployed
agent (HITL approve re-executes; reject doesn't).

## For deep development, use the Day-2 skill

The full architecture, the 7 AG-UI patterns, the troubleshooting catalog, the
load-bearing rules, and step-by-step playbooks live in the sibling skill
**`.agents/skills/copilotkit-foundry-hitl/`**. Load it and pick a workflow for:

| Task | Playbook |
| --- | --- |
| Add / modify a tool | `copilotkit-foundry-hitl/workflows/add-tool.md` |
| Wire a new HITL approval | `copilotkit-foundry-hitl/workflows/wire-hitl.md` |
| Approve doesn't re-execute | `copilotkit-foundry-hitl/workflows/debug-hitl.md` |
| Shared / predictive state | `copilotkit-foundry-hitl/workflows/shared-state.md` |
| Upgrade agent-framework | `copilotkit-foundry-hitl/workflows/upgrade-loop.md` |

## 1. Customize — extension points

`src/agent.py` (the single brain, `build_hosted_agent()` → FoundryChatClient):
- `_INSTRUCTIONS` — behavior for your domain.
- Tools — keep ≥1 read tool and ≥1 `@tool(approval_mode="always_require")` gated tool.
- Update `scripts/smoke.py`'s domain prompts (`READ_PROMPT`/`ACTION_PROMPT`/
  `STATE_FIELD`/`READ_TOOL`) so `make smoke` still exercises HITL.

`frontend/components/` (CopilotKit **v2** hooks): `useRenderTool` (tool cards),
`useHumanInTheLoop` (keep `{ accepted, steps }` — matched in `hosted_proxy.py`'s
`_find_approval_decision`; keep both sides in sync), `useFrontendTool`, `useAgent`.

**Do NOT touch:** `backend/{bridge_app,hosted_proxy,hosted_client}.py`,
`build_hosted_agent()`'s `FoundryChatClient` in `src/agent.py`, or the CopilotKit
bridge `frontend/app/api/copilotkit/[[...slug]]/route.ts`.

## 2. Prove it

```bash
make verify     # structural: HostedProxyAgent, mcp_approval_response, FoundryChatClient, DIRECT mode, names, MCR
make smoke      # bridge → REAL agent (azd ai agent run) — read; PAUSE; approve executes; reject doesn't; C9; C10
make e2e        # built CopilotKit UI in Chromium — read; reject; approve; same-thread follow-up
```

## 3. Run / deploy

```bash
make local      # frontend :3000 + bridge :8080 → REAL agent local (azd ai agent run)
make up         # azd → deploy the Foundry HOSTED agent (build_hosted_agent / FoundryChatClient)
make up-app     # azd → deploy the bridge + frontend as Container Apps (deploy/), wired
                # keyless to the agent `make up` just deployed
```

Deployed UI: `make up-app` provisions the bridge (internal-only Container App, granted
the `Foundry Agent Consumer` role on the Foundry account) + the frontend (public
Container App) — `HostedProxyAgent` drives the deployed agent. Then a **live browser
E2E** — the real DoD: HITL approve (re-executes, state changes) AND reject (no
change), plus tool-render cards.
