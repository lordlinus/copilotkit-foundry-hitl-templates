# Template guidelines

Use this when adding a new template under `templates/` (via
`scripts/new-template.sh`).

## Location and naming

- Each template lives in `templates/<template-name>/` (kebab-case).
- `manifest.json.templateId` MUST equal the directory name.
- The agent runtime name (`AGENT_NAME` in `src/agent.py`) is snake_case and MUST
  match the CopilotKit `agent=` prop and the route's `AGENT_NAME` const. The
  hosted name (`hosted/azure.yaml`, `agent.yaml`, `agent.manifest.yaml`) is the
  kebab-case template/app name. `scripts/verify.sh` enforces both.

## Required files

A template is a complete, runnable app:

| Path | Purpose |
| --- | --- |
| `manifest.json` | `templateId`, `displayName`, `description`, `stack`, `services`, `tokens` |
| `src/agent.py` | ONE MAF agent; ≥1 read tool + ≥1 `approval_mode="always_require"` tool; `build_chat_client()` |
| `src/mock_client.py` | offline deterministic client for `LLM_MODE=mock` |
| `backend/ag_ui_app.py` | FastAPI + AG-UI + the four resilience patches |
| `backend/requirements.txt`, `backend/Dockerfile` | pinned deps; MCR base |
| `hosted/azure.yaml`, `hosted/responses/{main.py,Dockerfile,agent.yaml,agent.manifest.yaml}` | azd → Foundry hosted agent |
| `frontend/` | Next.js + CopilotKit (catch-all route, `useSingleEndpoint={false}`, `confirm_changes` action) |
| `scripts/verify.sh`, `scripts/smoke.py`, `scripts/smoke_run.sh`, `scripts/lib.sh` | the proof |
| `Makefile` + `Makefile.targets`, `run-local.sh`, `README.md`, `.gitignore` | flow + docs |
| `AGENTS.md`, `.agents/skills/forgewright/SKILL.md` (+ `references/`), `.mcp.json` | self-contained agent guidance |

## Non-negotiables (the compatibility contract)

A template MUST NOT break these — `scripts/verify.sh` checks them:

1. **Chat Completions, not Responses** (`OpenAIChatCompletionClient`); never the
   Responses-API `OpenAIChatClient` (HITL approve-resume 400s).
2. **Keyless Foundry** via `DefaultAzureCredential` with the
   `https://ai.azure.com/.default` audience.
3. **The four AG-UI resilience patches** present in `backend/ag_ui_app.py`.
4. **The CopilotKit bridge**: catch-all `[[...slug]]`, `@copilotkit/runtime/v2`,
   `createCopilotHonoHandler`, POST/GET/PATCH/DELETE exports,
   `useSingleEndpoint={false}`.
5. **The HITL contract**: `confirm_changes` action, `available:"disabled"`,
   `renderAndWaitForResponse`, `{accepted, steps}` response shape.
6. **MCR base images** (never Docker Hub).
7. **An offline `make smoke`** that proves read + pause + approve + reject + C9 + C10.
8. **Name consistency** across agent.py / route / provider / hosted yaml.

## After changes

Run `node scripts/generate-manifest.mjs` to refresh `forgewright-template.yml`
(root + leaf) and the README table. CI/`make check` runs `--check`.

## README expectations

Each template README has **Getting started**, **Project structure**, and
**Scripts** sections, plus the Definition of Done.
