// Showcase gallery + chat shell. Renders one card per agent (fetched live from the
// gateway's /agents, with a bundled fallback so the portfolio still renders if the
// backend is asleep), and opens an AG-UI chat drawer when you click "Try it".

import { API_BASE, sourceUrl, type AgentInfo } from "./config";
import { Chat } from "./chat";
import "./styles.css";

// Fallback registry — keeps the gallery (concept + source links) alive even when
// the always-on gateway is unreachable. Live data from /agents overrides this.
const FALLBACK_AGENTS: AgentInfo[] = [
  {
    id: "agentic-copilot-foundry",
    title: "Agentic Assistant (HITL)",
    agentName: "forgewright_app",
    tagline: "The canonical stack: read freely, but every consequential action pauses for your approval.",
    description:
      "A minimal but complete AG-UI + Foundry hosted-agent app. It can read a value and apply a delta — and any change pauses on a human-in-the-loop approval card before it executes.",
    stack: ["AG-UI", "Microsoft Agent Framework", "Azure AI Foundry"],
    sourcePath: "templates/agentic-copilot-foundry",
    tryPrompts: ["What is the current value?", "Apply a delta of 25."],
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
    tryPrompts: ["Start a new claim from my documents.", "Submit the claim."],
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
    /* gateway asleep — fall back to the bundled registry */
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

function card(info: AgentInfo): HTMLElement {
  const c = el("article", "card");
  c.appendChild(el("h3", "card-title", info.title));
  c.appendChild(el("p", "card-tagline", info.tagline));
  const chips = el("div", "chips");
  for (const s of info.stack) chips.appendChild(el("span", "chip", s));
  c.appendChild(chips);
  c.appendChild(el("p", "card-desc", info.description));

  const actions = el("div", "card-actions");
  const tryBtn = el("button", "btn primary", "▶ Try it");
  tryBtn.onclick = () => openChat(info);
  const src = el("a", "btn ghost", "‹ › View source");
  (src as HTMLAnchorElement).href = sourceUrl(info.sourcePath);
  (src as HTMLAnchorElement).target = "_blank";
  (src as HTMLAnchorElement).rel = "noopener";
  actions.appendChild(tryBtn);
  actions.appendChild(src);
  c.appendChild(actions);
  return c;
}

let openChatRef: { close: () => void } | null = null;

function openChat(info: AgentInfo): void {
  openChatRef?.close();
  const overlay = el("div", "drawer-overlay");
  const drawer = el("aside", "drawer");

  const head = el("div", "drawer-head");
  head.appendChild(el("div", "drawer-title", `${info.title}`));
  const close = el("button", "drawer-close", "✕");
  const closeFn = () => {
    overlay.remove();
    openChatRef = null;
  };
  close.onclick = closeFn;
  head.appendChild(close);
  drawer.appendChild(head);

  const transcript = el("div", "transcript");
  const empty = el("div", "transcript-empty");
  empty.innerHTML = `<p>Try one of these:</p>`;
  const quick = el("div", "quick");
  for (const p of info.tryPrompts) {
    const b = el("button", "quick-chip", p);
    b.onclick = () => doSend(p);
    quick.appendChild(b);
  }
  empty.appendChild(quick);
  transcript.appendChild(empty);
  drawer.appendChild(transcript);

  const chat = new Chat(info, transcript);

  const form = el("form", "composer") as HTMLFormElement;
  const input = el("input", "composer-input") as HTMLInputElement;
  input.placeholder = "Ask the agent…";
  input.autocomplete = "off";
  const send = el("button", "btn primary", "Send") as HTMLButtonElement;
  send.type = "submit";
  form.appendChild(input);
  form.appendChild(send);

  function doSend(text: string) {
    empty.remove();
    input.value = "";
    chat.send(text);
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    doSend(input.value);
  };
  drawer.appendChild(form);

  overlay.appendChild(drawer);
  overlay.onclick = (e) => {
    if (e.target === overlay) closeFn();
  };
  document.body.appendChild(overlay);
  input.focus();
  openChatRef = { close: closeFn };
}

function render(agents: AgentInfo[], live: boolean): void {
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  const header = el("header", "topbar");
  header.innerHTML = `
    <span class="logo">⚒︎</span>
    <span class="brand">forgewright</span>
    <span class="brand-sub">Agent Showcase</span>
    <span class="spacer"></span>
    <span class="status ${live ? "live" : "idle"}">${live ? "● gateway live" : "○ gateway asleep"}</span>
    <a class="topbar-link" href="https://github.com/lordlinus/forgewright" target="_blank" rel="noopener">GitHub ↗</a>
  `;
  app.appendChild(header);

  const hero = el("section", "hero");
  hero.innerHTML = `
    <h1>A portfolio of <span class="accent">agentic apps</span> you can try right now.</h1>
    <p class="lede">
      Each app is one <strong>Microsoft Agent Framework</strong> agent, served over the open
      <a href="https://docs.ag-ui.com/introduction" target="_blank" rel="noopener">AG-UI</a> protocol,
      connected keyless to <strong>Azure AI Foundry</strong> — with native
      <strong>human-in-the-loop approval</strong> on every consequential action.
      Click <em>Try it</em> to chat in your browser; click <em>View source</em> to build your own.
    </p>
    <div class="arch">
      <span class="arch-node">This page<br/><small>GitHub Pages</small></span>
      <span class="arch-arrow">── AG-UI / SSE ▶</span>
      <span class="arch-node">One gateway<br/><small>Azure Container App</small></span>
      <span class="arch-arrow">▶</span>
      <span class="arch-node">N agents<br/><small>Foundry hosted</small></span>
    </div>
  `;
  app.appendChild(hero);

  const gallery = el("section", "gallery");
  for (const a of agents) gallery.appendChild(card(a));
  app.appendChild(gallery);

  const footer = el("footer", "footer");
  footer.innerHTML = `Built with the <a href="https://github.com/lordlinus/forgewright" target="_blank" rel="noopener">forgewright</a> template gallery · AG-UI · CopilotKit-compatible · Azure AI Foundry`;
  app.appendChild(footer);
}

(async () => {
  const { agents, live } = await loadAgents();
  render(agents, live);
})();
