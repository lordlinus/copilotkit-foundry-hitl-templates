"use client";

import {
  CopilotChat,
  useHumanInTheLoop,
  useRenderTool,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

// MUST match the provider `agent` prop and AGENT_NAME in src/agent.py.
const AGENT_NAME = "agentic_copilot_foundry";

function asPayload(result: unknown): any {
  if (!result) return {};
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return { text: result };
    }
  }
  return result as any;
}

export default function Chat() {
  // Shared state (lights up once the hosted agent + bridge emit StateSnapshot/Delta
  // for a state_schema; harmless before then). See references/patterns-7.md.
  const { agent } = useAgent({
    agentId: AGENT_NAME,
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const value = (agent?.state as { value?: number } | undefined)?.value;

  // -- THE HITL GATE (v2 useHumanInTheLoop) ---------------------------------
  // A tool marked approval_mode="always_require" surfaces (via the bridge /
  // in-process adapter) as a synthetic `confirm_changes` tool call carrying the
  // original function name + arguments + approval `steps`. We resolve it with
  // { accepted, steps } -- the shape the backend expects. Nothing consequential
  // runs until Approve.
  useHumanInTheLoop({
    agentId: AGENT_NAME,
    name: "confirm_changes",
    description: "Approve or reject a consequential action before it executes.",
    parameters: z.object({
      function_name: z.string().optional(),
      function_arguments: z.any().optional(),
      steps: z
        .array(
          z.object({
            description: z.string(),
            status: z.enum(["enabled", "disabled", "executing"]),
          }),
        )
        .optional(),
    }),
    render: ({ args, respond, status }: any) => {
      const fnName = String(args?.function_name ?? "apply_delta");
      let fnArgs: any = args?.function_arguments ?? {};
      if (typeof fnArgs === "string") {
        try {
          fnArgs = JSON.parse(fnArgs);
        } catch {
          /* keep as string */
        }
      }
      const steps = args?.steps ?? [{ description: `Execute ${fnName}`, status: "enabled" }];

      if (status === "complete") {
        return <div className="card resolved">Decision recorded</div>;
      }
      return (
        <div className="approval">
          <div className="approval-head">
            Approval required <span className="pill">HUMAN-IN-THE-LOOP</span>
          </div>
          <div className="approval-body">
            <div className="fn">{fnName}</div>
            <pre className="args">{JSON.stringify(fnArgs, null, 2)}</pre>
            <div className="approval-actions">
              <button
                className="btn approve"
                onClick={() => respond?.({ accepted: true, steps })}
              >
                Approve
              </button>
              <button
                className="btn reject"
                onClick={() =>
                  respond?.({
                    accepted: false,
                    steps: (steps as any[]).map((s: any) => ({ ...s, status: "disabled" })),
                  })
                }
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      );
    },
  });

  // -- Backend tool render: result card for the consequential tool ----------
  useRenderTool({
    name: "apply_delta",
    parameters: z.object({ delta: z.number().optional() }),
    render: ({ result, status }: any) => {
      if (status !== "complete") return <></>;
      const p = asPayload(result);
      if (p.status !== "ok") return <></>;
      if (p.executed && p.value === undefined) {
        return <div className="card resolved">Approved action executed server-side</div>;
      }
      return <div className="card resolved">Applied - value is now {p.value}</div>;
    },
  });

  // -- Backend tool render: read tool ---------------------------------------
  useRenderTool({
    name: "get_value",
    parameters: z.object({}),
    render: ({ result }: any) => {
      const p = asPayload(result);
      if (p.value === undefined) return <></>;
      return <div className="card">Current value - {p.value}</div>;
    },
  });

  return (
    <>
      {value !== undefined && (
        <div className="state-banner">Shared state - value = {value}</div>
      )}
      <CopilotChat agentId={AGENT_NAME} className="chat" />
    </>
  );
}
