# Agentic CopilotKit + Foundry (HITL)

A domain-agnostic starter: a **Next.js + CopilotKit v2** chat UI over an **AG-UI
bridge** to an **Azure AI Foundry HOSTED agent** that runs all tools, history, and
**human-in-the-loop approval** server-side. The bridge (`backend/bridge_app.py` →
`HostedProxyAgent`) forwards each turn to the hosted agent over the Responses
protocol and forwards the HITL decision as an `mcp_approval_response`, so an
approved tool **re-executes server-side** (verified live). For local dev,
`azd ai agent run` runs the SAME agent on your machine and the bridge points at it
(DIRECT mode) — no mock.

The demo agent holds a single numeric value: `get_value` reads it (no approval);
`apply_delta` changes it (approval-gated). Replace these with your domain.

## Getting started

```bash
make verify       # read-only structural checks — green before you touch anything

# One-time setup — everything below needs Azure (azd keeps its own credential,
# so BOTH logins are needed):
az login && azd auth login

# Provision + deploy the hosted Foundry agent. The first run prompts for an
# env name, subscription, and location, and creates hosted/.azure/:
make up   # only some Azure regions support Foundry hosted agents (e.g. East US 2,
          # Sweden Central, Canada Central) — this fails fast with the full list
          # if the azd env's region doesn't support them

# Prove it — the REAL agent running locally (no mock), via `azd ai agent run`,
# which reuses the project `make up` just provisioned — no extra manual step:
make smoke        # bridge → REAL agent via `azd ai agent run`; asserts the HITL flow
make e2e          # built CopilotKit UI in Chromium: read/reject/approve/follow-up

# Local dev loop:
make local        # REAL agent (azd ai agent run) + bridge :8080 + frontend :3000

# Deploy the bridge + frontend as two Container Apps, wired keyless to the
# agent `make up` deployed, then prove the deployment is real:
make up-app
make verify-deployed   # a REAL active Foundry agent answers a live invoke

# Tear it all down (deletes every resource make up / make up-app created, and
# purges soft-deleted resources so the same names can be reused):
make down
```

`make doctor` checks every prerequisite (tools, logins, azd envs, ports) with the
fix for each failure — run it first when anything fails. If `make smoke` fails on
assertions with no visible error, the agent's own log is
`/tmp/forge-agent.log` — a 403 `…agents/write` there means the signed-in identity
lacks the **Azure AI User** role on the Foundry project. "Already in use" / "bridge
not ready" means stale processes: `fuser -k 8080/tcp 8088/tcp 3000/tcp`.

Open http://localhost:3000 and try: *"what's the current value?"* then
*"apply a delta of 25"* — the change pauses for your Approve/Reject.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent. `build_hosted_agent()` → **FoundryChatClient** (the single brain — same code local + deployed). **Edit tools + instructions.** |
| `backend/bridge_app.py` | The AG-UI server → `HostedProxyAgent` (DIRECT local / platform deployed). **Don't edit.** |
| `backend/hosted_proxy.py` | `HostedProxyAgent`: forward turns → hosted agent, translate Responses → AG-UI, forward `mcp_approval_response`. **Don't edit.** |
| `backend/hosted_client.py` | Streaming Responses driver (per-thread conversation + session). **Don't edit.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
| `frontend/app/page.tsx` | `<CopilotKit useSingleEndpoint={false} agent=...>`. |
| `frontend/components/Chat.tsx` | CopilotKit v2 cards: `useHumanInTheLoop` (HITL) + `useRenderTool`. **Edit render cards.** |
| `hosted/` | `azd` → Foundry hosted agent (Responses). `build_hosted_agent()`. |
| `deploy/` | `azd` → the bridge + frontend as two Container Apps (`make up-app`), wired keyless to the deployed hosted agent. |
| `scripts/verify.sh`, `scripts/smoke.py` | The proof: structural + end-to-end vs the real local agent. |

## Scripts (make targets)

| Target | Does |
| --- | --- |
| `make doctor` | check tools, logins, azd envs, ports — with the fix for each failure |
| `make preflight` | install backend venv + frontend deps |
| `make local` | run bridge + frontend |
| `make verify` | read-only structural checks |
| `make smoke` | end-to-end HITL test against the REAL agent (`azd ai agent run`) |
| `make e2e` | real-browser HITL journey against the REAL agent |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make up-app` / `make deploy-app` | `azd up` / `azd deploy` the bridge + frontend Container Apps (`deploy/`) |
| `make verify-deployed` | deployment gate: the hosted agent is `active` in Foundry and a live invoke reaches it |
| `make down` | tear down ALL provisioned Azure resources (`deploy/` then `hosted/`, purging soft-deletes) |
| `make clean` | remove venv / node_modules / .next |

## Definition of Done

Not done until `make verify`, `make smoke`, **and** `make e2e` are green, and — for the deployed
path — `make verify-deployed` passes and a live browser E2E shows HITL approve
re-executing (state changes) and reject not. See
`.agents/skills/copilotkit-foundry-hitl/SKILL.md`.
