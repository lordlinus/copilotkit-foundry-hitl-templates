# How AG-UI works in this showcase

A common question: *“Are you using the [AG-UI Python SDK](https://docs.ag-ui.com/sdk/python/core/overview)
directly, or relying on a framework? And does the GitHub Copilot SDK give better
AG-UI support?”* This doc is the precise answer.

## TL;DR

- **[AG-UI](https://docs.ag-ui.com/introduction) is a thin wire protocol** —
  newline-delimited JSON events (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`,
  state snapshots). The Python `ag-ui-protocol` package (`ag_ui.core`) is *just
  typed data structures + an event encoder*; it does **not** translate your agent
  into those events — that mapping is the actual work.
- The **browser** uses the **AG-UI SDK directly** (`@ag-ui/client`).
- The **3 Microsoft Agent Framework (MAF) agents** get their server-side AG-UI
  from **`agent_framework_ag_ui`** (which itself sits on `ag_ui.core`). We rely on
  it on purpose — and pay for it with 4 small patches.
- The **GitHub Copilot SDK has zero AG-UI support.** We bridge its native event
  model → AG-UI by hand.

## Where AG-UI comes from, per layer

| Layer | Provides AG-UI via | Uses the AG-UI SDK? |
| --- | --- | --- |
| **Browser** (`ui/`) | [`@ag-ui/client`](https://www.npmjs.com/package/@ag-ui/client) `HttpAgent` | ✅ directly (JS SDK) |
| **MAF agents** (`templates/*`) | `agent_framework.ag_ui.add_agent_framework_fastapi_endpoint` | ✅ transitively — that package is built on `ag_ui.core`; we also import `ag_ui.core` event types in the patches |
| **Copilot agent — gateway** (`agents/copilot-pr-assistant/`) | hand-written `src/agui.ts` (~60 lines of raw AG-UI JSON) | ❌ implements the wire protocol by hand |
| **Copilot agent — hosted** (`agents/copilot-pr-assistant-hosted/`) | n/a — speaks the **Responses** protocol, not AG-UI | — |

## “Are we relying on the framework?”

**For the MAF agents — yes, deliberately.** `agent_framework_ag_ui` maps MAF’s
streaming / tool-call / approval model onto AG-UI events for us. Re-implementing
that against `ag_ui.core` would mean rebuilding the whole MAF→AG-UI translation.
The cost of the convenience is the **four resilience patches** in each
`backend/ag_ui_app.py` — the framework’s translation has bugs we work around
(HITL approve-replay 400, multi-tool snapshot splitting, orphaned-tool-call
replay 400). See those files’ headers and
[`templates/*/AGENTS.md`](../../templates).

**For the Copilot agent — no framework.** AG-UI on the wire is trivial, so
`agui.ts` emits it directly. We *could* swap in `ag_ui.core`’s `EventEncoder` for
type-safety, but it would add a dependency and change zero behavior — the emitter
is intentionally dependency-free.

## Does the GitHub Copilot SDK give “better AG-UI support”?

**No — it has none.** The Copilot SDK is a coding-agent *runtime* with its own
event model (`AssistantMessageDeltaData`, tool requests, `on_permission_request`).
To put it behind AG-UI you must **bridge its events → AG-UI events yourself** —
that is exactly what `bridge.ts` + `agui.ts` do.

What the Copilot SDK *does* give you is a richer runtime and a **native HITL
primitive**: `on_permission_request` / `PermissionHandler`. That is arguably a
cleaner approval hook than MAF’s `approval_mode` replay (the mechanism that needed
the 4 patches). In the gateway agent we currently enforce the gate at the
**bridge level** — the model calls `propose_pull_request`, and the bridge turns
that into a synthetic `confirm_changes` approval card — because that maps directly
to the AG-UI `confirm_changes` contract the UI already speaks (`bridge.ts`
deliberately omits `onPermissionRequest`).

## Two protocols, don’t confuse them

| | AG-UI | Responses |
| --- | --- | --- |
| **Direction** | browser ↔ agent | Foundry platform ↔ hosted container |
| **Transport** | SSE, newline-JSON events | `POST /responses` (OpenAI Responses shape) |
| **HITL** | interactive `confirm_changes` Approve/Reject card | none in the request path (`approve_all`) |
| **Used by** | the whole showcase UI + all gateway agents | the hosted Copilot agent (`azd up`) |

The same Copilot agent ships **both ways**: behind the gateway with AG-UI + HITL,
and as a Foundry hosted agent over Responses. See
[`agents/copilot-pr-assistant-hosted/README.md`](../agents/copilot-pr-assistant-hosted/README.md).
