// AG-UI chat controller — talks DIRECTLY to the gateway over SSE using
// @ag-ui/client's HttpAgent. No CopilotKit runtime: we subscribe to AG-UI events,
// render the transcript from agent.messages, and implement the human-in-the-loop
// gate ourselves.
//
// HITL contract (identical to the CopilotKit path, just hand-rolled): when a tool
// marked approval_mode="always_require" is hit, the backend PAUSES and emits a
// synthetic `confirm_changes` tool call carrying { function_name,
// function_arguments, steps }. We render an Approve/Reject card; resolving it
// appends a tool-result message { accepted, steps } and re-runs the agent — the
// backend then executes (accept) or skips (reject) the real tool.

import { HttpAgent } from "@ag-ui/client";
import { agentEndpoint, type AgentInfo } from "./config";
import { renderTranscript, type Msg, type TranscriptModel } from "./transcript";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Chat {
  private agent: any;
  private running = false;
  private errored: string | null = null;
  private expandedForms = new Set<string>();
  private decisions = new Map<string, boolean>();

  constructor(info: AgentInfo, private transcriptEl: HTMLElement) {
    void info; // reserved for future per-agent rendering tweaks
    this.agent = new HttpAgent({
      url: agentEndpoint(info.id),
      // Bind fetch to window — @ag-ui/client otherwise calls a detached `fetch`
      // reference which throws "Illegal invocation" in the browser.
      fetch: (url: string, init: RequestInit) => window.fetch(url, init),
    });
    this.agent.subscribe({
      onRunStartedEvent: () => {
        this.running = true;
        this.errored = null;
        this.render();
      },
      onRunFinishedEvent: () => {
        this.running = false;
        this.render();
      },
      onRunErrorEvent: ({ event }: any) => {
        this.running = false;
        this.errored = event?.message || "The agent run failed.";
        this.render();
      },
      onMessagesChanged: () => this.render(),
      onStateChanged: () => this.render(),
    });
    this.render();
  }

  private get messages(): Msg[] {
    return (this.agent.messages as Msg[]) ?? [];
  }

  async send(text: string): Promise<void> {
    if (this.running || !text.trim()) return;
    this.agent.addMessage({ id: uid("u"), role: "user", content: text });
    this.render();
    await this.run();
  }

  private async run(): Promise<void> {
    try {
      await this.agent.runAgent();
    } catch (e: any) {
      this.running = false;
      this.errored = e?.message || String(e);
      this.render();
    }
  }

  private async resolveApproval(toolCallId: string, accepted: boolean, steps: any): Promise<void> {
    // Record the user's decision — authoritative even after the backend rewrites
    // the tool-result content in later snapshots.
    this.decisions.set(toolCallId, accepted);
    const resolvedSteps = accepted
      ? steps
      : (Array.isArray(steps) ? steps.map((s: any) => ({ ...s, status: "disabled" })) : steps);
    this.agent.addMessage({
      id: uid("t"),
      role: "tool",
      toolCallId,
      content: JSON.stringify({ accepted, steps: resolvedSteps }),
    });
    this.render();
    await this.run();
  }

  private editField(key: string, value: string): void {
    // The agent owns the write: it interprets this correction and calls its
    // update tool, keeping server state the single source of truth.
    void this.send(`Set ${key} to ${value}.`);
  }

  private toggleForm(toolCallId: string): void {
    if (this.expandedForms.has(toolCallId)) this.expandedForms.delete(toolCallId);
    else this.expandedForms.add(toolCallId);
    this.render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  private render(): void {
    const el = this.transcriptEl;
    const model: TranscriptModel = {
      messages: this.messages,
      running: this.running,
      errored: this.errored,
      expandedForms: this.expandedForms,
      decisions: this.decisions,
      onApprove: (id, steps) => this.resolveApproval(id, true, steps),
      onReject: (id, steps) => this.resolveApproval(id, false, steps),
      onEditField: (k, v) => this.editField(k, v),
      onToggleForm: (id) => this.toggleForm(id),
    };
    renderTranscript(el, model);

    // Scroll after layout (a synchronous scrollTop runs before a new approval
    // card's height is known). Bring the Approve/Reject buttons themselves into
    // view — the card can be taller than the panel, so scrolling to the card top
    // would leave the actions below the fold.
    requestAnimationFrame(() => {
      const actions = el.querySelector(
        ".approval:not(.approved):not(.rejected) .approval-actions",
      ) as HTMLElement | null;
      if (actions) actions.scrollIntoView({ block: "end" });
      else el.scrollTop = el.scrollHeight;
    });
  }
}
