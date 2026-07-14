# Workflow — wire a new human-in-the-loop approval

Gate a consequential action so the user must approve before it executes
server-side. This is the stack's headline feature; get the contract exactly right.

## The contract (both sides must agree)

1. **Hosted agent (`src/agent.py`):** decorate the consequential tool
   `@tool(approval_mode="always_require")`. On a run, the hosted agent emits an
   `mcp_approval_request`; the bridge surfaces it to the UI as a `confirm_changes`
   tool call carrying `function_name`, `function_arguments`, and `steps`.
2. **Frontend (`frontend/components/`):** register the approval with the v2 hook,
   keeping the name `confirm_changes`:
   ```ts
   useHumanInTheLoop({
     name: "confirm_changes",
     render: ({ args, respond, status }) => /* your approval card */,
   });
   ```
   Resolve with **`respond({ accepted: boolean, steps })`** — NOT `{ approved }`.
   (CopilotKit's `respond(result)` accepts any value; `{ accepted, steps }` is this
   template's convention, matched in `hosted_proxy.py`'s `_find_approval_decision`,
   whose backend detection is `"accepted" in parsed`.)
3. **Bridge (do NOT touch):** on approve, `HostedProxyAgent` forwards an
   `mcp_approval_response{approve:true}` to the hosted agent so the gated tool
   **re-executes server-side**; on reject, `approve:false` (tool does not run).
   `bridge_app.py` neutralises ag-ui's LOCAL approval interception so the decision
   actually reaches the agent — this patch is load-bearing.

## Preconditions the gate depends on

- `build_hosted_agent()` uses **`FoundryChatClient` (Responses)**. With Chat
  Completions, approve fails with 400/500 "No tool output found for function call".
- The bridge is `HostedProxyAgent`, not the native
  `add_agent_framework_fastapi_endpoint(FoundryAgent)` — the native path never
  forwards `mcp_approval_response`, so approve won't re-execute.

## Card fields

The card reads `args` (parsed `function_arguments`). Cast to the **exact parameter
names** your Python tool declares. If you rename a parameter later, update the card
(see `add-tool.md` gotcha).

## Prove it

```bash
make smoke      # asserts: consequential prompt PAUSES; approve → state changes; reject → unchanged
```
Then a **live browser E2E**: the approval card renders, Approve re-executes the tool
(state changes), Reject leaves state unchanged, and the conversation continues after
both. Backend/SSE smoke alone does not prove the card renders — assert on the DOM.

If approve still doesn't re-execute, run `debug-hitl.md`.
