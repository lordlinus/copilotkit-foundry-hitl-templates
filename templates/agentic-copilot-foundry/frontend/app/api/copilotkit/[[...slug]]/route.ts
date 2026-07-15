import { ExperimentalEmptyAdapter } from "@copilotkit/runtime";
import {
  CopilotSseRuntime,
  InMemoryAgentRunner,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";
import { NextRequest } from "next/server";

// MUST match AGENT_NAME in src/agent.py and the CopilotKit agent prop in page.tsx.
const AGENT_NAME = "agentic_copilot_foundry";

// The AG-UI backend (FastAPI + SSE) served by backend/bridge_app.py.
const backendUrl = process.env.AG_UI_BACKEND_URL ?? "http://localhost:8080/";
const apiKey = process.env.AG_UI_API_KEY;

// IMPORTANT — use the v2 `CopilotSseRuntime` directly, NOT the lib's
// `CopilotRuntime`. The lib wraps any runner in `TelemetryAgentRunner`; the
// Threads handler's fallback is a strict `runner instanceof InMemoryAgentRunner`
// check, so wrapping breaks it and the Threads panel 422s. `InMemoryAgentRunner`
// is PROCESS-LOCAL (dev-server reloads lose it) — swap for a persistent runner
// or CopilotIntelligenceRuntime in production.
const runtime = new CopilotSseRuntime({
  runner: new InMemoryAgentRunner(),
  agents: {
    [AGENT_NAME]: new HttpAgent({
      url: backendUrl,
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
    }),
  },
});

// AG-UI agents drive the run loop themselves, so an empty service adapter is used.
new ExperimentalEmptyAdapter();

// `createCopilotHonoHandler` (the MULTI-route handler) exposes the full path
// table — agent/run AND GET/PATCH/DELETE /threads/*. The single-route
// `copilotRuntimeNextJSAppRouterEndpoint` 405s every Threads request. The
// catch-all `[[...slug]]` dir is mandatory: without it Next 404s nested paths
// before hono sees them. Re-export every verb hono dispatches.
const honoApp = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
});
const handler = handle(honoApp);

export const POST = (req: NextRequest) => handler(req);
export const GET = (req: NextRequest) => handler(req);
export const PATCH = (req: NextRequest) => handler(req);
export const DELETE = (req: NextRequest) => handler(req);
