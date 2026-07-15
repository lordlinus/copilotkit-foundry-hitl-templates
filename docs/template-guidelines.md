# Template guidelines

Use this when adding a new template under `templates/` (via
`scripts/new-template.sh`).

## Location and naming

- Each template lives in `templates/<template-name>/` (kebab-case).
- `manifest.json.templateId` MUST equal the directory name.
- The agent runtime name (`AGENT_NAME` in `src/agent.py`) is snake_case and MUST
  match the CopilotKit `agent=` prop and the route's `AGENT_NAME` const. The
  hosted name (top-level `name:` + the inline agent `name:` in `azure.yaml` and
  `hosted/azure.yaml`) is the kebab-case template/app name. `scripts/verify.sh` enforces both.

## Required files

A template is a complete, runnable app:

| Path | Purpose |
| --- | --- |
| `manifest.json` | `templateId`, `displayName`, `description`, `stack`, `services`, `tokens` |
| `src/agent.py` | ONE MAF agent; ≥1 read tool + ≥1 `approval_mode="always_require"` tool; `build_hosted_agent()` (FoundryChatClient) |
| `backend/bridge_app.py` | AG-UI server → `HostedProxyAgent` (DIRECT local / platform deployed) |
| `backend/{hosted_proxy,hosted_client}.py` | the bridge: forward turns + `mcp_approval_response` to the hosted agent |
| `backend/requirements.txt`, `backend/Dockerfile` | pinned deps; MCR base |
| `hosted/azure.yaml` (inline agent definition), `hosted/responses/{main.py,Dockerfile}` | azd → Foundry hosted agent |
| `frontend/` | Next.js + CopilotKit v2 (catch-all route, `useSingleEndpoint={false}`, `useHumanInTheLoop`/`confirm_changes`) |
| `scripts/verify.sh`, `scripts/smoke.py`, `scripts/smoke_run.sh`, `scripts/lib-agentrun.sh`, `scripts/lib.sh` | the proof |
| `frontend/e2e/hitl.spec.ts`, `frontend/playwright.config.ts`, `scripts/e2e_run.sh` | real-browser proof of read + approve + reject + follow-up |
| `Makefile` + `Makefile.targets`, `run-local.sh`, `README.md`, `.gitignore` | flow + docs |
| `AGENTS.md`, `.agents/skills/copilotkit-foundry-scaffold/SKILL.md` (scaffold on-ramp), `.agents/skills/copilotkit-foundry-hitl/` (Day-2 dev skill: `SKILL.md` + `references/` + `workflows/`, synced), `.mcp.json` | self-contained agent guidance |

## Non-negotiables (the compatibility contract)

A template MUST NOT break these — `scripts/verify.sh` checks them:

1. **Hosted agent uses `FoundryChatClient` (Responses)** in `build_hosted_agent` —
   so HITL `mcp_approval_response` re-executes the gated tool server-side. The SAME
   agent runs locally (`azd ai agent run`) and deployed (`azd up`); never the
   Responses-API `OpenAIChatClient`.
2. **Keyless Foundry** via `DefaultAzureCredential` with the
   `https://ai.azure.com/.default` audience.
3. **The bridge** (`bridge_app.py` → `HostedProxyAgent`) forwards each turn AND
   `mcp_approval_response`; `bridge_app.py` routes HITL to the hosted
   agent (not local) + splits multi-tool snapshots.
4. **The CopilotKit bridge**: catch-all `[[...slug]]`, `@copilotkit/runtime/v2`,
   `createCopilotHonoHandler`, POST/GET/PATCH/DELETE exports,
   `useSingleEndpoint={false}`.
5. **The HITL contract**: `confirm_changes` surfaced; UI resolves via
   `useHumanInTheLoop` with `{accepted, steps}`.
6. **MCR base images** (never Docker Hub).
7. **A `make smoke`** (bridge → REAL agent via `azd ai agent run`) that proves read
   + pause + approve + reject + C9/C10/C11/C12 (including persistent approved-action
   cards in the final snapshot).
8. **A `make e2e`** that drives the built CopilotKit UI in Chromium through read,
   approve, reject, and a same-thread post-approval follow-up.
9. **Name consistency** across agent.py / route / provider / hosted yaml.

## After changes

Run `node scripts/generate-manifest.mjs` to refresh `template-manifest.yml`
(root + leaf) and the README table. CI/`make check` runs `--check`.

## README expectations

Each template README has **Getting started**, **Project structure**, and
**Scripts** sections, plus the Definition of Done.
