// The Copilot-SDK agent: a "Copilot PR Assistant".
//
// Copilot reads a (seeded) set of changed files, drafts a pull request, and calls
// `propose_pull_request`. That tool is NON-consequential here — it only records a
// DRAFT and returns immediately. The AG-UI bridge (bridge.ts) turns that draft
// into a human-in-the-loop `confirm_changes` gate; the PR is only actually opened
// after the user approves. This mirrors the forgewright HITL contract, but the
// engine is the GitHub Copilot SDK instead of Microsoft Agent Framework.
//
// mode:"empty" gives a bare runtime with ONLY our tools (no built-in file/shell
// tools), so the agent is safe to host and deterministic for a demo.

import { CopilotClient, defineTool, ToolSet, type Tool } from "@github/copilot-sdk";
import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { startApimAdapter } from "./apim-adapter.js";

export const AGENT_NAME = "copilot_pr_assistant";
export const PROPOSE_TOOL = "propose_pull_request";

// ── Seeded "repository" so Copilot has something concrete to summarize ─────────
const CHANGED_FILES = [
  {
    path: "src/auth/session.ts",
    summary: "Fix: session cookie missing `Secure` + `SameSite=Strict` flags",
    diff:
      "- res.cookie('sid', token, { httpOnly: true });\n" +
      "+ res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'strict' });",
  },
  {
    path: "src/auth/session.test.ts",
    summary: "Add a test asserting the cookie security flags",
    diff:
      "+ it('sets Secure + SameSite=Strict on the session cookie', () => {\n" +
      "+   expect(setCookie).toMatch(/Secure/);\n" +
      "+   expect(setCookie).toMatch(/SameSite=Strict/);\n" +
      "+ });",
  },
];

// ── In-memory "GitHub" so the demo runs with no real side effects ──────────────
let _prCounter = 0;
export interface OpenedPr {
  number: number;
  url: string;
  title: string;
  base: string;
  head: string;
}
export function openPullRequest(p: { title: string; body: string; base: string; head: string }): OpenedPr {
  _prCounter += 1;
  return {
    number: _prCounter,
    url: `https://github.com/acme/widgets/pull/${_prCounter}`,
    title: p.title,
    base: p.base,
    head: p.head,
  };
}

// ── Tools (only these exist; mode:"empty") ─────────────────────────────────────
// Raw JSON-Schema params (not Zod) to avoid a bundled-zod type skew with the SDK.
export function buildTools(): Tool<any>[] {
  return [
    defineTool("list_changed_files", {
      description: "List the files changed on the working branch, with a one-line summary of each change.",
      parameters: { type: "object", properties: {}, required: [] },
      skipPermission: true,
      handler: async () => ({
        files: CHANGED_FILES.map((f) => ({ path: f.path, summary: f.summary })),
        count: CHANGED_FILES.length,
      }),
    }),
    defineTool("get_file_diff", {
      description: "Get the unified diff for a single changed file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path from list_changed_files" } },
        required: ["path"],
      },
      skipPermission: true,
      handler: async ({ path }: { path: string }) => {
        const f = CHANGED_FILES.find((x) => x.path === path);
        return f ? { path: f.path, diff: f.diff } : { error: `No changed file at ${path}` };
      },
    }),
    // The "consequential" intent. It only DRAFTS — the bridge gates the real open.
    defineTool(PROPOSE_TOOL, {
      description:
        "Propose a pull request for the changes. This DRAFTS the PR and pauses for human approval; " +
        "it does NOT open the PR. Call this once you have a clear title/body. After calling it, STOP " +
        "and wait — do not call other tools or take further action.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Concise PR title" },
          body: { type: "string", description: "PR description: what changed and why" },
          base: { type: "string", description: "Base branch", default: "main" },
          head: { type: "string", description: "Head branch", default: "fix/session-cookie-flags" },
        },
        required: ["title", "body"],
      },
      skipPermission: true,
      handler: async () =>
        "Draft recorded. Awaiting human approval before opening. Do not call any more tools; wait for the decision.",
    }),
  ];
}

// In mode:"empty" every session must opt into its tools explicitly. We expose
// ONLY our custom tools (no built-in file/shell tools) — safe + deterministic.
export function availableTools(): ToolSet {
  return new ToolSet().addCustom("*");
}

export const SYSTEM_MESSAGE =
  "You are a senior engineer that opens pull requests. Workflow:\n" +
  "1. Call list_changed_files, then get_file_diff for each file, to understand the change.\n" +
  "2. Draft a clear PR title and body (what changed and why; mention security impact).\n" +
  "3. Call propose_pull_request ONCE with the title/body. It pauses for HUMAN APPROVAL — " +
  "the PR is NOT opened until the human approves.\n" +
  "4. After calling propose_pull_request, STOP. Tell the user the PR is ready for their approval. " +
  "Do not invent a PR number or URL; the system assigns it after approval.";

// ── Model provider ─────────────────────────────────────────────────────────────
// Two key-management paths, in priority order:
//   1. APIM key  — set LLM_API_KEY + AZURE_OPENAI_ENDPOINT to an APIM gateway path.
//      The gateway fronts the model; the SDK sends the key as the Azure `api-key`
//      header. Simplest for shared demos behind an AI gateway.
//   2. Azure BYOM (keyless) — DefaultAzureCredential / ManagedIdentityCredential
//      bearer token (refreshed per session). Tokens expire ~1h.
// Either way: wireApi:"completions" (NOT "responses"), and a gpt-5/o-series model
// (the Copilot SDK encrypts prompts; gpt-4.x is unsupported).
function credential() {
  if (process.env.NODE_ENV === "development") return new DefaultAzureCredential();
  return process.env.AZURE_CLIENT_ID
    ? new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID)
    : new ManagedIdentityCredential();
}

let _apimBaseUrl: string | null = null;

export async function buildProvider() {
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";
  const wireApi = (process.env.WIRE_API as "completions" | "responses") || "completions";

  // Path A — APIM AI gateway (path-prefixed, subscription-key auth). The SDK can't
  // speak APIM's scheme directly, so we front it with an in-process auth adapter
  // and give the SDK a host-only `type:"azure"` endpoint.
  if (process.env.APIM_GATEWAY && process.env.APIM_KEY) {
    if (!_apimBaseUrl) {
      const adapter = await startApimAdapter({
        gateway: process.env.APIM_GATEWAY,
        pathPrefix: process.env.APIM_PATH_PREFIX || "",
        apiKey: process.env.APIM_KEY,
      });
      _apimBaseUrl = adapter.baseUrl;
    }
    return {
      type: "azure" as const,
      baseUrl: _apimBaseUrl,
      apiKey: "apim", // ignored by the adapter; it injects the real key
      wireApi,
      azure: { apiVersion },
    };
  }

  // Path B — a direct endpoint (Azure OpenAI host or OpenAI-compatible).
  const baseUrl = required("AZURE_OPENAI_ENDPOINT");
  const type = (process.env.PROVIDER_TYPE as "azure" | "openai") || "azure";
  const apiKey = process.env.LLM_API_KEY;
  if (apiKey) {
    return { type, baseUrl, apiKey, wireApi, azure: { apiVersion } };
  }
  const { token } = await credential().getToken("https://cognitiveservices.azure.com/.default");
  if (!token) throw new Error("Failed to acquire an Azure AD token for the model provider.");
  return { type, baseUrl, bearerToken: token, wireApi, azure: { apiVersion } };
}

export const MODEL_NAME = process.env.MODEL_NAME || "gpt-5.4-mini";

let _client: CopilotClient | null = null;
export async function getClient(): Promise<CopilotClient> {
  if (_client) return _client;
  // mode:"empty" → multi-user server mode with no built-in tools/instructions.
  // It requires an explicit per-session persistence location; baseDirectory sets
  // COPILOT_HOME, giving each sessionId its own state dir (also powers resume).
  const baseDirectory = process.env.COPILOT_HOME || `${process.cwd()}/.copilot-home`;
  _client = new CopilotClient({ mode: "empty", baseDirectory, logLevel: process.env.SDK_LOG_LEVEL as any || "error" });
  await _client.start();
  return _client;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (Azure BYOM). See .env.example.`);
  return v.replace(/\/+$/, "");
}
