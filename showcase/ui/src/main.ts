// Showcase front door — a two-panel "console":
//   • LEFT rail: agent picker, the selected agent's guided sample questions
//     (click to run), its tool list (capabilities at a glance), and a source link.
//   • RIGHT: the live AG-UI chat for the selected agent.

import { API_BASE, sourceUrl, type AgentInfo } from "./config";
import { Chat } from "./chat";
import "./styles.css";

// Bundled fallback so the console still renders if the gateway is asleep.
// Keep entries in sync with ../agents.json (the live gateway serves that file).
const FALLBACK_AGENTS: AgentInfo[] = [
  {
    id: "agentic-copilot-foundry",
    title: "Agentic Assistant (HITL)",
    agentName: "agentic_copilot_foundry",
    tagline: "The canonical stack: read freely, but every consequential action pauses for your approval.",
    description:
      "A minimal but complete CopilotKit + AG-UI + Foundry hosted-agent app. It can read a value and apply a delta — and any change pauses on a human-in-the-loop approval card before it executes.",
    stack: ["Next.js", "AG-UI", "Microsoft Agent Framework", "Azure AI Foundry"],
    sourcePath: "templates/agentic-copilot-foundry",
    tryPrompts: ["What is the current value?", "Apply a delta of 25."],
    tools: [
      { name: "get_value", description: "Read the current value" },
      { name: "apply_delta", description: "Change the value by a delta", consequential: true },
    ],
  },
  {
    id: "conversational-banking",
    title: "Conversational Banking (HITL)",
    agentName: "conversational_banking",
    tagline: "Check balances and activity freely — every money movement pauses for approval.",
    description:
      "A banking assistant that answers balance and transaction questions instantly, but routes transfers and bill payments through an Approve / Reject gate before any money moves.",
    stack: ["AG-UI", "Microsoft Agent Framework", "Azure AI Foundry"],
    sourcePath: "templates/conversational-banking",
    tryPrompts: ["What's my balance?", "Transfer $200 to my savings account."],
    tools: [
      { name: "get_balance", description: "Read account balances" },
      { name: "list_transactions", description: "List recent activity" },
      { name: "transfer_funds", description: "Move money between accounts", consequential: true },
      { name: "pay_bill", description: "Pay a biller", consequential: true },
    ],
  },
  {
    id: "health-claim-intake",
    title: "Health Claim Intake (HITL)",
    agentName: "health_claim_intake",
    tagline: "Auto-fill a claim from documents, review, then submit behind an approval gate.",
    description:
      "Intake multiple claim documents, auto-fill the claim form, let the user review and edit, then submit to the insurer behind a human-in-the-loop approval gate.",
    stack: ["AG-UI", "Microsoft Agent Framework", "Azure AI Foundry"],
    sourcePath: "templates/health-claim-intake",
    tryPrompts: ["List my claim documents", "Extract the claim form", "Submit the claim"],
    tools: [
      { name: "list_documents", description: "List uploaded claim documents" },
      { name: "extract_claim_form", description: "Auto-fill the claim from documents" },
      { name: "update_claim_field", description: "Correct a field on the claim" },
      { name: "submit_claim", description: "Submit the claim to the insurer", consequential: true },
    ],
  },
  {
    id: "copilot-pr-assistant",
    title: "Copilot PR Assistant (HITL)",
    agentName: "copilot_pr_assistant",
    tagline: "GitHub Copilot drafts a pull request — opening it pauses for your approval.",
    description:
      "Powered by the GitHub Copilot SDK (not Microsoft Agent Framework): Copilot reviews the changed files, drafts a PR title and body, and the open_pull_request action pauses on a human-in-the-loop approval card before it executes. Same AG-UI architecture, different engine.",
    stack: ["AG-UI", "GitHub Copilot SDK", "Azure (APIM) gpt-5"],
    sourcePath: "showcase/agents/copilot-pr-assistant",
    tryPrompts: ["List the changed files", "Review the changes and open a pull request"],
    tools: [
      { name: "list_changed_files", description: "List files changed on the branch" },
      { name: "get_file_diff", description: "Show the diff for a file" },
      { name: "propose_pull_request", description: "Draft + open the PR", consequential: true },
    ],
  },
];

async function loadAgents(): Promise<{ agents: AgentInfo[]; live: boolean }> {
  try {
    const r = await fetch(`${API_BASE}/agents`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.agents) && data.agents.length) return { agents: data.agents, live: true };
    }
  } catch {
    /* gateway asleep — use the bundled registry */
  }
  return { agents: FALLBACK_AGENTS, live: false };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

interface ConsoleState {
  agents: AgentInfo[];
  live: boolean;
  selectedId: string;
}

let currentChat: Chat | null = null;

function selectAgent(state: ConsoleState, id: string): void {
  state.selectedId = id;
  renderAgentPicker(state);
  renderDetail(state);
}

function renderAgentPicker(state: ConsoleState): void {
  const list = document.getElementById("agent-list")!;
  list.innerHTML = "";
  for (const a of state.agents) {
    const item = el("button", "agent-item" + (a.id === state.selectedId ? " active" : ""));
    item.dataset.agentId = a.id;
    item.innerHTML = `<span class="agent-item-title">${a.title}</span><span class="agent-item-tagline">${a.tagline}</span>`;
    item.onclick = () => selectAgent(state, a.id);
    list.appendChild(item);
  }
}

function renderDetail(state: ConsoleState): void {
  const agent = state.agents.find((a) => a.id === state.selectedId)!;

  // ── Left: guided questions + tools for the selected agent ──
  const guide = document.getElementById("agent-guide")!;
  guide.innerHTML = "";
  guide.appendChild(el("div", "guide-section-title", "Try asking"));
  const qWrap = el("div", "guide-questions");
  for (const p of agent.tryPrompts) {
    const b = el("button", "guide-question", p);
    b.onclick = () => runPrompt(p);
    qWrap.appendChild(b);
  }
  guide.appendChild(qWrap);

  if (agent.tools && agent.tools.length) {
    guide.appendChild(el("div", "guide-section-title", "Tools"));
    const tWrap = el("div", "guide-tools");
    for (const t of agent.tools) {
      const row = el("div", "guide-tool");
      row.innerHTML =
        `<span class="guide-tool-name">${t.name}</span>` +
        (t.consequential ? `<span class="guide-tool-badge">approval</span>` : "") +
        `<span class="guide-tool-desc">${t.description}</span>`;
      tWrap.appendChild(row);
    }
    guide.appendChild(tWrap);
  }

  const src = el("a", "guide-source", "‹ › View source");
  (src as HTMLAnchorElement).href = sourceUrl(agent.sourcePath);
  (src as HTMLAnchorElement).target = "_blank";
  (src as HTMLAnchorElement).rel = "noopener";
  guide.appendChild(src);

  // ── Right: a fresh chat panel bound to this agent ──
  const panel = document.getElementById("chat-panel")!;
  panel.innerHTML = "";
  panel.appendChild(el("div", "chat-head", `<span class="chat-title">${agent.title}</span>`));
  const transcript = el("div", "transcript");
  const empty = el("div", "transcript-empty");
  empty.innerHTML = `<p>Pick a sample question on the left, or ask your own below.</p>`;
  transcript.appendChild(empty);
  panel.appendChild(transcript);

  currentChat = new Chat(agent, transcript);

  const form = el("form", "composer") as HTMLFormElement;
  const input = el("input", "composer-input") as HTMLInputElement;
  input.placeholder = `Ask ${agent.title}…`;
  input.autocomplete = "off";
  const send = el("button", "btn primary", "Send") as HTMLButtonElement;
  send.type = "submit";
  form.appendChild(input);
  form.appendChild(send);
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    runPrompt(text);
  };
  panel.appendChild(form);
}

function runPrompt(text: string): void {
  if (!text.trim() || !currentChat) return;
  const empty = document.querySelector(".transcript-empty");
  if (empty) empty.remove();
  void currentChat.send(text);
}

function render(state: ConsoleState): void {
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  const header = el("header", "topbar");
  header.innerHTML = `
    <span class="logo">⚒︎</span>
    <span class="brand">CopilotKit + Foundry HITL</span>
    <span class="brand-sub">Agent Console</span>
    <span class="spacer"></span>
    <span class="status ${state.live ? "live" : "idle"}">${state.live ? "● gateway live" : "○ gateway asleep"}</span>
    <a class="topbar-link" href="https://github.com/lordlinus/copilotkit-foundry-hitl-templates" target="_blank" rel="noopener">GitHub ↗</a>
  `;
  app.appendChild(header);

  const main = el("div", "console");
  const rail = el("aside", "rail");
  rail.innerHTML = `
    <div class="rail-intro">
      <p>Each app is one agent over the open
        <a href="https://docs.ag-ui.com/introduction" target="_blank" rel="noopener">AG-UI</a>
        protocol with native <strong>human-in-the-loop approval</strong>. Pick an agent, then a
        sample question.</p>
      <p>Build your own: scaffold with
        <a href="https://github.com/lordlinus/copilotkit-foundry-hitl-templates#getting-started" target="_blank" rel="noopener">copilotkit-foundry-hitl-templates</a>,
        then develop with the
        <a href="https://awesome-copilot.github.com/skill/foundry-hosted-agent-copilotkit/" target="_blank" rel="noopener">foundry-hosted-agent-copilotkit</a>
        skill.</p>
    </div>
    <div class="rail-section-title">Agents</div>
    <div id="agent-list" class="agent-list"></div>
    <div id="agent-guide" class="agent-guide"></div>
  `;
  const panel = el("section", "chat-panel");
  panel.id = "chat-panel";
  main.appendChild(rail);
  main.appendChild(panel);
  app.appendChild(main);

  renderAgentPicker(state);
  renderDetail(state);
}

(async () => {
  const { agents, live } = await loadAgents();
  const state: ConsoleState = { agents, live, selectedId: agents[0]?.id };
  render(state);
})();
