# AGENTS.md — copilotkit-foundry-hitl-templates

This repository is a **template gallery** — *not* a single app. It
teaches a coding agent to build and then continually develop a **complete
CopilotKit + AG-UI + Foundry hosted agent application**, with native
human-in-the-loop approval.

## Two skills

- **`copilotkit-foundry-scaffold`** (`.agents/skills/copilotkit-foundry-scaffold/`) — the **scaffold on-ramp**:
  instantiate the canonical template and customize it to the user's prompt. Small.
- **`copilotkit-foundry-hitl`** (`.agents/skills/copilotkit-foundry-hitl/`) — the
  **Day-2 development** skill: the architecture, the 7 AG-UI patterns, the
  troubleshooting catalog, the load-bearing rules, and step-by-step workflows
  (add-tool, wire-hitl, debug-hitl, shared-state, upgrade-loop). This is where
  ongoing work on the stack lives — adding a tool, wiring a new approval, debugging
  why approve doesn't re-execute, and upgrading agent-framework while re-checking the
  bridge patches. Prefer it for any change to an existing app.

## Build an app from one prompt (the scaffold workflow)

When the user asks for an agentic app ("build me an app that …", "an assistant
that can … with approval before …"), do this — do not hand the user manual steps:

1. **Load the skill:** read `.agents/skills/copilotkit-foundry-scaffold/SKILL.md` in full. It is
   the scaffold recipe and hands off to `copilotkit-foundry-hitl` for everything
   after the initial customization.
2. **Scaffold:** `scripts/new-app.sh <app-name> [target-dir]` instantiates the
   canonical template (`templates/agentic-copilot-foundry/`) into a new, runnable
   app and rewrites the agent-name tokens consistently.
3. **Customize to the prompt:** edit only the marked extension points —
   `src/agent.py` (instructions + tools: at least one read tool and at least one
   `@tool(approval_mode="always_require")` consequential tool; `AGENT_STATE_SCHEMA`/
   `AGENT_PREDICT_STATE` for shared/predictive state) and `frontend/components/`
   (CopilotKit v2 cards). Keep `backend/{bridge_app,hosted_proxy,hosted_client}.py`,
   `build_hosted_agent()` (FoundryChatClient), the CopilotKit route, and the HITL
   `confirm_changes` contract **unchanged**.
4. **Prove it:** from the new app, run `make verify` (structural),
   `make smoke` (protocol), and `make e2e` (real Chromium UI). The latter two
   drive the REAL agent locally via `azd ai agent run` and need `az login` + a
   provisioned project. All three MUST pass.
5. **Run / deploy (optional):** `make local` for the dev loop; `make up` to deploy
   the hosted Foundry agent via `azd` (needs `az login` to the Foundry tenant).
6. **Continue development with the Day-2 skill:** for any change beyond the initial
   customization, load `.agents/skills/copilotkit-foundry-hitl/SKILL.md` and pick a
   workflow.

**Golden rule:** `azd` reporting SUCCESS, the dev server starting, or one chat
message answering is **not** proof. The app is done only when `make verify`,
`make smoke`, and `make e2e` pass. Never declare success on an unverified build.

## Maintaining the gallery

- Add a template: `scripts/new-template.sh <name> "<Display Name>" "<description>"`.
- Regenerate manifests + the README table: `node scripts/generate-manifest.mjs`
  (check with `--check`). Do not hand-edit generated manifest content.
- **The entire `copilotkit-foundry-hitl` dev skill (its `SKILL.md`, `references/*`,
  and `workflows/*`) is single-sourced at the root skill
  (`.agents/skills/copilotkit-foundry-hitl/`) and copied into each template by
  `scripts/sync-skill-refs.sh`.** It is domain-agnostic, so every template ships a
  byte-identical copy. Edit the root copy, never a template's copy directly, then run
  `scripts/sync-skill-refs.sh` (or `make sync-skill-refs`) to push the change out;
  `make check` / `scripts/sync-skill-refs.sh --check` fails if a template's copy has
  drifted (or has a stray file). The `copilotkit-foundry-scaffold` skill's `SKILL.md` is
  **NOT synced** — its content is intentionally different per copy (root =
  build-a-new-app framing; each template's copy = customize/run/deploy-this-app
  framing) and stays hand-authored. The scaffold skill has no `references/`; those
  moved to the dev skill.
- `docs/template-guidelines.md` defines the required template structure.
- `docs/single-prompt-workflow.md` is the long-form of the build workflow above.

## Docs / lookups

- The `.mcp.json` server (Microsoft Learn) covers Azure AI Foundry + Agent
  Framework. CopilotKit / AG-UI specifics live in the dev skill's `references/`
  (`.agents/skills/copilotkit-foundry-hitl/references/`).
- Keep skill content concise and **domain-agnostic** — never hard-code a specific
  app's names, endpoints, or secrets. No secrets anywhere.

## Conventions

- Directory name == template identity. Lowercase, hyphens.
- **Foundry HOSTED agent + HITL-forwarding bridge.** All tools + HITL + history run
  in the deployed Foundry hosted agent (`build_hosted_agent()` → **FoundryChatClient**,
  Responses). The Container App bridge (`backend/bridge_app.py` → `HostedProxyAgent`)
  forwards each turn to it and forwards `mcp_approval_response` on HITL approve so the
  gated tool re-executes server-side — the native
  `add_agent_framework_fastapi_endpoint(FoundryAgent)` path can't (verified live).
  For local dev, `azd ai agent run` runs the SAME agent (`FoundryChatClient`,
  Responses) on your machine, connected to your Foundry project's model; `make local`
  and `make smoke` point the bridge at it (DIRECT mode) — no mock anywhere.
  CopilotKit (**v2** hooks) is UI only.
- Container images use **MCR** base images, never Docker Hub (ACR Tasks rate-limit).
