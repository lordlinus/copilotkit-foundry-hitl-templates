# Workflow — add shared / predictive state or generative UI

Patterns 4/6/7 from `../references/patterns-7.md`: Agentic Generative UI, Shared
State, Predictive State. These share state between the agent and the CopilotKit UI.

## Backend (`src/agent.py`)

- Declare the shared state shape and (for predictive/generative) the predicted-state
  config on the agent: set `AGENT_STATE_SCHEMA` (`state_schema`) and
  `AGENT_PREDICT_STATE` (`predict_state_config`). A **tool must write the state key**
  — state won't appear if nothing populates it.
- Shared State (6): `require_confirmation=False`; the UI calls `agent.setState()`.
- Predictive State (7): `require_confirmation=True` (default) + a
  `@tool(approval_mode="always_require")` — the predicted change is confirmed via HITL.
- Agentic Generative UI (4): `predict_state_config` + `require_confirmation=False`;
  stream step status through tool-call args.

## Frontend (`frontend/components/`, CopilotKit v2)

- `useAgent({ updates: [OnStateChanged] })` → read `agent.state`.
- `useAgent().setState(...)` to push UI-driven state to the agent (Shared State).
- Predictive: combine `useAgent` with `useHumanInTheLoop` (confirm/reject the
  predicted change — same `{ accepted, steps }` contract as `wire-hitl.md`).

## Reality check: through the DEPLOYED bridge, state synthesis is roadmap

The AG-UI adapter emits StateSnapshot/StateDelta **natively only when it wraps an
in-process `Agent`**. Through the deployed/DIRECT `HostedProxyAgent` bridge, shared /
predictive / generative **state is NOT yet wired**: the bridge would need to relay
`response.function_call_arguments.delta` as growing tool-call args and forward
`useAgent.setState` (RunInput.state) to the hosted agent's input. The plumbing is
understood (see `../references/patterns-7.md`, "Roadmap") but unimplemented. Today
the bridge reliably ships **read + tool-render + HITL**; if you need shared state
through the deployed bridge, you are implementing new bridge behavior — do it in
`hosted_proxy.py`/`hosted_client.py`, keep it minimal, and prove it with a new smoke
assertion, not a claim.

## Common trap

`useAgent().state` stays empty → either `state_schema`/`predict_state_config` weren't
passed to the endpoint, or no tool writes the state key. Fix both
(`../references/troubleshooting.md`, Bridge table).

## Prove it

`make verify` + `make smoke` green (extend `smoke.py` with a state assertion —
`STATE_FIELD` — so the pattern is actually exercised), then a live browser E2E
showing the state round-trip / generative card update.
