// Tiny in-process auth adapter for APIM-fronted models.
//
// The GitHub Copilot SDK's `type:"azure"` provider sends:
//     POST {baseUrl}/openai/deployments/<model>/chat/completions?api-version=...
//     header: api-key: <value>
// but it strips any path prefix from baseUrl and only sends `api-key` (never
// Ocp-Apim-Subscription-Key). Our APIM AI gateway exposes the classic Azure
// OpenAI surface UNDER a path prefix (e.g. `/aif-swec-01/openai/...`) and accepts
// the subscription key as `api-key`. This adapter bridges the two:
//   • the SDK points at  http://127.0.0.1:<port>   (host-only)
//   • the adapter prepends APIM_PATH_PREFIX and injects the real APIM key,
//     then streams the response straight back.
// It is an auth/path shim for an AI gateway — not a model proxy.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

export interface ApimAdapterConfig {
  gateway: string; // e.g. https://apim-xyz.azure-api.net
  pathPrefix: string; // e.g. /aif-swec-01  (mapped before /openai/...)
  apiKey: string; // APIM subscription key
}

export function startApimAdapter(cfg: ApimAdapterConfig): Promise<{ baseUrl: string; close: () => void }> {
  const gw = new URL(cfg.gateway);
  const isHttps = gw.protocol === "https:";
  const doRequest = isHttps ? httpsRequest : httpRequest;
  const prefix = ("/" + cfg.pathPrefix.replace(/^\/+|\/+$/g, "")).replace(/\/+$/, "");

  const server = createServer((clientReq: IncomingMessage, clientRes: ServerResponse) => {
    const upstreamPath = prefix + (clientReq.url || "/");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(clientReq.headers)) {
      if (typeof v === "string" && !["host", "api-key", "authorization", "content-length"].includes(k.toLowerCase())) {
        headers[k] = v;
      }
    }
    headers["api-key"] = cfg.apiKey; // inject the real APIM subscription key
    headers["host"] = gw.host;

    const upstream = doRequest(
      {
        protocol: gw.protocol,
        hostname: gw.hostname,
        port: gw.port || (isHttps ? 443 : 80),
        method: clientReq.method,
        path: upstreamPath,
        headers,
      },
      (upRes) => {
        clientRes.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(clientRes);
      },
    );
    upstream.on("error", (e) => {
      clientRes.writeHead(502, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({ error: { message: `APIM adapter upstream error: ${e.message}` } }));
    });
    clientReq.pipe(upstream);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
