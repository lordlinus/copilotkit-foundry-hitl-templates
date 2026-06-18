// Minimal AG-UI event emitter over SSE. AG-UI is just newline-delimited JSON
// events on an SSE stream; these helpers write the exact event shapes the
// @ag-ui/client (and the forgewright showcase UI) consume.
export class AgUiStream {
    res;
    constructor(res) {
        this.res = res;
    }
    init() {
        this.res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
    }
    send(event) {
        this.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    runStarted(threadId, runId) {
        this.send({ type: "RUN_STARTED", threadId, runId });
    }
    runFinished(threadId, runId) {
        this.send({ type: "RUN_FINISHED", threadId, runId });
    }
    runError(message, code = "AGENT_ERROR") {
        this.send({ type: "RUN_ERROR", message, code });
    }
    textStart(messageId) {
        this.send({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
    }
    textContent(messageId, delta) {
        if (!delta)
            return;
        this.send({ type: "TEXT_MESSAGE_CONTENT", messageId, delta });
    }
    textEnd(messageId) {
        this.send({ type: "TEXT_MESSAGE_END", messageId });
    }
    toolStart(toolCallId, toolCallName, parentMessageId) {
        this.send({ type: "TOOL_CALL_START", toolCallId, toolCallName, parentMessageId });
    }
    toolArgs(toolCallId, delta) {
        this.send({ type: "TOOL_CALL_ARGS", toolCallId, delta });
    }
    toolEnd(toolCallId) {
        this.send({ type: "TOOL_CALL_END", toolCallId });
    }
    toolResult(messageId, toolCallId, content) {
        this.send({ type: "TOOL_CALL_RESULT", messageId, toolCallId, content, role: "tool" });
    }
    messagesSnapshot(messages) {
        this.send({ type: "MESSAGES_SNAPSHOT", messages });
    }
    end() {
        this.res.end();
    }
}
export function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}
