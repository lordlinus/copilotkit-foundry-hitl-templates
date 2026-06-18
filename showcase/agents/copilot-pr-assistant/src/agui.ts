// Minimal AG-UI event emitter over SSE. AG-UI is just newline-delimited JSON
// events on an SSE stream; these helpers write the exact event shapes the
// @ag-ui/client (and the forgewright showcase UI) consume.

import type { ServerResponse } from "node:http";

export type AgUiMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "developer";
  content?: string;
  toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  toolCallId?: string;
};

export class AgUiStream {
  constructor(private res: ServerResponse) {}

  init(): void {
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  }

  private send(event: Record<string, unknown>): void {
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  runStarted(threadId: string, runId: string): void {
    this.send({ type: "RUN_STARTED", threadId, runId });
  }
  runFinished(threadId: string, runId: string): void {
    this.send({ type: "RUN_FINISHED", threadId, runId });
  }
  runError(message: string, code = "AGENT_ERROR"): void {
    this.send({ type: "RUN_ERROR", message, code });
  }

  textStart(messageId: string): void {
    this.send({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
  }
  textContent(messageId: string, delta: string): void {
    if (!delta) return;
    this.send({ type: "TEXT_MESSAGE_CONTENT", messageId, delta });
  }
  textEnd(messageId: string): void {
    this.send({ type: "TEXT_MESSAGE_END", messageId });
  }

  toolStart(toolCallId: string, toolCallName: string, parentMessageId: string): void {
    this.send({ type: "TOOL_CALL_START", toolCallId, toolCallName, parentMessageId });
  }
  toolArgs(toolCallId: string, delta: string): void {
    this.send({ type: "TOOL_CALL_ARGS", toolCallId, delta });
  }
  toolEnd(toolCallId: string): void {
    this.send({ type: "TOOL_CALL_END", toolCallId });
  }
  toolResult(messageId: string, toolCallId: string, content: string): void {
    this.send({ type: "TOOL_CALL_RESULT", messageId, toolCallId, content, role: "tool" });
  }

  messagesSnapshot(messages: AgUiMessage[]): void {
    this.send({ type: "MESSAGES_SNAPSHOT", messages });
  }

  end(): void {
    this.res.end();
  }
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}
