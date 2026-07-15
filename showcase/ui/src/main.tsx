import { createRoot } from "react-dom/client";
import { API_BASE, type AgentInfo } from "./config";
import App from "./App";
import "@copilotkit/react-core/v2/styles.css";
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

void (async () => {
  const { agents, live } = await loadAgents();
  createRoot(document.getElementById("app")!).render(<App agents={agents} live={live} />);
})();
