"""Multi-agent showcase gateway.

One always-on container fronts every agent in the gallery. Each agent runs as its
OWN backend on an internal port (started by ``launcher.py``): MAF agents run the
Foundry hosted-agent runtime (``ResponsesHostServer``) plus the thin AG-UI bridge
(``bridge_app:app``); Node agents run a self-contained AG-UI backend. This FastAPI
app reverse-proxies ``/agents/<id>/*`` to ``127.0.0.1:<port>/*`` and streams the
AG-UI SSE response straight back to the browser.

Running each backend in its own process isolates the per-template AG-UI
monkeypatches from the others, so the gallery hosts all of them without conflict
and **without modifying any template code**.

Public surface:
  GET  /healthz          liveness + per-agent readiness
  GET  /agents           public registry (the UI renders one card per entry)
  ANY  /agents/<id>/...   reverse-proxy to that agent's AG-UI backend (SSE-safe)

CORS is an explicit allow-list (never ``*``) so the static GitHub Pages origin can
call the container while drive-by sites cannot.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("showcase.gateway")

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

GATEWAY_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("REPO_ROOT", str(GATEWAY_DIR.parents[1])))
REGISTRY_PATH = Path(os.environ.get("SHOWCASE_REGISTRY", str(GATEWAY_DIR.parent / "agents.json")))

# Comma-separated allow-list of browser origins. Defaults cover GitHub Pages +
# local dev; override ALLOWED_ORIGINS at deploy time with your Pages URL.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "https://lordlinus.github.io,http://localhost:5173,http://localhost:8080",
    ).split(",")
    if o.strip()
]

# Light abuse guard: cap the request body the proxy will forward.
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(256 * 1024)))
UPSTREAM_TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", "120"))

# Hop-by-hop headers must never be forwarded through a proxy.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}


def _load_registry() -> list[dict[str, Any]]:
    data = json.loads(REGISTRY_PATH.read_text())
    return data["agents"]


_AGENTS = _load_registry()

# When started by launcher.py, only expose the agents whose backends actually
# run in this container (a registry entry may need a runtime the image lacks).
# Unset (standalone dev: `python app.py`) means no filtering.
_STARTED = os.environ.get("SHOWCASE_STARTED_AGENTS")
if _STARTED is not None:
    _started_ids = {s for s in _STARTED.split(",") if s}
    _AGENTS = [a for a in _AGENTS if a["id"] in _started_ids]

_PORT_BY_ID = {a["id"]: int(a["port"]) for a in _AGENTS}

# Public view of the registry — internal fields stripped.
_PUBLIC_FIELDS = ("id", "title", "agentName", "tagline", "description", "stack", "sourcePath", "tryPrompts", "tools")
_PUBLIC_AGENTS = [{k: a[k] for k in _PUBLIC_FIELDS if k in a} for a in _AGENTS]

app = FastAPI(title="showcase gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = httpx.AsyncClient(timeout=httpx.Timeout(UPSTREAM_TIMEOUT))


@app.on_event("shutdown")
async def _shutdown() -> None:
    await _client.aclose()


@app.get("/healthz")
async def healthz() -> JSONResponse:
    statuses: dict[str, str] = {}
    for agent in _AGENTS:
        port = int(agent["port"])
        try:
            r = await _client.get(f"http://127.0.0.1:{port}/healthz", timeout=2.0)
            statuses[agent["id"]] = "ok" if r.status_code == 200 else f"http {r.status_code}"
        except Exception:  # noqa: BLE001 — readiness probe, any failure == down
            statuses[agent["id"]] = "down"
    overall = "ok" if all(v == "ok" for v in statuses.values()) else "degraded"
    return JSONResponse({"status": overall, "agents": statuses})


@app.get("/agents")
async def agents() -> JSONResponse:
    return JSONResponse({"agents": _PUBLIC_AGENTS})


@app.api_route(
    "/agents/{agent_id}/{upstream_path:path}",
    methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
)
@app.api_route("/agents/{agent_id}", methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"])
async def proxy(agent_id: str, request: Request, upstream_path: str = "") -> Response:
    port = _PORT_BY_ID.get(agent_id)
    if port is None:
        return JSONResponse({"error": f"unknown agent '{agent_id}'"}, status_code=404)

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return JSONResponse({"error": "request body too large"}, status_code=413)

    # The AG-UI endpoint is mounted at "/" upstream, so /agents/<id>/ -> "/".
    target = f"http://127.0.0.1:{port}/{upstream_path}"
    fwd_headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}

    upstream = _client.build_request(
        request.method, target, headers=fwd_headers, content=body,
        params=request.query_params,
    )
    try:
        resp = await _client.send(upstream, stream=True)
    except httpx.ConnectError:
        return JSONResponse({"error": f"agent '{agent_id}' is not ready"}, status_code=503)

    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in _HOP_BY_HOP}

    async def _stream():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(
        _stream(),
        status_code=resp.status_code,
        headers=resp_headers,
        media_type=resp.headers.get("content-type"),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
