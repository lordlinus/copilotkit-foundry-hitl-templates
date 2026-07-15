// Minimal AG-UI mock gateway for UI verification — speaks just enough of the
// protocol (SSE events) to drive the console's HITL flow without Azure:
//   • GET  /agents                → the agent registry
//   • POST /agents/:id/          → one scripted AG-UI run
// Scenarios: "balance" → read tool + result; "transfer" → confirm_changes
// pause; resumed with {accepted:true} → gated tool executes; "extract" → a
// claim form payload. Used by test/e2e and manual preview (localhost:8080).

import { createServer } from "node:http";

const AGENTS = [
  {
    id: "agentic-copilot-foundry",
    title: "Agentic Assistant (HITL)",
    agentName: "agentic_copilot_foundry",
    tagline: "The canonical stack: read freely, but every consequential action pauses for your approval.",
    description: "A minimal but complete CopilotKit + AG-UI + Foundry hosted-agent app.",
    stack: ["AG-UI"],
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
      "A banking assistant that answers balance and transaction questions instantly, but routes transfers through an Approve / Reject gate.",
    stack: ["AG-UI"],
    sourcePath: "templates/conversational-banking",
    tryPrompts: ["What's my balance?", "Transfer $200 to my savings account."],
    tools: [
      { name: "get_balance", description: "Read account balances" },
      { name: "transfer_funds", description: "Move money between accounts", consequential: true },
    ],
  },
  {
    id: "health-claim-intake",
    title: "Health Claim Intake (HITL)",
    agentName: "health_claim_intake",
    tagline: "Auto-fill a claim from documents, review, then submit behind an approval gate.",
    description: "Intake claim documents, auto-fill the claim form, review and edit, then submit behind a gate.",
    stack: ["AG-UI"],
    sourcePath: "templates/health-claim-intake",
    tryPrompts: ["Extract the claim form", "Submit the claim"],
    tools: [
      { name: "extract_claim_form", description: "Auto-fill the claim from documents" },
      { name: "submit_claim", description: "Submit the claim to the insurer", consequential: true },
    ],
  },
  {
    id: "copilot-pr-assistant",
    title: "Copilot PR Assistant (HITL)",
    agentName: "copilot_pr_assistant",
    tagline: "GitHub Copilot drafts a pull request — opening it pauses for your approval.",
    description: "Copilot reviews the changed files, drafts a PR, and opening it pauses for approval.",
    stack: ["AG-UI"],
    sourcePath: "showcase/agents/copilot-pr-assistant",
    tryPrompts: ["List the changed files"],
    tools: [
      { name: "list_changed_files", description: "List files changed on the branch" },
      { name: "propose_pull_request", description: "Draft + open the PR", consequential: true },
    ],
  },
];

const FORM = {
  patient_name: "Jordan Rivera",
  member_id: "M-4471209",
  policy_number: "HX-88213",
  provider: "Lakeside General Hospital",
  billed_amount: 1842.5,
  currency: "USD",
};

let n = 0;
const uid = (p) => `${p}-${++n}`;

function sse(res, ev) {
  res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

function textMessage(res, text) {
  const id = uid("m");
  sse(res, { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" });
  sse(res, { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text });
  sse(res, { type: "TEXT_MESSAGE_END", messageId: id });
}

function toolCall(res, name, args, result) {
  const tcId = uid("tc");
  const mId = uid("m");
  sse(res, { type: "TOOL_CALL_START", toolCallId: tcId, toolCallName: name, parentMessageId: mId });
  sse(res, { type: "TOOL_CALL_ARGS", toolCallId: tcId, delta: JSON.stringify(args) });
  sse(res, { type: "TOOL_CALL_END", toolCallId: tcId });
  if (result !== undefined) {
    sse(res, { type: "TOOL_CALL_RESULT", messageId: uid("m"), toolCallId: tcId, content: JSON.stringify(result), role: "tool" });
  }
}

function runScenario(res, agentId, input) {
  const msgs = input.messages ?? [];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const approved = msgs.some((m) => m.role === "tool" && String(m.content ?? "").includes('"accepted":true'));
  const rejected = msgs.some((m) => m.role === "tool" && String(m.content ?? "").includes('"accepted":false'));

  if (agentId === "health-claim-intake") {
    if (/extract/i.test(lastUser)) {
      toolCall(res, "extract_claim_form", {}, { status: "draft", form: FORM });
      textMessage(res, "The claim form has been auto-filled from your documents. Review it, then submit.");
    } else if (approved) {
      toolCall(res, "submit_claim", {}, { status: "submitted", reference: "CLM-20831" });
      textMessage(res, "Submitted — reference CLM-20831.");
    } else if (rejected) {
      textMessage(res, "Okay, I won't submit the claim.");
    } else if (/submit/i.test(lastUser)) {
      toolCall(res, "confirm_changes", {
        function_name: "submit_claim",
        function_arguments: {},
        steps: [{ description: "Submit the claim to the insurer", status: "enabled" }],
      });
    } else {
      textMessage(res, "Try 'Extract the claim form'.");
    }
    return;
  }

  // conversational banking
  if (approved) {
    toolCall(res, "transfer_funds", { amount: 200, to_account: "savings", from_account: "checking" }, { status: "ok", new_balance: 4550.25 });
    textMessage(res, "Done — $200 moved from checking to savings.");
  } else if (rejected) {
    textMessage(res, "Okay, I won't move any money.");
  } else if (/transfer/i.test(lastUser)) {
    toolCall(res, "confirm_changes", {
      function_name: "transfer_funds",
      function_arguments: { amount: 200, to_account: "savings", from_account: "checking" },
      steps: [{ description: "Transfer $200 checking → savings", status: "enabled" }],
    });
  } else {
    toolCall(res, "get_balance", {}, { checking: 4750.25, savings: 12300.0 });
    textMessage(res, "Checking holds $4,750.25 and savings $12,300.00.");
  }
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (req.method === "GET" && req.url === "/agents") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ agents: AGENTS }));
  }

  const m = req.url?.match(/^\/agents\/([a-z-]+)\/?$/);
  if (req.method === "POST" && m) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const input = JSON.parse(body || "{}");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      sse(res, { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId });
      runScenario(res, m[1], input);
      sse(res, { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId });
      res.end();
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(8080, () => console.log("mock AG-UI gateway on :8080"));
