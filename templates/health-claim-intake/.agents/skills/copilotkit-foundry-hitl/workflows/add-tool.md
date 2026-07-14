# Workflow — add or modify an agent tool

Add/modify a tool on the hosted brain. All tools live in `src/agent.py` inside
`build_hosted_agent()` and run **server-side** in the Foundry hosted agent.

## Rules that must still hold after your change

- Keep **≥1 read tool** (no side effects) and **≥1 consequential tool** decorated
  `@tool(approval_mode="always_require")`. `verify.sh` fails otherwise.
- Map the user's "needs approval before X" to the gated tool. If a consequential
  action has no `approval_mode="always_require"`, it runs with no HITL gate — a bug.

## Steps

1. **Define the tool** in `src/agent.py`:
   - Read tool: plain `@tool` (or a callable registered on the agent). No writes.
   - Consequential tool: `@tool(approval_mode="always_require")`.
2. **Write a grounding-safe signature.** The model fills arguments from the
   parameter names, types, and docstring. Do **not** hard-code concrete example
   values for fields the model must ground from source data (e.g. an id, a name, a
   category) — models copy literal examples (few-shot leakage). Use placeholders and
   validate the value against the real record inside the tool.
3. **Return a compact, model-usable result** (text or small JSON). Heavy formatting
   belongs in the frontend card, not the tool output.
4. **Frontend card (optional but usual):** render the tool with `useRenderTool`
   (backend tool) or `useFrontendTool` (client tool / tool-based generative UI) in
   `frontend/components/`. See `../references/patterns-7.md` rows 2 and 5.
5. **If the tool is gated,** wire its approval card — see `wire-hitl.md`.
6. **Keep smoke honest.** Update `scripts/smoke.py`'s domain prompts
   (`READ_PROMPT` / `ACTION_PROMPT` / `STATE_FIELD` / `READ_TOOL`) so `make smoke`
   still drives your read tool and your gated tool through the HITL path.

## Gotcha: renaming a gated tool's parameter

The frontend HITL card parses `function_arguments` and casts to a **specific field
name**. The bridge forwards the model's raw arguments JSON verbatim, so if you rename
a gated tool's parameter you must update the parsed-args field name in the frontend
card to match — otherwise the approval card shows the wrong/missing field. This is
presentation-only, never a bridge change (`../references/troubleshooting.md`, Local
dev-loop gotchas).

## Do NOT touch

`backend/{bridge_app,hosted_proxy,hosted_client}.py`, `build_hosted_agent()`'s
`FoundryChatClient` construction, and the CopilotKit `[[...slug]]/route.ts`.

## Prove it

```bash
make verify     # ≥1 read + ≥1 gated tool, FoundryChatClient, names, MCR
make smoke      # read runs; the consequential prompt PAUSES; approve executes; reject doesn't
```
Both green, then a live browser E2E if the tool ships on the deployed path.
