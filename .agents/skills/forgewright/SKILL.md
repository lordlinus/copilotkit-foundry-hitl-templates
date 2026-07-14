---
name: forgewright
description: "Use when SCAFFOLDING a NEW agentic web app on the CopilotKit + AG-UI + Azure AI Foundry hosted-agent stack — a Next.js/CopilotKit v2 chat UI over a FastAPI/AG-UI (SSE) bridge that forwards to ONE Microsoft Agent Framework agent hosted in Foundry, with native human-in-the-loop approval on consequential tools. This is the on-ramp: instantiate the canonical template and customize it to the user's prompt, then hand off to the copilotkit-foundry-hitl skill for ALL continued development (adding tools, wiring HITL, shared state, debugging, upgrades). Triggers: forgewright, build an agentic app, scaffold a CopilotKit app, new-app.sh, start a Foundry hosted-agent app, one prompt to an app, agentic-copilot-foundry template."
metadata:
  author: forgewright
  version: "0.4.0"
---

# forgewright — one prompt → a new CopilotKit + AG-UI + Foundry HITL app

The **scaffold on-ramp**. This skill instantiates a runnable app on the
**hosted-agent-first** standard and customizes it to the user's prompt. It is
deliberately small: once the app exists and passes its first checks, **hand off to
the `copilotkit-foundry-hitl` skill** for everything after — adding tools, wiring
HITL, shared/predictive state, debugging, and upgrades. That Day-2 skill owns the
architecture, the 7 patterns, the troubleshooting catalog, and the load-bearing rules.

The stack (all intelligence server-side in a Foundry HOSTED agent; a light AG-UI
bridge; CopilotKit v2 UI):

```
 Next.js + CopilotKit v2 (frontend/)          Foundry HOSTED agent = the BRAIN
   useAgent / useFrontendTool /                 src/agent.py build_hosted_agent():
   useRenderTool / useHumanInTheLoop              FoundryChatClient (Responses)
   route.ts (CopilotSseRuntime + HttpAgent)       ALL @tools + HITL + history
        │  AG-UI / SSE                                    ▲ Responses (stream) +
        ▼                                                 │ mcp_approval_response
   BRIDGE (backend/bridge_app.py → HostedProxyAgent) forwards each turn + approvals
```

**Golden rule:** `azd` SUCCESS, a dev server starting, or one chat reply is **not**
proof. Because all logic is server-side, the app is done only when `make verify`,
`make smoke` (the bridge against the REAL agent run locally via `azd ai agent run`),
and `make e2e` (real Chromium) pass. Never declare success on an unverified build.

## 0. Orient

- This skill is self-contained: `assets/agentic-copilot-foundry.tar.gz` contains the
  canonical template, and `scripts/new-app.sh` instantiates it. It does not depend on
  a checkout of the forgewright gallery.
- The deep stack knowledge lives in the sibling **`copilotkit-foundry-hitl`** skill
  (`.agents/skills/copilotkit-foundry-hitl/`): `references/{architecture,patterns-7,
  troubleshooting,hosted-deploy}.md` and `workflows/*.md`. Load it before any change
  beyond the initial customization below.

## 1. Scaffold (always start here)

Resolve this skill's base directory, then run its bundled scaffolder:

```bash
bash <skill-dir>/scripts/new-app.sh <app-name> [target-dir]  # lowercase-hyphen
```

Extracts the bundled canonical template into `<target-dir>/<app-name>/` and rewrites the
agent-name tokens (`AGENT_NAME`, `<CopilotKit agent>`, route, hosted yaml) so they
stay consistent.

## 2. Customize to the user's prompt — extension points

Edit `src/agent.py` (the hosted brain via `build_hosted_agent()`):
- `_INSTRUCTIONS` — the agent's behavior for the requested domain.
- Tools — keep **≥1 read tool** (no side effects) and **≥1 consequential tool**
  decorated `@tool(approval_mode="always_require")`. Map the user's "needs approval
  before X" to the gated tool.
- Update `scripts/smoke.py`'s domain prompts (`READ_PROMPT` / `ACTION_PROMPT` /
  `STATE_FIELD` / `READ_TOOL`) to match your tools.
- Update `frontend/e2e/hitl.spec.ts`'s prompts and user-visible result assertions
  so the browser test covers the customized read and consequential tools.

Edit `frontend/components/` (CopilotKit **v2** hooks): `useRenderTool` (backend tool
cards), `useHumanInTheLoop` (HITL — keep the `{ accepted, steps }` contract),
`useFrontendTool`, `useAgent`.

**Do NOT touch** (load-bearing and proven): `backend/{bridge_app,hosted_proxy,
hosted_client}.py`, `build_hosted_agent()`'s `FoundryChatClient`, and the CopilotKit
bridge `frontend/app/api/copilotkit/[[...slug]]/route.ts`.

For anything more than this first customization — a new tool, a new approval, shared
state, a bug, an upgrade — **switch to `copilotkit-foundry-hitl` and pick a workflow.**

## 3. Prove it

```bash
make verify     # structural: bridge wiring, FoundryChatClient, HITL contract, names, MCR
make smoke      # the BRIDGE against the REAL agent (azd ai agent run): read works, the
                # consequential prompt PAUSES, approve executes, reject doesn't,
                # C9/C10/C11/C12.
                # Needs `az login` + a provisioned Foundry project (`make up` once).
make e2e        # real Chromium UI: read, approve, reject, and follow-up after approval.
```

All three must be green. Then `make local` (dev loop) and, in a Foundry-enabled tenant,
`make up` (azd → hosted agent) followed by a **live browser E2E** — the real DoD.

## Hand off

The moment the scaffolded app is customized and green, continued development belongs
to **`copilotkit-foundry-hitl`**. Do not re-derive the bridge, the HITL contract, or
the framework patches here — that skill already documents them, verified live, and
routes each task (add-tool, wire-hitl, debug-hitl, shared-state, upgrade-loop) to a
focused playbook with its own Definition of Done.
