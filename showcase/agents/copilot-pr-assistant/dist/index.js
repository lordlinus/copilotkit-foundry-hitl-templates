// HTTP server exposing the AG-UI endpoint the showcase gateway proxies to.
//   GET  /healthz   liveness
//   POST /          AG-UI run (RunAgentInput JSON → SSE event stream)
// The gateway forwards /agents/copilot-pr-assistant/* here.
import { createServer } from "node:http";
import { AGENT_NAME, handleRun } from "./bridge.js";
const PORT = parseInt(process.env.PORT || "8104", 10);
const MAX_BODY = 256 * 1024;
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => {
            data += c;
            if (data.length > MAX_BODY)
                reject(new Error("body too large"));
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}
const server = createServer(async (req, res) => {
    try {
        const url = req.url || "/";
        if (req.method === "GET" && (url === "/healthz" || url.endsWith("/healthz"))) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", agent: AGENT_NAME, engine: "github-copilot-sdk" }));
            return;
        }
        if (req.method === "POST") {
            const raw = await readBody(req);
            let body = {};
            try {
                body = raw ? JSON.parse(raw) : {};
            }
            catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid JSON" }));
                return;
            }
            await handleRun(res, body);
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
    }
    catch (err) {
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
        else {
            res.end();
        }
    }
});
server.listen(PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`[${AGENT_NAME}] AG-UI (Copilot SDK) listening on :${PORT}`);
});
