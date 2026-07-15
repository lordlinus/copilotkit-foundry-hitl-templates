// Pure message/tool-payload helpers — no React, no network. Kept free of
// dependencies so the tier-1 tests (test/dom.test.mjs) can exercise exactly
// what ships without a browser.

export type Role = "user" | "assistant" | "tool" | "system" | "developer";

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface Msg {
  id: string;
  role: Role;
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export function safeParse(s: unknown): any {
  if (s == null) return {};
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// A flat record = an object whose values are all scalars (string/number/boolean/
// null). These render cleanly as a form; nested objects fall back to JSON.
export function isFlatRecord(v: any): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  if (!entries.length) return false;
  return entries.every(([, val]) => val === null || ["string", "number", "boolean"].includes(typeof val));
}

// "billed_amount" -> "Billed Amount"
export function humanizeLabel(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function argSummary(args: any): string {
  const keys = Object.keys(args || {});
  if (!keys.length) return "";
  return keys.map((k) => `${k}=${JSON.stringify(args[k])}`).join(", ");
}

function toolResult(messages: Msg[], toolCallId: string): any | null {
  const m = messages.find((x) => x.role === "tool" && x.toolCallId === toolCallId);
  return m ? safeParse(m.content) : null;
}

// What is the user actually approving? `confirm_changes` carries the gated tool's
// name + arguments. Tools that act on explicit inputs (transfer_funds) put the
// change in those arguments. Tools that act on server-side state (submit_claim,
// no arguments) carry empty arguments — for those, the change is the latest state
// the agent prepared via a prior tool (e.g. the claim `form`). One preview covers both.
export function approvalPreview(messages: Msg[], parsed: any): { label: string; data: any } {
  let fnArgs = parsed.function_arguments ?? {};
  if (typeof fnArgs === "string") fnArgs = safeParse(fnArgs);
  if (fnArgs && typeof fnArgs === "object" && Object.keys(fnArgs).length > 0) {
    return { label: "Change to apply", data: fnArgs };
  }
  let state: { label: string; data: any } | null = null;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const tc of m.toolCalls || []) {
      if (tc.function?.name === "confirm_changes") continue;
      const res = toolResult(messages, tc.id);
      if (!res || typeof res !== "object") continue;
      if (res.form && typeof res.form === "object") {
        state = { label: "Record to submit", data: res.form };
      } else if (Object.keys(res).length && !("accepted" in res)) {
        state = { label: "Current state", data: res };
      }
    }
  }
  return state ?? { label: "Change to apply", data: fnArgs };
}

// Was a resolved approval accepted? The user's live click is recorded by the
// component; this decodes the persisted tool result for reloads and backend
// content rewrites ({accepted} JSON, or "Confirmed"/"Rejected" strings).
export function decodeDecision(result: unknown): boolean {
  const parsed = safeParse(result);
  if (parsed && typeof parsed === "object" && "accepted" in parsed) return Boolean(parsed.accepted);
  const raw = String(result ?? "").toLowerCase();
  if (raw.includes("reject")) return false;
  return true;
}
