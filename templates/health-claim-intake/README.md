# Health Insurance Claim Intake (HITL)

A claim intake assistant: a **Next.js + CopilotKit** chat UI over a
**FastAPI + AG-UI (SSE)** backend that hosts **one Microsoft Agent Framework
agent**, connected **keyless** to **Azure AI Foundry**, with **native
human-in-the-loop approval** on the consequential action. The same agent is
also publishable as a **Foundry hosted agent** (Responses protocol) via `azd`.

The agent intakes multiple claim documents, **auto-fills the claim form** from
them, lets the user **review and edit** fields, and **submits** the claim only
after the user approves:

- `list_documents` — show the intake documents (read).
- `extract_claim_form` — auto-fill the form from the documents (read/compute).
- `update_claim_field` — apply a user edit to a draft field (no approval).
- `get_claim` — read the current claim (form, status, reference).
- `submit_claim` — **approval-gated** (`approval_mode="always_require"`): files
  the claim only after the user clicks Approve.

The demo uses a deterministic in-memory store and canned documents. Replace the
extraction in `src/agent.py` with a real OCR / document-intelligence pipeline.

## Getting started

```bash
# Offline — no Azure, no real model (used by CI):
make smoke        # starts the backend with LLM_MODE=mock and asserts the HITL flow
make verify       # read-only structural checks

# Local dev loop (needs a Foundry project + `az login`, OR LLM_MODE=mock):
cp backend/.env.example backend/.env       # set FOUNDRY_PROJECT_ENDPOINT + model
make local                                 # backend :8080 + frontend :3000

# Deploy the hosted Foundry agent (needs az login to the Foundry tenant):
make up
```

Open http://localhost:3000 and try: *"list the documents"* →
*"extract the claim form"* → *"change the billed amount to 1450"* →
*"submit the claim"* — submission pauses for your Approve/Reject.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/agent.py` | The ONE MAF agent: claim store, instructions, tools, `build_chat_client()` (mock / key / keyless-Foundry). **Edit this.** |
| `src/mock_client.py` | Deterministic offline client for `LLM_MODE=mock` (routes the read + submit tools). |
| `backend/ag_ui_app.py` | FastAPI + AG-UI/SSE host + the four resilience patches. **Don't edit the patches.** |
| `frontend/app/api/copilotkit/[[...slug]]/route.ts` | The CopilotKit bridge (multi-route, v2 runtime). **Don't edit.** |
| `frontend/app/page.tsx` | `<CopilotKit useSingleEndpoint={false} agent=...>`. |
| `frontend/components/Chat.tsx` | `confirm_changes` HITL card + per-tool render cards (documents, form, edits, submit). **Edit render cards.** |
| `hosted/` | `azd` → Foundry hosted agent (Responses protocol). |
| `scripts/verify.sh`, `scripts/smoke.py` | The proof: structural + offline end-to-end. |

## Scripts (make targets)

| Target | Does |
| --- | --- |
| `make preflight` | install backend venv + frontend deps |
| `make local` | run backend + frontend |
| `make verify` | read-only structural checks |
| `make smoke` | offline end-to-end HITL test (`LLM_MODE=mock`) |
| `make up` / `make deploy` | `azd up` / `azd deploy` the hosted agent |
| `make clean` | remove venv / node_modules / .next |

## Customizing

- **Real documents/extraction:** replace `_DEMO_DOCUMENTS` and `_ClaimStore.extract`
  in `src/agent.py` with your OCR / document-intelligence call. Keep the tool
  shape (read tools + the approval-gated `submit_claim`).
- **More gated actions** (e.g. `pay_claim`, `deny_claim`): add another
  `@tool(approval_mode="always_require")` tool; the HITL card handles it.
- If you rename `get_claim` / `submit_claim`, update `src/mock_client.py`
  (`READ_TOOL` / `ACTION_TOOL` / `STATE_FIELD`) and `scripts/smoke.py`
  (`READ_PROMPT` / `ACTION_PROMPT` / `STATE_FIELD` / `READ_TOOL`) so `make smoke`
  still exercises the gate.

## Definition of Done

Not done until `make verify` **and** `make smoke` are green. See
`.agents/skills/forgewright/SKILL.md`.
