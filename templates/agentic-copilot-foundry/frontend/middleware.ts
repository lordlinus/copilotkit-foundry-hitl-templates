import { NextRequest, NextResponse } from "next/server";

// ── CORS for the CopilotKit runtime ────────────────────────────────────────
// The Next.js `/api/copilotkit` route IS the CopilotKit runtime. When the UI is
// hosted SAME-ORIGIN (the bundled Next page) no CORS is needed. But when a
// SEPARATE frontend — e.g. a GitHub Spark app or `showcase/spark-ui` — calls
// this runtime cross-origin, the browser sends an OPTIONS preflight first.
//
// The hono runtime already sets `Access-Control-Allow-Origin: *` on its actual
// responses, but it does NOT answer the preflight with the Allow-Methods /
// Allow-Headers the browser requires. This middleware OWNS the preflight only
// (and lets actual requests pass through untouched, to avoid emitting a second,
// invalid `Access-Control-Allow-Origin` header).
//
// Set COPILOT_ALLOWED_ORIGINS to a comma-separated allow-list to gate which
// origins get a successful preflight, e.g.
//   COPILOT_ALLOWED_ORIGINS=https://my-app.github.app,https://localhost:5173
// If unset, the requesting Origin is reflected on the preflight (handy for Spark
// preview URLs that rotate; tighten before production). Credentials are never
// used (no cookies), so a reflected origin / `*` is safe.

const ALLOW_LIST = (process.env.COPILOT_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  const allowed =
    ALLOW_LIST.length === 0 || (origin !== null && ALLOW_LIST.includes(origin));
  if (allowed && origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else if (ALLOW_LIST.length === 0) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    // CopilotKit/AG-UI send content-type plus a few x-copilotkit-* hints; echo
    // back whatever the browser asks for during preflight so nothing is dropped.
    "Content-Type, Authorization, X-API-Key, X-CopilotKit-Runtime-Client-GQL-Version",
  );
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  // Short-circuit the preflight so it never reaches the hono handler.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  // The CopilotKit hono runtime already emits `Access-Control-Allow-Origin: *`
  // on its own responses, so we must NOT add a second ACAO here (duplicate
  // ACAO headers are invalid and browsers reject them). We only own the
  // preflight above; pass actual requests through untouched.
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/copilotkit/:path*"],
};
