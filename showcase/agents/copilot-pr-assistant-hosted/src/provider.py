"""Model provider for the hosted Copilot agent.

Mirrors the Node agent: an APIM AI gateway via an in-process auth adapter (the
Copilot SDK can't send Ocp-Apim-Subscription-Key, so we front it host-only), or a
direct Azure/OpenAI endpoint. Only gpt-5/o-series models work (the Copilot SDK
encrypts prompts; gpt-4.x is unsupported).
"""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlparse

MODEL_NAME = os.environ.get("MODEL_NAME", "gpt-5.4-mini")

_apim_base_url: str | None = None


async def _start_apim_adapter(gateway: str, path_prefix: str, api_key: str) -> str:
    """Tiny reverse proxy: prepend the APIM path prefix + inject the api-key."""
    import aiohttp
    from aiohttp import web

    gw = urlparse(gateway)
    prefix = "/" + path_prefix.strip("/")

    session = aiohttp.ClientSession()

    async def handler(request: web.Request) -> web.StreamResponse:
        target = f"{gw.scheme}://{gw.netloc}{prefix}{request.rel_url}"
        headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in ("host", "api-key", "authorization", "content-length")}
        headers["api-key"] = api_key
        body = await request.read()
        async with session.request(request.method, target, headers=headers, data=body) as up:
            resp = web.StreamResponse(status=up.status, headers={
                k: v for k, v in up.headers.items() if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")
            })
            await resp.prepare(request)
            async for chunk in up.content.iter_any():
                await resp.write(chunk)
            await resp.write_eof()
            return resp

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]  # type: ignore[attr-defined]
    return f"http://127.0.0.1:{port}"


async def build_provider() -> dict:
    api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
    wire_api = os.environ.get("WIRE_API", "completions")
    global _apim_base_url
    if os.environ.get("APIM_GATEWAY") and os.environ.get("APIM_KEY"):
        if _apim_base_url is None:
            _apim_base_url = await _start_apim_adapter(
                os.environ["APIM_GATEWAY"], os.environ.get("APIM_PATH_PREFIX", ""), os.environ["APIM_KEY"],
            )
        return {"type": "azure", "base_url": _apim_base_url, "api_key": "apim",
                "wire_api": wire_api, "azure": {"api_version": api_version}}

    base_url = os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
    if not base_url:
        raise RuntimeError("Set APIM_GATEWAY+APIM_KEY or AZURE_OPENAI_ENDPOINT (+LLM_API_KEY).")
    return {"type": os.environ.get("PROVIDER_TYPE", "azure"), "base_url": base_url,
            "api_key": os.environ.get("LLM_API_KEY"), "wire_api": wire_api,
            "azure": {"api_version": api_version}}


# Keep a reference so the adapter task isn't GC'd.
_bg_tasks: set[asyncio.Task] = set()
