<div align="center">

# ⚒︎ forgewright

**Build a complete CopilotKit + AG-UI + Azure AI Foundry hosted-agent app from a single prompt — with human-in-the-loop approval built in.**

A template gallery for agentic apps using Microsoft Agent Framework + CopilotKit + Foundry stack instead of Fabric.

</div>

---

## What is this?

forgewright is a **template gallery + agent skill**. Point a coding agent
(GitHub Copilot CLI, Claude Code, …) at this repo and ask for an app:

> *"Build me an assistant that can look up an order and issue a refund, but make
> the refund require my approval first."*

The agent reads `AGENTS.md` → loads `.agents/skills/forgewright/SKILL.md` →
scaffolds the canonical template → customizes the agent's tools and the chat UI →
and proves it with `make verify` + `make smoke` (offline, no Azure). You get a
running Next.js + CopilotKit UI over a FastAPI/AG-UI backend hosting one
Microsoft Agent Framework agent, connected **keyless** to Azure AI Foundry, with
**native human-in-the-loop approval** on every consequential tool — and a
one-command `azd up` to publish it as a Foundry **hosted agent**.

```
 Next.js + CopilotKit ──SSE──▶ FastAPI + AG-UI ──▶ MAF agent ──▶ Azure AI Foundry
   confirm_changes HITL card     4 resilience patches   approval_mode="always_require"
                                                          │
                                                  azd up  ▼  Foundry hosted agent (Responses)
```

## Quick start

```bash
# From this repo, scaffold an app from the canonical template:
scripts/new-app.sh my-app ~/projects

cd ~/projects/my-app
make verify      # structural checks (no network)
make smoke       # offline end-to-end HITL test — read works, action PAUSES,
                 # approve executes, reject doesn't (LLM_MODE=mock, no Azure)
make local       # dev loop: backend :8080 + frontend :3000
make up          # deploy the hosted Foundry agent via azd
```

Then edit `src/agent.py` (tools + instructions) and
`frontend/components/Chat.tsx` (render cards) to fit your domain. Keep the four
AG-UI resilience patches, the CopilotKit bridge, and the HITL contract as
shipped — see `.agents/skills/forgewright/SKILL.md`.

## Why these choices

- **Keyless Foundry, Chat Completions (not Responses)** — HITL approve-resume
  400s on the Responses API; the template uses `OpenAIChatCompletionClient`
  against `{FOUNDRY_PROJECT_ENDPOINT}/openai/v1` with `DefaultAzureCredential`.
- **Four AG-UI resilience patches** — so generative cards survive snapshots,
  approval cards render immediately, and replayed history never orphans a tool
  call. All baked in and verified.
- **Offline smoke** — `LLM_MODE=mock` runs the *entire* SSE + HITL path with no
  model and no Azure, so `make smoke` is CI-able and proof, not faith.

## Live showcase

[`showcase/`](showcase/) is a self-contained **portfolio demo**: a tiny static
gallery (GitHub Pages) that talks over **AG-UI/SSE** to **one always-on Container
App** fronting every template agent — click *Try it* to chat in your browser,
click *View source* to land on the template here. It runs the templates as-is
(no forks) and never touches `templates/`. See [`showcase/README.md`](showcase/README.md).

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
templates/<name>/             each template: a complete, runnable app + manifest.json
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

## License

[MIT](LICENSE)
