// Pure transcript rendering — no @ag-ui/client, no network, no `Chat` state.
// `renderTranscript(el, model)` turns a list of AG-UI messages into DOM. Keeping
// it pure makes it unit-testable under jsdom (see test/dom.test.mjs) with recorded
// per-agent message fixtures, so render/UX regressions are caught without a browser.

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

export interface TranscriptModel {
  messages: Msg[];
  running: boolean;
  errored: string | null;
  // Tool-call ids whose form widget is currently expanded (load-on-demand).
  expandedForms: Set<string>;
  onApprove: (toolCallId: string, steps: any) => void;
  onReject: (toolCallId: string, steps: any) => void;
  onEditField: (key: string, value: string) => void;
  onToggleForm: (toolCallId: string) => void;
}

export function safeParse(s: string | undefined): any {
  if (!s) return {};
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

function isResolved(messages: Msg[], toolCallId: string): boolean {
  return messages.some((m) => m.role === "tool" && m.toolCallId === toolCallId);
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

function renderForm(
  el: HTMLElement,
  form: Record<string, any>,
  label: string,
  editable: boolean,
  model: TranscriptModel,
): void {
  const card = el.ownerDocument.createElement("div");
  card.className = "formcard";
  const head = el.ownerDocument.createElement("div");
  head.className = "formcard-head";
  head.textContent = label;
  card.appendChild(head);

  for (const [key, value] of Object.entries(form)) {
    const row = el.ownerDocument.createElement("label");
    row.className = "formrow";
    const lbl = el.ownerDocument.createElement("span");
    lbl.className = "formrow-label";
    lbl.textContent = humanizeLabel(key);
    row.appendChild(lbl);

    if (editable) {
      const input = el.ownerDocument.createElement("input");
      input.className = "formrow-input";
      input.value = String(value ?? "");
      input.disabled = model.running;
      const commit = () => {
        const next = input.value.trim();
        if (next === String(value ?? "")) return;
        input.disabled = true;
        // The agent owns the write: it interprets this and calls its update tool,
        // so server state stays the single source of truth.
        model.onEditField(key, next);
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") {
          e.preventDefault();
          (input as HTMLInputElement).blur();
        }
      });
      row.appendChild(input);
    } else {
      const val = el.ownerDocument.createElement("span");
      val.className = "formrow-value";
      val.textContent = String(value ?? "");
      row.appendChild(val);
    }
    card.appendChild(row);
  }
  el.appendChild(card);
}

function renderApproval(el: HTMLElement, tc: ToolCall, model: TranscriptModel): void {
  const doc = el.ownerDocument;
  const parsed = safeParse(tc.function?.arguments);
  const fnName = String(parsed.function_name ?? "action");
  const steps = parsed.steps ?? [{ description: `Execute ${fnName}`, status: "enabled" }];

  const card = doc.createElement("div");
  card.className = "approval";

  if (isResolved(model.messages, tc.id)) {
    const res = toolResult(model.messages, tc.id);
    const accepted = res?.accepted === true;
    card.classList.add(accepted ? "approved" : "rejected");
    card.innerHTML = `<div class="approval-head">${accepted ? "✓ Approved" : "✕ Rejected"} <span class="pill">HUMAN-IN-THE-LOOP</span></div>`;
    el.appendChild(card);
    return;
  }

  const head = doc.createElement("div");
  head.className = "approval-head";
  head.innerHTML = `✋ Approval required <span class="pill">HUMAN-IN-THE-LOOP</span>`;
  card.appendChild(head);

  const body = doc.createElement("div");
  body.className = "approval-body";
  const fn = doc.createElement("div");
  fn.className = "fn";
  fn.textContent = fnName;
  body.appendChild(fn);

  // Always show the concrete change under review. A form-shaped change renders as
  // a form; anything else as JSON.
  const preview = approvalPreview(model.messages, parsed);
  const lbl = doc.createElement("div");
  lbl.className = "args-label";
  lbl.textContent = preview.label;
  body.appendChild(lbl);
  if (isFlatRecord(preview.data)) {
    renderForm(body, preview.data, "Review before submit", false, model);
  } else {
    const pre = doc.createElement("pre");
    pre.className = "args";
    pre.textContent = JSON.stringify(preview.data, null, 2);
    body.appendChild(pre);
  }

  const actions = doc.createElement("div");
  actions.className = "approval-actions";
  const approve = doc.createElement("button");
  approve.className = "btn approve";
  approve.textContent = "Approve";
  approve.disabled = model.running;
  approve.onclick = () => model.onApprove(tc.id, steps);
  const reject = doc.createElement("button");
  reject.className = "btn reject";
  reject.textContent = "Reject";
  reject.disabled = model.running;
  reject.onclick = () => model.onReject(tc.id, steps);
  actions.appendChild(approve);
  actions.appendChild(reject);
  body.appendChild(actions);
  card.appendChild(body);
  el.appendChild(card);
}

function renderToolCall(el: HTMLElement, tc: ToolCall, model: TranscriptModel): void {
  const doc = el.ownerDocument;
  const name = tc.function?.name;
  if (name === "confirm_changes") {
    renderApproval(el, tc, model);
    return;
  }
  const result = toolResult(model.messages, tc.id);
  const chip = doc.createElement("div");
  chip.className = "toolchip";
  const args = safeParse(tc.function?.arguments);
  chip.textContent = `🔧 ${name}${argSummary(args)}`;
  el.appendChild(chip);
  if (!result || typeof result !== "object" || !Object.keys(result).length) return;

  // Data-driven rendering of structured results:
  //  - a `form` object → a load-on-demand form: a compact toggle that lazily
  //    expands the editable form (keeps the chat clean; the form is one click away)
  //  - a single field update ({field, value}) → a compact "updated" line
  //  - anything else → compact JSON
  if (result.form && isFlatRecord(result.form)) {
    const label = result.reference
      ? `Claim form · ${result.reference}`
      : result.status
        ? `Claim form · ${result.status}`
        : "Claim form";
    const expanded = model.expandedForms.has(tc.id);
    const toggle = doc.createElement("button");
    toggle.className = "form-toggle";
    toggle.textContent = `📋 ${label} ${expanded ? "▾" : "▸"}`;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.onclick = () => model.onToggleForm(tc.id);
    el.appendChild(toggle);
    if (expanded) {
      renderForm(el, result.form, label, true, model);
    }
  } else if (typeof result.field === "string" && "value" in result) {
    const line = doc.createElement("div");
    line.className = "toolresult";
    line.textContent = `✎ ${humanizeLabel(result.field)} → ${String(result.value)}`;
    el.appendChild(line);
  } else {
    const r = doc.createElement("div");
    r.className = "toolresult";
    r.textContent = compact(result);
    el.appendChild(r);
  }
}

export function renderTranscript(el: HTMLElement, model: TranscriptModel): void {
  const doc = el.ownerDocument;
  el.innerHTML = "";

  for (const m of model.messages) {
    if (m.role === "user") {
      el.appendChild(bubble(doc, "user", m.content || ""));
      continue;
    }
    if (m.role === "assistant") {
      if (m.content && m.content.trim()) el.appendChild(bubble(doc, "assistant", m.content));
      for (const tc of m.toolCalls || []) renderToolCall(el, tc, model);
      continue;
    }
    // tool-result messages are rendered inline with their tool call; skip here.
  }

  if (model.running) el.appendChild(typing(doc));
  if (model.errored) el.appendChild(errorBubble(doc, model.errored));
}

// ── tiny DOM helpers ───────────────────────────────────────────────────────
function bubble(doc: Document, role: "user" | "assistant", text: string): HTMLElement {
  const d = doc.createElement("div");
  d.className = `msg ${role}`;
  d.textContent = text;
  return d;
}
function typing(doc: Document): HTMLElement {
  const d = doc.createElement("div");
  d.className = "msg assistant typing";
  d.innerHTML = "<span></span><span></span><span></span>";
  return d;
}
function errorBubble(doc: Document, text: string): HTMLElement {
  const d = doc.createElement("div");
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
