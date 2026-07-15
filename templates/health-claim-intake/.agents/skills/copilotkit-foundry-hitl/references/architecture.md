# Architecture — Foundry hosted agent + CopilotKit, via a HITL-forwarding bridge

**Goal:** an Azure AI Foundry HOSTED agent (all tools + HITL + history server-side)
with a CopilotKit UI showing rich generative UI — tool-render cards, human-in-the-
loop approval, shared/predictive state.

**Why a bridge at all:** you **cannot** point `@ag-ui/client` at a deployed hosted
agent — its endpoint speaks the OpenAI **Responses** protocol, not AG-UI. AND the
framework's *native* path (`add_agent_framework_fastapi_endpoint(FoundryAgent(...))`)
resolves the HITL `confirm_changes` **locally** and never forwards the approval, so
the gated tool **does not re-execute** (verified live). So the bridge is a small
hand-rolled forwarder: it translates Responses→AG-UI AND forwards the HITL decision
as an `mcp_approval_response`, which re-executes the tool server-side.

```
 Browser — Next.js + CopilotKit (v2 hooks)
   useAgent / useFrontendTool / useRenderTool / useHumanInTheLoop
   app/api/copilotkit/[[...slug]]/route.ts  (CopilotSseRuntime + HttpAgent)
        │  AG-UI / SSE
        ▼
 BRIDGE  (Container App — backend/bridge_app.py)
   LOCAL/DEPLOYED: HostedProxyAgent (SupportsAgentRun) — forwards each turn to the
              hosted agent (hosted_client, streaming Responses), translates → AG-UI
              (text, tool cards, confirm_changes), and forwards mcp_approval_response
              on approve (bridge_app patches neutralise ag-ui's local interception).
   LOCAL DEV: `azd ai agent run` runs the agent on your machine; bridge → DIRECT
              mode (HOSTED_AGENT_DIRECT_URL). DEPLOYED: bridge → platform mode. No mock.
        │  POST .../agents/<name>/endpoint/protocols/openai/responses (stream)
        ▼
 FOUNDRY HOSTED AGENT  (the brain — azd → host: azure.ai.agent)
   src/agent.py build_hosted_agent(): FoundryChatClient (Responses), store=False
   ALL @tools + @tool(approval_mode="always_require") HITL + history server-side
```

## Validated live (deployed agent agentic-copilot-foundry, swec-proj-default)

- Read tool → runs server-side; tool-render card in AG-UI.
- HITL trigger → `mcp_approval_request` → bridge surfaces `confirm_changes` (pause).
- **Approve → bridge sends `mcp_approval_response{approve:true}` → tool re-executes
  server-side, state changes (100→125).** No "No tool output found".
- Reject → `approve:false` → tool does NOT execute (state unchanged).
- Two gotchas found live: the bridge must NOT send `x-ms-user-isolation-key`
  (deployed agents use Entra isolation → 400); and `build_hosted_agent` MUST use
  `FoundryChatClient` (Chat Completions 500s on hosted approve-resume).

## Why the bridge is the MINIMUM (native-path test matrix)

Is the hand-rolled bridge over-engineering? We tested every alternative against the
real agent. Matrix last run on agent-framework-core 1.9.0 / agent-framework-foundry
1.8.2 / agent-framework-ag-ui 1.0.0rc5 (`make smoke` = 15 assertions: read, HITL
pause, approve re-executes, reject, C9, C10):

| Configuration | Result |
| --- | --- |
| **Bridge (HostedProxyAgent + 2 patches)** | **Smoke + real Chromium E2E ✓** — reconfirmed live 2026-07-14 on agent-framework-core 1.11.0, foundry 1.10.1, ag-ui 1.0.0rc8, hosting 1.0.0a260709 (protocol v2.0), including C12 persistent post-approval action cards |
| Bridge, HITL approval routing patch removed | approve does NOT change state ✗ — patch REQUIRED |
| Bridge, `DISABLE_C9_SPLIT=1` | C9 fails (snapshot lumps multiple tool_calls) ✗ — split REQUIRED |
| Native `add_agent_framework_fastapi_endpoint(FoundryAgent(...))` | 400 "Hosted agents can only be called through the agent endpoint" ✗ |
| Native + `allow_preview=True` | surfaces the approval, but **approve does NOT re-execute** (state unchanged); C9 fails ✗ |
| Native + `allow_preview=True` + the 2 patches | **still** approve does NOT re-execute ✗ |

The alternative-configuration rows (patches removed, native path) were not re-run on
the v2.0 stack — #6652/#6828/#6851 are still open upstream (see below), so there is no
reason to expect those outcomes changed, and re-running them would just burn more
live Foundry calls to reconfirm a known negative. Re-run the full matrix, not just the
top row, once any of those issues closes.

**Conclusion:** the native `FoundryAgent` client has no client-side
`mcp_approval_response` — it cannot complete hosted HITL no matter how it's
configured. We still use `agent-framework-ag-ui` (`add_agent_framework_fastapi_endpoint`)
for the AG-UI translation; we just feed it a `SupportsAgentRun` shim
(`HostedProxyAgent`) that forwards the approval, plus two ag-ui patches `make smoke`
proves are load-bearing. Nothing else is hand-rolled. **Tracked upstream as
[microsoft/agent-framework#6652](https://github.com/microsoft/agent-framework/issues/6652)**
(still **OPEN** as of 2026-07-06) — re-run this matrix on each package bump and
retire the shim + the HITL-routing patch the moment #6652 closes (the native
`FoundryAgent` path then suffices).

### Upstream status (last checked 2026-07-14)

| Issue | Title | State | Notes |
| --- | --- | --- | --- |
| [#6652](https://github.com/microsoft/agent-framework/issues/6652) | AG-UI adapter should forward HITL approval to a hosted/remote agent | **OPEN** | No PR yet. This is why `HostedProxyAgent` exists at all. |
| [#6828](https://github.com/microsoft/agent-framework/issues/6828) | `confirm_changes` tool chip reverts to "in progress" after completing | **OPEN** | Fix PR [#6829](https://github.com/microsoft/agent-framework/pull/6829) was opened and then **closed without merging** — no replacement has landed as of rc8. |
| [#6851](https://github.com/microsoft/agent-framework/issues/6851) | Approval-gated tool silently re-executes on a later unrelated turn (duplicate side effect) | **OPEN** | The severe variant of #6828's root cause. Mitigated for DIRECT mode only in `hosted_client.py` (see troubleshooting.md); PLATFORM mode is unproven. |

None of the three have a merged fix as of `agent-framework-ag-ui` 1.0.0rc8 /
`agent-framework-core` 1.11.0 / `agent-framework-foundry` 1.10.1 — **keep both bridge patches
and the `hosted_client.py` DIRECT-mode mitigation.** Do not remove any of them on
the strength of a package bump alone; re-run this matrix and check the issues first.

## Protocol v2.0 (adopted 2026-07-06)

The hosted agent now runs the Foundry hosted-agent **Responses protocol v2.0**
(`agent-framework-foundry-hosting==1.0.0a260709`, with v2.0 introduced in
[microsoft/agent-framework#6811](https://github.com/microsoft/agent-framework/pull/6811)
— a **breaking** change vs the prior 1.0.0 protocol). The inline agent
definitions in `azure.yaml` + `hosted/azure.yaml` declare
`protocols[].version: 2.0.0` to match; the package and the declared version
**must** agree, or the hosted runtime fails fast with
`RuntimeError: the hosted environment is running on protocol 1.0.0, but the agent
requires protocol 2.0.0` (raised by `agent_framework_foundry_hosting._responses`
whenever `config.is_hosted` is true and the platform hasn't sent a v2.0 call id).

What v2.0 actually changes (read from the PR diff, not assumed):
- An optional `FoundryToolbox` MCP wrapper for Foundry-hosted toolboxes — **not used**
  by this template (it defines its own `@tool`s).
- Per-user checkpoint/approval file-storage partitioning, keyed off
  `context.platform_context.user_id_key`. That key is populated automatically by the
  `azure-ai-agentserver-*` request-handling layer from the caller's authenticated
  Entra identity — **no bridge code change was needed** for PLATFORM mode. For DIRECT
  mode (`azd ai agent run`) there is no per-user identity, so storage stays at the old
  unscoped layout (the package's own test is literally named
  `test_absent_user_id_uses_unscoped_layout`).
- A version handshake: a v2.0 container invoked by a platform still speaking protocol
  1.0 gets a clear fast-fail instead of a silent 500/misbehavior.

**Verification status (updated 2026-07-06, live):**
- `make verify` (structural, no network) is green on the v2.0 pins in all 3 templates.
- `make smoke` (the live 15-assertion matrix against the real agent via `azd ai agent
  run`, DIRECT mode) is **GREEN, 15/15, confirmed live twice** on the v2.0 pins against
  the deployed Foundry project `swec-proj-default` — read, HITL pause, approve
  re-executes, reject doesn't, C9, C10, **and C11** (the same-thread duplicate-execution
  guard: value stayed flat across 3 follow-up turns after approval). The first attempt
  403'd with `Microsoft.MachineLearningServices/workspaces/agents/action` — initially
  mistaken for a missing RBAC role, but it was this repo's own already-documented trap
  (`az` CLI's active subscription/tenant didn't match the Foundry project's tenant; see
  `troubleshooting.md`'s Foundry-connection table). `az account set --subscription
  <the project's subscription>` (putting the CLI's default tenant in line with
  `AZURE_TENANT_ID` in `.azure/<env>/.env`) fixed it with zero code changes.
- DIRECT mode (`azd ai agent run`) works unchanged on protocol v2.0 — confirmed live
  on **all 3 templates** (`agentic-copilot-foundry`, `conversational-banking`,
  `health-claim-intake`), not just read from the PR diff.
- **Still unverified, and currently BLOCKED (not by the protocol bump):** whether the
  Foundry **platform** service accepts invoking a *deployed* v2.0 container. Attempted
  `make deploy` / `make up` to test this live and hit a separate, pre-existing `azd`
  tooling bug first — packaging fails with `invalid service path ...: relative path
  ".." must not contain '..'` on `hosted/azure.yaml`'s `project: ..` (needed so the
  Docker build context reaches the shared `src/agent.py`). Reproduces with **zero
  changes to `azure.yaml`** on the latest stable `azd` (1.27.0) + `azure.ai.agents`
  extension (1.0.0-beta.4, already up to date) — see `troubleshooting.md`'s
  Containers/azd table for the full repro and what was tried. This blocks live
  PLATFORM-mode verification of ANY change right now, not just this one; it needs its
  own fix (either an azd-side relax of the path check, or restructuring `hosted/` so
  `project` doesn't point outside itself) before a deployed-path live test is possible.

## Client choice (the load-bearing rule)

- **Hosted agent (`build_hosted_agent`) → `FoundryChatClient` (Responses).** Required
  so the hosted runtime's `mcp_approval_request`/`mcp_approval_response` re-executes
  the gated tool. Chat Completions 500s on resume here.
- **Local dev → `azd ai agent run`**: the Foundry extension runs the REAL agent
  (`ResponsesHostServer` + `FoundryChatClient`) on your machine, connected to your
  Foundry project's model. `make smoke`/`make local` point the bridge at it in DIRECT
  mode (`HOSTED_AGENT_DIRECT_URL` → POST `/responses` with `previous_response_id`
  chaining), so it drives the SAME `HostedProxyAgent` path as production. No mock —
  needs `az login` + a provisioned project (`make up` once).

## File map

```
<app>/
├── src/
│   └── agent.py        ONE agent. build_hosted_agent() → FoundryChatClient
│                       (the single brain — same code local + deployed). Read tools
│                       + ≥1 @tool(approval_mode="always_require").
├── backend/            THE BRIDGE (deployed Container App).
│   ├── bridge_app.py        AG-UI endpoint → HostedProxyAgent (DIRECT local /
│   │                        platform deployed). + SSE keepalive + optional API key.
│   ├── hosted_proxy.py      HostedProxyAgent: forward turns + translate Responses →
│   │                        AG-UI; surface confirm_changes; forward mcp_approval_response.
│   ├── hosted_client.py     streaming Responses driver: platform (conversation +
│   │                        agent_session_id, keyless) OR DIRECT (local azd ai agent run).
│   ├── requirements.txt     bridge deps only (httpx pin; no foundry/openai — runs no model).
│   └── Dockerfile           MCR base; deploys uvicorn bridge_app:app.
├── hosted/             azd → Foundry HOSTED agent (Responses) — the deployed brain.
│   ├── azure.yaml      host: azure.ai.agent; azure.ai.agents pinned; context=root.
│   └── responses/      main.py = ResponsesHostServer(build_hosted_agent()), …
├── frontend/           Next.js + CopilotKit v2 (useAgent/useFrontendTool/
│                       useRenderTool/useHumanInTheLoop).
├── scripts/            verify.sh (structural), smoke.py (E2E vs the real local agent),
│                       lib-agentrun.sh (azd ai agent run + bridge DIRECT).
└── Makefile(+.targets) preflight / local / verify / smoke / up / deploy / clean.
```

### The 3 azd projects (unified azure.yaml shape)

There are **three separate azd projects** in one app, each with its own
`azure.yaml`. The two agent projects use the **unified shape** (azd
`azure.ai.agents` >=1.0.0-beta): the agent definition (`kind: hosted`, `name`,
`protocols`, `environmentVariables`) lives INLINE on the `azure.ai.agent`
service entry — there is **no standalone `agent.yaml` or `agent.manifest.yaml`**
(both are deprecated upstream). Nothing cross-reads between the two agent
projects, so keep the shared fields in sync by hand (`scripts/verify.sh` checks
name/protocol-version/model-deployment drift on every `make verify`):

| Project (cwd) | azure.yaml | Run by | Deploys? |
| --- | --- | --- | --- |
| root | `./azure.yaml` — `host: azure.ai.agent`, inline definition + `codeConfiguration`, `startupCommand: python app.py` | `azd ai agent run` (`make local`/`make smoke`) | No — local process only, needs to sit next to `src/` |
| `hosted/` | `hosted/azure.yaml` — same host, inline definition + model `deployments`, `startupCommand: python main.py` | `azd up` (`make up`) | Yes — publishes the Foundry hosted agent |
| `deploy/` | `deploy/azure.yaml` — `host: containerapp`, bridge + frontend services | `azd up` (`make up-app`) | Yes — bridge + frontend, points at the already-deployed hosted agent |

Why root and `hosted/` both exist for the "same" agent: `azd ai agent run` runs
the agent as a local, non-containerized process and needs its `azure.yaml` at
the template root (sibling to `src/`); `azd up` in `hosted/` builds and
publishes the real container image from a different Docker build context. Each
project independently declares `container.resources` (root: local dev sizing;
`hosted/`: real deploy sizing — these are allowed to differ) and both declare
`protocols[].version` (the two **must** be equal — see the "Protocol v2.0"
section for the exact runtime failure this guards against). The hosted project
also pairs `environmentVariables.AZURE_AI_MODEL_DEPLOYMENT_NAME` with its
`deployments[].name` — hardcode the deployment name there; an azd-env `${}`
placeholder resolves to EMPTY when the env doesn't define it and the container
then crashes at startup (`session_not_ready` on every invoke). This
root+`hosted/` split is intentional and hand-tuned (see hosted-deploy.md) —
don't collapse it into one folder; the fix for the duplication is the
`verify.sh` consistency checks, not removing the duplication.

Note: `azd deploy`/`azd up` canonically REWRITES `azure.yaml` in place
(alphabetized keys, comments stripped) when it registers agent env vars — this
is normal; don't fight it, and don't rely on key order or comments surviving a
deploy (verify.sh's greps are written order-proof for exactly this reason).

## Proving it (Definition of Done)

`azd` SUCCESS / a server starting is **not** proof. Done = `make verify` +
`make smoke` (the bridge against the REAL agent run locally via `azd ai agent run`)
green, AND — because the deployed path drives a server-side agent — a **live**
browser E2E: deploy with `azd`, run the bridge with `HOSTED_AGENT_NAME` set, and
confirm read + HITL approve (tool re-executes, state changes) **and** reject (no
change) in a real browser.
