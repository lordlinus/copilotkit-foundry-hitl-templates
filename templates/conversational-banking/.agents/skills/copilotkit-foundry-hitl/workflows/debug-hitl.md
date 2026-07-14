# Workflow — debug: I approve but the tool doesn't re-execute

The single most common failure on this stack: the user clicks **Approve**, but the
gated tool's side effect never happens (state unchanged), or the turn 400s. Work
this decision tree top to bottom — each cause is a real, verified failure mode from
`../references/troubleshooting.md` and `../references/architecture.md`.

## Decision tree (stop at the first that matches)

1. **Turn errors with 400/500 "No tool output found for function call".**
   → `build_hosted_agent()` is using Chat Completions (`OpenAIChatClient` /
   `OpenAIChatCompletionClient`). Switch to **`FoundryChatClient` (Responses)** so
   the hosted `mcp_approval_response` re-executes the tool. `verify.sh` checks this.

2. **Clicking Approve does nothing / tool never runs, no error.**
   → The frontend is resolving with `{ approved }`. Resolve with
   **`{ accepted, steps }`** — the backend detection is `"accepted" in parsed`
   (`hosted_proxy.py::_find_approval_decision`).

3. **Approve surfaces, but state is unchanged afterward (approval resolved but not forwarded).**
   → `bridge_app.py`'s approval-routing patch (neutralising ag-ui's
   `_is_confirm_changes_response` / `_resolve_approval_responses`) was removed or
   disabled, so ag-ui resolved `confirm_changes` **locally** and the decision never
   reached `HostedProxyAgent`. Restore it — proven load-bearing (disabling it → approve
   doesn't change state).

4. **You're on the NATIVE endpoint, not the bridge.**
   → If the backend uses `add_agent_framework_fastapi_endpoint(FoundryAgent(...))`
   (even with `allow_preview=True`), it surfaces the pause but **never sends
   `mcp_approval_response`** — the FoundryAgent client has no client-side approval
   forwarding, so approve cannot re-execute. Use `HostedProxyAgent`. Full matrix in
   `../references/architecture.md` ("Why the bridge is the MINIMUM").

5. **Approve works, but the SAME tool silently re-executes on a LATER unrelated turn**
   (duplicate side effect).
   → Upstream bug #6851/#6828. Mitigated for **DIRECT/local-dev mode** in
   `hosted_client.py::converse_stream()`: it detects an approval-resolving turn
   (`_is_approval_turn`) and does NOT chain `previous_response_id` forward from it.
   `smoke.py` C11 guards this. PLATFORM/deployed mode builds requests differently and
   is unverified — treat post-approval multi-turn on a deployed agent as unproven
   until tested live.

6. **Approval/tool card vanishes at RUN_FINISHED** (approve seemed to work, then the
   card disappears on a multi-tool turn).
   → ag-ui lumps multiple `tool_calls` into one snapshot message; CopilotKit v1
   renders only `toolCalls[0]`. Keep `bridge_app.py`'s snapshot-split; `smoke.py` C9
   guards it (`DISABLE_C9_SPLIT=1` fails C9).

## Also rule out (environment, not code)

- **403 `workspaces/agents/action`** on `make smoke`/`make local` → `az`'s active
  subscription/tenant ≠ the Foundry project's. `az account set --subscription <the
  project's subscription>`; no code change (`../references/troubleshooting.md`,
  Foundry connection).
- **401 "audience is incorrect"** → request `https://ai.azure.com/.default`.
- Re-running `make smoke` twice without restarting `azd ai agent run` reuses
  process-lifetime seed data — a prior approve/reject already mutated it. Restart
  between passes.

## Upstream status

#6652 (HITL forwarding), #6828 and #6851 (duplicate re-execution) are all **OPEN**;
#6828's fix PR #6829 was closed without merging. Keep all patches until they close —
see `upgrade-loop.md`.

## Prove the fix

`make smoke` must go green: consequential prompt PAUSES → approve executes → reject
doesn't → C9 → C10 (→ C11 for DIRECT mode). Then a live browser E2E.
