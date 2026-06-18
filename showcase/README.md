# forgewright · Agent Showcase

> A live, public **portfolio of agentic apps** built on
> [AG-UI](https://docs.ag-ui.com/introduction) + Microsoft Agent Framework +
> Azure AI Foundry — with native **human-in-the-loop approval**. A tiny static
> gallery on **GitHub Pages** talks to **one always-on Container App** that fronts
> every agent. Click *Try it* to chat; click *View source* to build your own.

This is a **self-contained demo** that sits alongside the
[forgewright](../README.md) template gallery without touching it. The agents it
serves **are** the templates in [`../templates`](../templates) — run as-is, never
forked — so the showcase always reflects the real, shippable code.

---

## What it demonstrates

- **One gateway, many agents.** A single container hosts every template agent and
  proxies the open AG-UI (SSE) protocol per agent at `/agents/<id>/`.
- **A featherweight client.** The browser uses
  [`@ag-ui/client`](https://www.npmjs.com/package/@ag-ui/client) directly — no
  CopilotKit runtime, no Node server — so the whole UI is static and fits on
  GitHub Pages (~50 KB gzipped).
- **Human-in-the-loop, for real.** Read tools answer instantly; any consequential
  tool **pauses** on an Approve / Reject card and only runs once you approve.

> **How AG-UI is wired** (who provides it per agent, framework vs hand-rolled, and
> the GitHub Copilot SDK’s AG-UI story): see
> [`docs/ag-ui-architecture.md`](docs/ag-ui-architecture.md).

```
 ┌─────────────────────────┐      AG-UI / SSE        ┌──────────────────────────────┐
 │  Static gallery (Pages)  │ ───────────────────────▶│  Gateway (Azure Container App)│
 │  @ag-ui/client + cards   │   /agents/<id>/  POST   │  CORS · /agents · reverse-proxy│
 └─────────────────────────┘                          └──────────────┬───────────────┘
                                                                      │ one uvicorn per template
                                              ┌───────────────────────┼───────────────────────┐
                                              ▼                       ▼                       ▼
                                     agentic-copilot-foundry   conversational-banking   health-claim-intake
                                       (Microsoft Agent Framework agent, keyless → Azure AI Foundry)
```

---

## Layout

```text
showcase/
  agents.json              registry served at GET /agents (id, title, source link, …)
  gateway/                 the always-on container
    app.py                 FastAPI: CORS allow-list + /agents + SSE reverse-proxy
    launcher.py            supervises one uvicorn per template backend, then the gateway
    Dockerfile             MCR base; build context = repo root (copies templates/<id>)
    azure.yaml + infra/    azd: one Container App (scale-to-zero), ACR, managed identity, roles
  ui/                      static gallery + AG-UI chat (Vite + TypeScript)
    src/{main,chat,config}
    src/transcript.ts      pure, testable transcript renderer (forms, HITL cards)
    test/dom.test.mjs      Tier-1 jsdom DOM tests over recorded per-agent fixtures
    test/e2e/              Tier-2 Playwright browser E2E (+ screenshots)
    public/config.js       runtime gateway URL, stamped at publish time
  Makefile                 install / gateway / ui-dev / verify / smoke / deploy
  ../.github/workflows/showcase-pages.yml    builds ui/ and deploys to Pages
  ../.github/workflows/showcase-deploy.yml   azd up the gateway (OIDC, no secret)
  ../.github/workflows/showcase-ui-e2e.yml   Tier-1 + Tier-2 UI verification
```

---

## Run it locally

```bash
cd showcase
make install                # gateway venv (uv) + UI deps (npm)

# Terminal 1 — the multi-agent gateway (REAL Foundry; needs az login):
export FOUNDRY_PROJECT_ENDPOINT="https://<account>.services.ai.azure.com/api/projects/<project>"
export AZURE_AI_MODEL_DEPLOYMENT_NAME="gpt-4.1"
make gateway                # http://localhost:8080  (GET /healthz, /agents)

# Terminal 2 — the static gallery:
make ui-dev                 # http://localhost:5173
```

Offline plumbing check (no Azure, no cost) — drives the full AG-UI + HITL path:

```bash
make smoke                  # starts the gateway in LLM_MODE=mock and asserts
                            # read works, action PAUSES, approve executes, reject doesn't
```

---

## Verifying the UI (don't ship a UI on backend smoke alone)

Backend smoke proves the protocol; it can't see render/UX or browser-only bugs.
The showcase has a two-tier UI gate:

```bash
make verify                 # Tier-1: production build + jsdom DOM tests
                            # (asserts the approval card + buttons render, the
                            #  "what am I approving?" preview is never empty, and
                            #  a form result renders as a form — not raw JSON)

cd ui && npm run test:e2e   # Tier-2: Playwright in a real browser against a
                            # mock-mode gateway (catches the @ag-ui/client
                            # detached-fetch crash, approval cards below the fold,
                            # etc.) and screenshots each agent's HITL flow
```

Both tiers run in CI (`.github/workflows/showcase-ui-e2e.yml`); Tier-2 starts the
gateway in `LLM_MODE=mock`, so it needs no Azure. DOM-test fixtures in
`ui/test/fixtures/` are recorded from the real agents.

> **Definition of done for a UI change:** `make verify` passes locally and the
> Playwright job is green with screenshots — *not* "the dev server started".

---

## Deploy

**Gateway (always-on):**

```bash
cd showcase/gateway
azd env new forgewright-showcase
azd env set FOUNDRY_ACCOUNT_RESOURCE_ID  "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>"
azd env set FOUNDRY_PROJECT_ENDPOINT     "https://<account>.services.ai.azure.com/api/projects/<project>"
azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME "gpt-4.1"
azd env set ALLOWED_ORIGINS              "https://<you>.github.io"
azd up
```

The managed identity is granted **Cognitive Services OpenAI User** + **Azure AI
User** on the Foundry account, so model calls are **keyless**. The app
**scales to zero** when idle.

**UI (GitHub Pages):**

1. Settings → Secrets and variables → Actions → Variables → add
   `API_BASE = https://<gateway-fqdn>` (printed by `azd up`).
2. Push to `main` (or run the **Deploy showcase to Pages** workflow). The workflow
   builds `ui/` and stamps the gateway URL into `config.js`.

---

## Add an agent to the gallery

1. Add (or reuse) a template under [`../templates/<id>`](../templates).
2. Append an entry to [`agents.json`](agents.json) with a unique internal `port`
   and `backendDir: templates/<id>/backend`.
3. Add the same template's `src/` + `backend/` `COPY` lines to
   [`gateway/Dockerfile`](gateway/Dockerfile).
4. `make smoke` and redeploy.

---

## Note on the agent-framework version

The templates pin an older `agent-framework` for their own verified baseline. The
showcase gateway instead pins the **latest** stack
([`gateway/requirements.txt`](gateway/requirements.txt)) and runs the template
code against it. `agent-framework-openai >= 1.1` routes `.../openai/v1` base URLs
to `AsyncOpenAI` (no `api-version`), so the templates' **keyless Foundry** branch
works natively — no shim or workaround needed. Re-run `make smoke` after any bump.
