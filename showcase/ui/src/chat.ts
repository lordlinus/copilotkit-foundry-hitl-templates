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

type Role = "user" | "assistant" | "tool" | "system" | "developer";
interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}
interface Msg {
  id: string;
  role: Role;
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeParse(s: string | undefined): any {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// A flat record = an object whose values are all scalars (string/number/boolean/
// null). These render cleanly as a form; nested objects fall back to JSON.
function isFlatRecord(v: any): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  if (!entries.length) return false;
  return entries.every(([, val]) => val === null || ["string", "number", "boolean"].includes(typeof val));
}

// "billed_amount" -> "Billed Amount"
function humanizeLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export class Chat {
  private agent: any;
  private running = false;
  private errored: string | null = null;

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

  // Has this confirm_changes tool call already been answered?
  private isResolved(toolCallId: string): boolean {
    return this.messages.some((m) => m.role === "tool" && m.toolCallId === toolCallId);
  }

  private toolResult(toolCallId: string): any | null {
    const m = this.messages.find((x) => x.role === "tool" && x.toolCallId === toolCallId);
    return m ? safeParse(m.content) : null;
  }

  // What is the user actually approving? An AG-UI `confirm_changes` carries the
  // gated tool's name + arguments. Tools that act on explicit inputs (e.g.
  // transfer_funds) put the change in those arguments. Tools that act on
  // server-side state (e.g. submit_claim, which takes no arguments) carry empty
  // arguments — for those, the change is the latest state the agent read/built
  // via a prior tool (e.g. the claim `form`). This resolves both into one
  // preview so the card always shows the concrete change under review.
  private approvalPreview(parsed: any): { label: string; data: any } {
    let fnArgs = parsed.function_arguments ?? {};
    if (typeof fnArgs === "string") fnArgs = safeParse(fnArgs);
    if (fnArgs && typeof fnArgs === "object" && Object.keys(fnArgs).length > 0) {
      return { label: "Change to apply", data: fnArgs };
    }
    // No explicit arguments — the change lives in server state. Use the most
    // recent structured tool result, preferring a `form` object.
    let state: { label: string; data: any } | null = null;
    for (const m of this.messages) {
      if (m.role !== "assistant") continue;
      for (const tc of m.toolCalls || []) {
        if (tc.function?.name === "confirm_changes") continue;
        const res = this.toolResult(tc.id);
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

  // ── Rendering ──────────────────────────────────────────────────────────────
  private render(): void {
    const el = this.transcriptEl;
    el.innerHTML = "";

    for (const m of this.messages) {
      if (m.role === "user") {
        el.appendChild(bubble("user", m.content || ""));
        continue;
      }
      if (m.role === "assistant") {
        if (m.content && m.content.trim()) el.appendChild(bubble("assistant", m.content));
        for (const tc of m.toolCalls || []) this.renderToolCall(el, tc);
        continue;
      }
      // tool-result messages are rendered inline with their tool call; skip here.
    }

    if (this.running) el.appendChild(typing());
    if (this.errored) el.appendChild(errorBubble(this.errored));

    // Scroll after the browser has laid out the new nodes (a synchronous
    // scrollTop here runs before the approval card's height is known, leaving
    // it below the fold). Prefer bringing a pending approval fully into view.
    requestAnimationFrame(() => {
      const pending = el.querySelector(
        ".approval:not(.approved):not(.rejected)",
      ) as HTMLElement | null;
      if (pending) {
        pending.scrollIntoView({ block: "end" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  private renderToolCall(el: HTMLElement, tc: ToolCall): void {
    const name = tc.function?.name;
    if (name === "confirm_changes") {
      this.renderApproval(el, tc);
      return;
    }
    const result = this.toolResult(tc.id);
    const chip = document.createElement("div");
    chip.className = "toolchip";
    const args = safeParse(tc.function?.arguments);
    chip.textContent = `🔧 ${name}${argSummary(args)}`;
    el.appendChild(chip);
    if (!result || typeof result !== "object" || !Object.keys(result).length) return;

    // Data-driven rendering of structured results:
    //  - a `form` object → an editable form (the review-and-edit surface)
    //  - a single field update ({field, value}) → a compact "updated" line
    //  - anything else → compact JSON
    if (result.form && isFlatRecord(result.form)) {
      const label = result.reference
        ? `Claim form · ${result.reference}`
        : result.status
          ? `Claim form · ${result.status}`
          : "Claim form";
      this.renderForm(el, result.form, label, /* editable */ true);
    } else if (typeof result.field === "string" && "value" in result) {
      const line = document.createElement("div");
      line.className = "toolresult";
      line.textContent = `✎ ${humanizeLabel(result.field)} → ${String(result.value)}`;
      el.appendChild(line);
    } else {
      const r = document.createElement("div");
      r.className = "toolresult";
      r.textContent = compact(result);
      el.appendChild(r);
    }
  }

  // Render a flat record as a form. When editable, changing a field sends a
  // natural-language correction to the agent, which calls its update tool — the
  // same "review and edit" loop the agent is designed for (no field is special-
  // cased; this works for any agent that exposes a form + an update tool).
  private renderForm(
    el: HTMLElement,
    form: Record<string, any>,
    label: string,
    editable: boolean,
  ): void {
    const card = document.createElement("div");
    card.className = "formcard";
    const head = document.createElement("div");
    head.className = "formcard-head";
    head.textContent = label;
    card.appendChild(head);

    for (const [key, value] of Object.entries(form)) {
      const row = document.createElement("label");
      row.className = "formrow";
      const lbl = document.createElement("span");
      lbl.className = "formrow-label";
      lbl.textContent = humanizeLabel(key);
      row.appendChild(lbl);

      if (editable) {
        const input = document.createElement("input");
        input.className = "formrow-input";
        input.value = String(value ?? "");
        input.disabled = this.running;
        const commit = () => {
          const next = input.value.trim();
          if (next === String(value ?? "")) return;
          input.disabled = true;
          // The agent owns the write: it interprets this and calls its update
          // tool, so server state stays the single source of truth.
          void this.send(`Set ${key} to ${next}.`);
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
          if ((e as KeyboardEvent).key === "Enter") {
            e.preventDefault();
            input.blur();
          }
        });
        row.appendChild(input);
      } else {
        const val = document.createElement("span");
        val.className = "formrow-value";
        val.textContent = String(value ?? "");
        row.appendChild(val);
      }
      card.appendChild(row);
    }
    el.appendChild(card);
  }

  private renderApproval(el: HTMLElement, tc: ToolCall): void {
    const parsed = safeParse(tc.function?.arguments);
    const fnName = String(parsed.function_name ?? "action");
    const steps = parsed.steps ?? [{ description: `Execute ${fnName}`, status: "enabled" }];

    const card = document.createElement("div");
    card.className = "approval";

    if (this.isResolved(tc.id)) {
      const res = this.toolResult(tc.id);
      const accepted = res?.accepted === true;
      card.classList.add(accepted ? "approved" : "rejected");
      card.innerHTML = `<div class="approval-head">${accepted ? "✓ Approved" : "✕ Rejected"} <span class="pill">HUMAN-IN-THE-LOOP</span></div>`;
      el.appendChild(card);
      return;
    }

    const head = document.createElement("div");
    head.className = "approval-head";
    head.innerHTML = `✋ Approval required <span class="pill">HUMAN-IN-THE-LOOP</span>`;
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "approval-body";
    const fn = document.createElement("div");
    fn.className = "fn";
    fn.textContent = fnName;
    body.appendChild(fn);

    // Always show the concrete change under review (explicit tool arguments, or
    // the server-side state the agent prepared), so the user knows what Approve
    // will execute. A form-shaped change renders as a form; anything else as JSON.
    const preview = this.approvalPreview(parsed);
    const lbl = document.createElement("div");
    lbl.className = "args-label";
    lbl.textContent = preview.label;
    body.appendChild(lbl);
    if (isFlatRecord(preview.data)) {
      this.renderForm(body, preview.data, "Review before submit", /* editable */ false);
    } else {
      const pre = document.createElement("pre");
      pre.className = "args";
      pre.textContent = JSON.stringify(preview.data, null, 2);
      body.appendChild(pre);
    }

    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const approve = document.createElement("button");
    approve.className = "btn approve";
    approve.textContent = "Approve";
    approve.disabled = this.running;
    approve.onclick = () => this.resolveApproval(tc.id, true, steps);
    const reject = document.createElement("button");
    reject.className = "btn reject";
    reject.textContent = "Reject";
    reject.disabled = this.running;
    reject.onclick = () => this.resolveApproval(tc.id, false, steps);
    actions.appendChild(approve);
    actions.appendChild(reject);
    body.appendChild(actions);
    card.appendChild(body);
    el.appendChild(card);
  }
}

// ── tiny DOM helpers ───────────────────────────────────────────────────────
function bubble(role: "user" | "assistant", text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = `msg ${role}`;
  d.textContent = text;
  return d;
}
function typing(): HTMLElement {
  const d = document.createElement("div");
  d.className = "msg assistant typing";
  d.innerHTML = "<span></span><span></span><span></span>";
  return d;
}
function errorBubble(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "msg error";
  d.textContent = `⚠ ${text}`;
  return d;
}
function argSummary(args: any): string {
  const keys = Object.keys(args || {});
  if (!keys.length) return "";
  return ` · ${keys.map((k) => `${k}=${JSON.stringify(args[k])}`).join(", ")}`;
}
function compact(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}
