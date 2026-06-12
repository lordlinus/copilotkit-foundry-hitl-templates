# Architecture — what lives where, and why

One agent, two front doors, a chat UI, and an offline test mode.

```
<app>/
├── src/
│   ├── agent.py        ONE Microsoft Agent Framework agent (build_agent()).
│   │                   Read tools + ≥1 @tool(approval_mode="always_require").
│   │                   build_chat_client(): mock | key | keyless-Foundry.
│   └── mock_client.py  Offline deterministic client (LLM_MODE=mock). Subclasses
│                       FunctionInvocationLayer + BaseChatClient so the Agent runs
│                       the real tool/approval loop with no model.
├── backend/
│   ├── ag_ui_app.py    FastAPI + AG-UI/SSE. Installs the FOUR resilience patches
│   │                   BEFORE add_agent_framework_fastapi_endpoint(app, agent, "/").
│   ├── requirements.txt  Pinned to the versions `make smoke` verifies.
│   └── Dockerfile      MCR base; serves uvicorn ag_ui_app:app.
├── hosted/             azd → Foundry HOSTED agent (Responses protocol).
│   ├── azure.yaml      host: azure.ai.agent; azure.ai.agents extension pinned;
│   │                   build context = template root (so src/ is included).
│   └── responses/      main.py (ResponsesHostServer), Dockerfile, agent[.manifest].yaml
├── frontend/           Next.js + CopilotKit.
│   ├── app/api/copilotkit/[[...slug]]/route.ts  the 5-choice bridge.
│   ├── app/page.tsx    <CopilotKit useSingleEndpoint={false} agent="...">.
│   └── components/Chat.tsx  confirm_changes HITL card + per-tool render cards.
├── scripts/            verify.sh (structural), smoke.py + smoke_run.sh (offline E2E).
├── run-local.sh        backend :8080 + frontend :3000.
└── Makefile(+.targets) preflight / local / verify / smoke / up / deploy / clean.
```

## Data flow (local)

1. Browser ↔ Next.js. `<CopilotKit runtimeUrl="/api/copilotkit">` calls the route.
2. `route.ts` (`CopilotSseRuntime` + `HttpAgent`) proxies to the AG-UI backend
   over SSE at `AG_UI_BACKEND_URL` (default `http://localhost:8080/`).
3. `ag_ui_app.py` runs the MAF agent. Read tools execute inline; a
   `approval_mode="always_require"` tool PAUSES and emits `confirm_changes`.
4. The UI shows Approve/Reject; resolving with `{accepted, steps}` resumes the run
   and the backend executes (or skips) the gated tool.

## Hosted (azd)

`hosted/responses/main.py` serves the SAME `build_agent()` over the Responses
protocol. `cd hosted && azd up` builds the image (remote build) and publishes a
Foundry hosted agent + model deployment. The build context is the template root
so the shared `src/agent.py` is in the image.

## Two connection modes to Foundry

- **Keyless (default):** `DefaultAzureCredential` + bearer-token provider for the
  `https://ai.azure.com/.default` audience → `OpenAIChatCompletionClient` against
  `{FOUNDRY_PROJECT_ENDPOINT}/openai/v1`. Chat Completions, not Responses.
- **Mock (`LLM_MODE=mock`):** no Azure at all — for `make smoke` and CI.
