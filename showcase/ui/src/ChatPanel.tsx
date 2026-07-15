// One agent's live chat, built on CopilotKit v2 React:
//   • <CopilotChat> renders the transcript + composer.
//   • useHumanInTheLoop implements the HITL gate: a tool marked
//     approval_mode="always_require" surfaces as a synthetic `confirm_changes`
//     tool call; we render the checkpoint card and respond {accepted, steps}.
//   • A wildcard useRenderTool turns every other tool call into a protocol
//     chip + structured result (claim forms render as editable forms).
// The AG-UI agents run client-side (HttpAgent straight to the gateway) — see
// App.tsx — so this stays a static site. For the production runtime-backed
// wiring, see templates/agentic-copilot-foundry/frontend.

import { useState } from "react";
import {
  CopilotChat,
  ToolCallStatus,
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { AgentInfo } from "./config";
import { ApprovalGate, ToolChip, ToolResult } from "./cards";
import { approvalPreview, decodeDecision, safeParse, type Msg } from "./model";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// Append a user message and run the agent — used by the sample-prompt chips
// and by form field edits (the agent owns the write: it interprets the
// correction and calls its update tool, keeping server state authoritative).
function useSend(agentName: string) {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: agentName });
  return (text: string) => {
    if (!agent || !text.trim()) return;
    agent.addMessage({ id: uid("u"), role: "user", content: text });
    void copilotkit.runAgent({ agent });
  };
}

function Checkpoint(props: {
  agentId?: string;
  args: any;
  status: ToolCallStatus;
  result?: string;
  respond?: (result: unknown) => Promise<void>;
}) {
  // The user's click is authoritative for this session even after the backend
  // rewrites the tool-result content in later snapshots.
  const [decision, setDecision] = useState<boolean | null>(null);
  const { agent } = useAgent({ agentId: props.agentId ?? "" });

  const args = props.args ?? {};
  const fnName = String(args.function_name ?? "action");
  const steps = args.steps ?? [{ description: `Execute ${fnName}`, status: "enabled" }];
  const preview = approvalPreview((agent?.messages as Msg[]) ?? [], args);

  let resolved: "approved" | "rejected" | null = null;
  if (decision !== null) resolved = decision ? "approved" : "rejected";
  else if (props.status === ToolCallStatus.Complete) resolved = decodeDecision(props.result) ? "approved" : "rejected";

  return (
    <ApprovalGate
      fnName={fnName}
      previewLabel={preview.label}
      previewData={preview.data}
      resolved={resolved}
      disabled={!props.respond}
      onApprove={() => {
        setDecision(true);
        void props.respond?.({ accepted: true, steps });
      }}
      onReject={() => {
        setDecision(false);
        void props.respond?.({
          accepted: false,
          steps: Array.isArray(steps) ? steps.map((s: any) => ({ ...s, status: "disabled" })) : steps,
        });
      }}
    />
  );
}

function ToolActivity(props: { name: string; args: any; status: ToolCallStatus; result?: string }) {
  const [expanded, setExpanded] = useState(false);
  const send = useSend((props as any).agentId ?? "");
  if (props.name === "confirm_changes") return null; // handled by the checkpoint
  const payload = props.status === ToolCallStatus.Complete ? safeParse(props.result) : null;
  return (
    <>
      <ToolChip name={props.name} args={props.args} />
      {payload && (
        <ToolResult
          payload={payload}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          onEditField={(key, value) => send(`Set ${key} to ${value}.`)}
        />
      )}
    </>
  );
}

export default function ChatPanel({ agent, displayTitle }: { agent: AgentInfo; displayTitle: string }) {
  const agentName = agent.agentName;
  const send = useSend(agentName);

  // Re-render when messages change so the empty-state hint clears itself.
  const { agent: liveAgent } = useAgent({ agentId: agentName, updates: [UseAgentUpdate.OnMessagesChanged] });
  const pristine = !(liveAgent?.messages ?? []).length;

  useHumanInTheLoop(
    {
      agentId: agentName,
      name: "confirm_changes",
      description: "Approve or reject a consequential action before it executes.",
      parameters: z.object({
        function_name: z.string().optional(),
        function_arguments: z.any().optional(),
        steps: z
          .array(z.object({ description: z.string(), status: z.enum(["enabled", "disabled", "executing"]) }))
          .optional(),
      }) as any,
      render: (p: any) => <Checkpoint {...p} agentId={agentName} />,
    },
    [agentName],
  );

  useRenderTool(
    {
      agentId: agentName,
      name: "*",
      render: (p: any) => <ToolActivity {...p} agentId={agentName} />,
    },
    [agentName],
  );

  return (
    <section className="chat-panel">
      <div className="chat-head">
        <span className="chat-title">{displayTitle}</span>
        <span className="chat-proto">AG-UI · {agentName}</span>
      </div>
      {pristine && (
        <div className="transcript-empty">
          <p>{agent.description}</p>
          <div className="quick-hint">Start here</div>
          <div className="quick">
            {agent.tryPrompts.map((p) => (
              <button key={p} className="quick-chip" onClick={() => send(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
      <CopilotChat agentId={agentName} className="chat" />
    </section>
  );
}
