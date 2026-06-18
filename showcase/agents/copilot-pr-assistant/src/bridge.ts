// AG-UI ⇆ Copilot SDK bridge.
//
// Implements the forgewright HITL *replay* contract on top of the Copilot SDK so
// the existing showcase UI works unchanged:
//   • Run 1 (prompt): stream Copilot's reasoning/text + read-tool chips. When the
//     model calls `propose_pull_request`, emit a synthetic `confirm_changes` tool
//     call and finish the run (the PR is NOT opened yet).
//   • Run 2 (approve/reject): the client re-sends history with a tool result
//     {accepted}. We open (or skip) the PR, then ask the model to confirm and
//     stream that. Sessions persist per AG-UI threadId.

import type { ServerResponse } from "node:http";
import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import {
  AGENT_NAME,
  PROPOSE_TOOL,
  MODEL_NAME,
  SYSTEM_MESSAGE,
  availableTools,
  buildProvider,
  buildTools,
  getClient,
  openPullRequest,
} from "./agent.js";
import { AgUiStream, uid, type AgUiMessage } from "./agui.js";

interface ThreadState {
  session: CopilotSession;
  pending: { confirmId: string; proposal: { title: string; body: string; base: string; head: string } } | null;
}

const THREADS = new Map<string, ThreadState>();

export interface RunInput {
  threadId?: string;
  runId?: string;
  messages?: AgUiMessage[];
}

async function ensureSession(threadId: string): Promise<ThreadState> {
  const existing = THREADS.get(threadId);
  if (existing) return existing;
  const client: CopilotClient = await getClient();
  const session = await client.createSession({
    sessionId: threadId,
    model: MODEL_NAME,
    provider: await buildProvider(),
    tools: buildTools(),
    availableTools: availableTools(),
    systemMessage: { mode: "replace", content: SYSTEM_MESSAGE },
    // omit onPermissionRequest — read tools use skipPermission; the consequential
    // gate is enforced in this bridge, not by the SDK permission flow.
    streaming: true,
  } as any);
  const st: ThreadState = { session, pending: null };
  THREADS.set(threadId, st);
  return st;
}

function lastUserPrompt(messages: AgUiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content || "";
  }
  return "";
}

function findApproval(messages: AgUiMessage[], confirmId: string): boolean | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "tool" && m.toolCallId === confirmId && typeof m.content === "string") {
      try {
        const parsed = JSON.parse(m.content);
        if (parsed && typeof parsed === "object" && "accepted" in parsed) return !!parsed.accepted;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

// Stream one Copilot turn into AG-UI events. Resolves when the session goes idle.
// Returns { paused: true } if the turn hit the propose gate.
function streamTurn(
  st: ThreadState,
  stream: AgUiStream,
  opts: { gateOnPropose: boolean },
): Promise<{ paused: boolean }> {
  return new Promise((resolve, reject) => {
    const session = st.session;
    const unsubs: Array<() => void> = [];
    const streamed = new Set<string>();
    const surfaced = new Set<string>();
    let openTextId: string | null = null;
    let paused = false;
    let settled = false;

    const ensureText = (messageId: string) => {
      if (openTextId && openTextId !== messageId) {
        stream.textEnd(openTextId);
        openTextId = null;
      }
      if (openTextId !== messageId) {
        stream.textStart(messageId);
        openTextId = messageId;
      }
    };
    const closeText = () => {
      if (openTextId) {
        stream.textEnd(openTextId);
        openTextId = null;
      }
    };
    const cleanup = () => unsubs.forEach((u) => u());
    const finish = (result: { paused: boolean }) => {
      if (settled) return;
      settled = true;
      closeText();
      cleanup();
      resolve(result);
    };

    unsubs.push(
      session.on("assistant.message_delta", (e: any) => {
        const id = e.data.messageId as string;
        streamed.add(id);
        ensureText(id);
        stream.textContent(id, e.data.deltaContent || "");
      }),
    );
    unsubs.push(
      session.on("assistant.message", (e: any) => {
        const id = e.data.messageId as string;
        if (!streamed.has(id) && e.data.content) {
          ensureText(id);
          stream.textContent(id, e.data.content);
          streamed.add(id);
        }
      }),
    );
    unsubs.push(
      session.on("tool.execution_start", (e: any) => {
        const toolCallId = e.data.toolCallId as string;
        const toolName = e.data.toolName as string;
        const args = e.data.arguments ?? {};
        if (opts.gateOnPropose && toolName === PROPOSE_TOOL) {
          // The gate: turn the draft into a confirm_changes approval card.
          const proposal = {
            title: String(args.title ?? "Open pull request"),
            body: String(args.body ?? ""),
            base: String(args.base ?? "main"),
            head: String(args.head ?? "patch"),
          };
          const confirmId = uid("cc");
          st.pending = { confirmId, proposal };
          const parent = uid("msg");
          stream.toolStart(confirmId, "confirm_changes", parent);
          stream.toolArgs(
            confirmId,
            JSON.stringify({
              function_name: "open_pull_request",
              function_call_id: toolCallId,
              function_arguments: proposal,
              steps: [{ description: "Open the pull request", status: "enabled" }],
            }),
          );
          stream.toolEnd(confirmId);
          paused = true;
          return;
        }
        // Read tools → surface as chips.
        surfaced.add(toolCallId);
        stream.toolStart(toolCallId, toolName, uid("msg"));
        stream.toolArgs(toolCallId, JSON.stringify(args));
        stream.toolEnd(toolCallId);
      }),
    );
    unsubs.push(
      session.on("tool.execution_complete", (e: any) => {
        const toolCallId = e.data.toolCallId as string;
        // Only emit results for chips we surfaced (not the gated propose tool).
        if (!surfaced.has(toolCallId)) return;
        const result = e.data.result?.content ?? e.data.result ?? "";
        stream.toolResult(uid("tres"), toolCallId, typeof result === "string" ? result : JSON.stringify(result));
      }),
    );
    unsubs.push(
      session.on("session.idle", () => finish({ paused })),
    );
    unsubs.push(
      session.on("session.error", (e: any) => {
        if (settled) return;
        settled = true;
        closeText();
        cleanup();
        reject(new Error(e?.data?.message || "session error"));
      }),
    );
  });
}

export async function handleRun(res: ServerResponse, body: RunInput): Promise<void> {
  const threadId = body.threadId || uid("thread");
  const runId = body.runId || uid("run");
  const messages = body.messages || [];
  const stream = new AgUiStream(res);
  stream.init();
  stream.runStarted(threadId, runId);

  try {
    const st = await ensureSession(threadId);

    // ── Approval resume? ──────────────────────────────────────────────────────
    if (st.pending) {
      const accepted = findApproval(messages, st.pending.confirmId);
      if (accepted !== null) {
        const { proposal, confirmId } = st.pending;
        st.pending = null;
        // Deterministic resume — no second model round-trip needed for a HITL
        // decision (keeps it fast + avoids the model re-calling tools).
        const msgId = uid("msg");
        stream.textStart(msgId);
        if (accepted) {
          const pr = openPullRequest(proposal);
          const openId = uid("open");
          stream.toolStart(openId, "open_pull_request", uid("msg"));
          stream.toolArgs(openId, JSON.stringify(proposal));
          stream.toolEnd(openId);
          stream.toolResult(uid("tres"), openId, JSON.stringify({ status: "ok", ...pr }));
          // Resolve the confirm card's executed-result signal (UI shows Approved).
          stream.toolResult(uid("tres"), confirmId, JSON.stringify({ status: "ok", number: pr.number }));
          stream.textContent(msgId, `✅ Pull request #${pr.number} opened — ${pr.url}`);
        } else {
          stream.toolResult(uid("tres"), confirmId, JSON.stringify({ accepted: false }));
          stream.textContent(msgId, "Okay — I won't open the pull request. Tell me what to change.");
        }
        stream.textEnd(msgId);
        stream.runFinished(threadId, runId);
        stream.end();
        return;
      }
    }

    // ── New prompt ────────────────────────────────────────────────────────────
    const prompt = lastUserPrompt(messages);
    if (prompt) await st.session.send({ prompt });
    const { paused } = await streamTurn(st, stream, { gateOnPropose: true });

    if (paused && st.pending) {
      // Persist the confirm_changes in a snapshot so history replay is robust.
      stream.messagesSnapshot([
        { id: uid("u"), role: "user", content: prompt },
        {
          id: uid("a"),
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: st.pending.confirmId,
              type: "function",
              function: {
                name: "confirm_changes",
                arguments: JSON.stringify({
                  function_name: "open_pull_request",
                  function_arguments: st.pending.proposal,
                  steps: [{ description: "Open the pull request", status: "enabled" }],
                }),
              },
            },
          ],
        },
      ]);
    }
    stream.runFinished(threadId, runId);
    stream.end();
  } catch (err: any) {
    stream.runError(String(err?.message || err));
    stream.runFinished(threadId, runId);
    stream.end();
  }
}

export { AGENT_NAME };
