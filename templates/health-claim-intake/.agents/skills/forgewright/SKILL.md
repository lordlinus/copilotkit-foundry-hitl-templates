---
name: forgewright
description: "Use when customizing, running, verifying, or deploying THIS forgewright app — a Next.js/CopilotKit UI over a FastAPI/AG-UI SSE backend hosting one Microsoft Agent Framework agent on Azure AI Foundry, with human-in-the-loop approval. Triggers: agent.py, ag_ui_app.py, confirm_changes, approval_mode always_require, CopilotKit route, make smoke, make verify, make up, Foundry hosted agent. Also use for the known traps — HITL approve-resume 400 'No tool output found', cards vanishing, [[...slug]] Threads 404/422, useSingleEndpoint, keyless Foundry 401 audience, Docker Hub rate-limit."
metadata:
  author: forgewright
  version: "0.1.0"
---

# forgewright app — customize, verify, deploy

This app: Next.js + CopilotKit UI → FastAPI + AG-UI (SSE) → ONE Microsoft Agent
Framework agent → Azure AI Foundry (keyless), with native human-in-the-loop
approval. The same agent is publishable as a Foundry hosted agent via `azd`.

**Golden rule:** the dev server starting, `azd` SUCCESS, or one chat reply is
**not** proof. Done only when `make verify` AND `make smoke` pass.

## 0. Orient

- `LOAD references/architecture.md` — what lives where.
- `LOAD references/troubleshooting.md` — every known trap → symptom → fix.

## 1. Customize — ONLY these extension points

`src/agent.py`:
- `_INSTRUCTIONS` — behavior for your domain.
- Tools — keep ≥1 read tool and ≥1 `@tool(approval_mode="always_require")`
  consequential tool. Map "needs approval before X" to the gated tool.
- If you rename tools, update `src/mock_client.py` (READ_TOOL / ACTION_TOOL /
  keywords) and `scripts/smoke.py` (READ_PROMPT / ACTION_PROMPT / STATE_FIELD /
  READ_TOOL) so `make smoke` still exercises the HITL gate.

`frontend/components/Chat.tsx`:
- Add/adjust `useCopilotAction` render cards. Keep the `confirm_changes` action
  exactly as shipped.

**Do NOT touch:** the four AG-UI patches in `backend/ag_ui_app.py`, the bridge in
`frontend/app/api/copilotkit/[[...slug]]/route.ts`, or `build_chat_client()`.

## 2. Prove it (no Azure)

```bash
make verify     # structural: patches, bridge, HITL contract, name consistency, MCR base
make smoke      # offline E2E: read works; action PAUSES; approve executes; reject doesn't; C9 + C10
```

## 3. Run / deploy

```bash
make local      # backend :8080 + frontend :3000 (LLM_MODE=mock works offline)
make up         # azd → Foundry hosted agent (needs az login to the Foundry tenant)
```

## Load-bearing rules

- **Keyless Foundry, Chat Completions (NOT Responses).** `DefaultAzureCredential`
  + `ai.azure.com/.default` audience → `OpenAIChatCompletionClient(base_url=
  "{FOUNDRY_PROJECT_ENDPOINT}/openai/v1")`. The Responses client 400s on HITL
  approve-resume ("No tool output found").
- **HITL contract:** the gated tool surfaces as `confirm_changes`; the UI resolves
  with `{ accepted: boolean, steps }` (NOT `{ approved }`); action is
  `available:"disabled"` + `renderAndWaitForResponse`.
- **Four AG-UI patches** are mandatory with any HITL tool (collisions; split
  multi-tool snapshot; fresh `parent_message_id`; journal result + scrub payload;
  orphan repair).
- **CopilotKit bridge:** catch-all `[[...slug]]`; `@copilotkit/runtime/v2`;
  `createCopilotHonoHandler`; export POST/GET/PATCH/DELETE;
  `useSingleEndpoint={false}`.
- **Mock client** subclasses `FunctionInvocationLayer, BaseChatClient` (the Agent
  skips tool execution for a plain `BaseChatClient`).
- **MCR base images** only (Docker Hub rate-limits ACR builds).

## Definition of Done

- [ ] `make verify` green.
- [ ] `make smoke` green (read; action PAUSES & doesn't execute; approve executes;
      reject doesn't; C9; C10).
- [ ] ≥1 read tool and ≥1 `approval_mode="always_require"` tool in `src/agent.py`.
- [ ] Agent name consistent across `agent.py`, route, provider, hosted yaml.
- [ ] No secrets / endpoints / app-specific hard-coding committed.
- [ ] (If deploying) `make up` succeeds AND a live action pauses for approval.
