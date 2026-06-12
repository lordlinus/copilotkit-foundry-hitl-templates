# AGENTS.md — forgewright

This repository is the **forgewright** template gallery — *not* a single app. It
teaches a coding agent to build a **complete CopilotKit + AG-UI + Foundry hosted
agent application from a single prompt**, with native human-in-the-loop approval.

## Build an app from one prompt (the core workflow)

When the user asks for an agentic app ("build me an app that …", "an assistant
that can … with approval before …"), do this — do not hand the user manual steps:

1. **Load the skill:** read `.agents/skills/forgewright/SKILL.md` in full. It is
   the build recipe, the load-bearing rules, the anti-patterns, and the
   Definition of Done.
2. **Scaffold:** `scripts/new-app.sh <app-name> [target-dir]` instantiates the
   canonical template (`templates/agentic-copilot-foundry/`) into a new, runnable
   app and rewrites the agent-name tokens consistently.
3. **Customize to the prompt:** edit only the marked extension points —
   `src/agent.py` (instructions + tools: at least one read tool and at least one
   `@tool(approval_mode="always_require")` consequential tool) and
   `frontend/components/Chat.tsx` (render cards for your tools). Keep the four
   AG-UI resilience patches, the CopilotKit bridge, and the HITL `confirm_changes`
   contract **unchanged**.
4. **Prove it:** from the new app, run `make verify` (structural) and
   `make smoke` (offline, `LLM_MODE=mock`, no Azure). Both MUST pass.
5. **Run / deploy (optional):** `make local` for the dev loop; `make up` to deploy
   the hosted Foundry agent via `azd` (needs `az login` to the Foundry tenant).

**Golden rule:** `azd` reporting SUCCESS, the dev server starting, or one chat
message answering is **not** proof. The app is done only when `make verify` and
`make smoke` pass. Never declare success on an unverified build.

## Maintaining the gallery

- Add a template: `scripts/new-template.sh <name> "<Display Name>" "<description>"`.
- Regenerate manifests + the README table: `node scripts/generate-manifest.mjs`
  (check with `--check`). Do not hand-edit generated manifest content.
- `docs/template-guidelines.md` defines the required template structure.
- `docs/single-prompt-workflow.md` is the long-form of the build workflow above.

## Docs / lookups

- The `.mcp.json` server (Microsoft Learn) covers Azure AI Foundry + Agent
  Framework. CopilotKit / AG-UI specifics live in the skill's `references/`.
- Keep skill content concise and **domain-agnostic** — never hard-code a specific
  app's names, endpoints, or secrets. No secrets anywhere.

## Conventions

- Directory name == template identity. Lowercase, hyphens.
- Connection to Foundry is **keyless** (DefaultAzureCredential), Chat Completions
  (NOT the Responses API) so HITL approve-resume does not 400.
- Container images use **MCR** base images, never Docker Hub (ACR Tasks rate-limit).
