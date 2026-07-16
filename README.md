<div align="center">

# CopilotKit + Foundry HITL Templates

**Build a CopilotKit chat app on an Azure AI Foundry hosted agent — with human-in-the-loop approval.**

</div>

---

Scaffold a complete, runnable app — **Next.js + CopilotKit v2** UI, an **Azure AI
Foundry hosted agent** running all tools and **Approve/Reject gates** server-side,
`azd` deploys, and end-to-end tests — then describe your domain to a coding agent
(GitHub Copilot CLI, Claude Code, …) and it customizes the template for you:

> *"Build me an assistant that can look up an order and issue a refund, but make
> the refund require my approval first."*

This page is just the quick start. Architecture, why the AG-UI bridge exists,
design rationale, and how everything is verified:
**[DETAILED_README.md](DETAILED_README.md)**.

## Quick start

You need: `git`, `make`, [`uv`](https://docs.astral.sh/uv/), Node.js ≥ 22,
Azure CLI (`az`) + [Azure Developer CLI (`azd`)](https://aka.ms/azd), and an Azure
subscription with [Azure AI Foundry](https://ai.azure.com) access. Optional:
[GitHub Copilot CLI](https://github.com/github/copilot-cli) to customize the
scaffold from a prompt.

### 1. Scaffold an app

```bash
git clone https://github.com/lordlinus/copilotkit-foundry-hitl-templates
cd copilotkit-foundry-hitl-templates
./scripts/new-app.sh my-app ~/projects
cd ~/projects/my-app
make                                   # prints the full numbered path
make verify                            # offline structural gate — green from the start
```

### 2. Make it yours (optional)

```bash
copilot    # reads AGENTS.md + the embedded skills; describe the app you want
```

Or skip this and run the demo agent as-is first.

### 3. Run it

```bash
az login && azd auth login   # once — azd keeps its own credential, both are needed
make up                      # provision + deploy the hosted Foundry agent
make smoke                   # proves the HITL flow end-to-end against the REAL agent,
                             # run locally (reuses the project 'make up' just provisioned)
make local                   # open http://localhost:3000 and chat
```

Try: *"what's the current value?"* then *"apply a delta of 25"* — the change
pauses for your Approve/Reject.

### 4. Ship it

```bash
make up-app            # deploy the bridge + frontend as Container Apps
make verify-deployed   # a REAL active Foundry agent answers a live invoke
```

**Stuck?** `make doctor` checks every prerequisite (tools, logins, azd envs,
ports) and prints the fix next to each failure. More in the
[troubleshooting section](DETAILED_README.md#if-something-fails).

## Templates

<!-- TEMPLATES:START -->
| Template | Description | Stack |
| --- | --- | --- |
| **[Agentic CopilotKit + Foundry (HITL)](templates/agentic-copilot-foundry)** | A Next.js/CopilotKit chat UI over a FastAPI/AG-UI SSE backend hosting one Microsoft Agent Framework agent, connected keyless to Azure AI Foundry, with native human-in-the-loop approval on consequential tools. Also publishable as a Foundry hosted agent (Responses) via azd. | Next.js, CopilotKit, AG-UI, Microsoft Agent Framework, Azure AI Foundry |
| **[Conversational Banking (HITL)](templates/conversational-banking)** | A conversational banking assistant: check balances and recent activity freely, but every money movement (transfer, bill pay) pauses on an Approve/Reject widget before it executes. CopilotKit + AG-UI over one Microsoft Agent Framework agent, keyless to Azure AI Foundry; also publishable as a Foundry hosted agent via azd. | Next.js, CopilotKit, AG-UI, Microsoft Agent Framework, Azure AI Foundry |
| **[Health Insurance Claim Intake (HITL)](templates/health-claim-intake)** | Intake multiple claim documents, auto-fill the claim form, let the user review and edit, then submit to the insurer behind a human-in-the-loop approval gate. CopilotKit + AG-UI over one Microsoft Agent Framework agent, keyless to Azure AI Foundry; also publishable as a Foundry hosted agent via azd. | Next.js, CopilotKit, AG-UI, Microsoft Agent Framework, Azure AI Foundry |
<!-- TEMPLATES:END -->

Try them live in the browser: [`showcase/`](showcase/).

## License

[MIT](LICENSE)
