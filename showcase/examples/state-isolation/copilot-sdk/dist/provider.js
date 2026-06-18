// Model provider for the state-isolation demo. Mirrors the PR agent: APIM AI
// gateway via an in-process auth adapter, or a direct Azure/OpenAI endpoint.
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
export const MODEL_NAME = process.env.MODEL_NAME || "gpt-5.4-mini";
function startApimAdapter(gateway, pathPrefix, apiKey) {
    const gw = new URL(gateway);
    const isHttps = gw.protocol === "https:";
    const doRequest = isHttps ? httpsRequest : httpRequest;
    const prefix = ("/" + pathPrefix.replace(/^\/+|\/+$/g, "")).replace(/\/+$/, "");
    const server = createServer((cReq, cRes) => {
        const headers = {};
        for (const [k, v] of Object.entries(cReq.headers)) {
            if (typeof v === "string" && !["host", "api-key", "authorization", "content-length"].includes(k.toLowerCase()))
                headers[k] = v;
        }
        headers["api-key"] = apiKey;
        headers["host"] = gw.host;
        const up = doRequest({ protocol: gw.protocol, hostname: gw.hostname, port: gw.port || (isHttps ? 443 : 80), method: cReq.method, path: prefix + (cReq.url || "/"), headers }, (uRes) => {
            cRes.writeHead(uRes.statusCode || 502, uRes.headers);
            uRes.pipe(cRes);
        });
        up.on("error", (e) => { cRes.writeHead(502); cRes.end(String(e)); });
        cReq.pipe(up);
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
        const a = server.address();
        resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
    }));
}
let _apimBaseUrl = null;
export async function buildProvider() {
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";
    const wireApi = process.env.WIRE_API || "completions";
    if (process.env.APIM_GATEWAY && process.env.APIM_KEY) {
        if (!_apimBaseUrl)
            _apimBaseUrl = await startApimAdapter(process.env.APIM_GATEWAY, process.env.APIM_PATH_PREFIX || "", process.env.APIM_KEY);
        return { type: "azure", baseUrl: _apimBaseUrl, apiKey: "apim", wireApi, azure: { apiVersion } };
    }
    const baseUrl = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/+$/, "");
    if (!baseUrl)
        throw new Error("Set APIM_GATEWAY+APIM_KEY or AZURE_OPENAI_ENDPOINT (+LLM_API_KEY).");
    const type = process.env.PROVIDER_TYPE || "azure";
    return { type, baseUrl, apiKey: process.env.LLM_API_KEY, wireApi, azure: { apiVersion } };
}
