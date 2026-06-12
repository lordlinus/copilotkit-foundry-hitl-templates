"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

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
  // ── THE HITL GATE ───────────────────────────────────────────────────────
  // When a tool marked approval_mode="always_require" is called, the AG-UI
  // runtime PAUSES and emits a synthetic `confirm_changes` tool call carrying
  // the original function name + arguments + approval `steps`. CopilotKit
  // renders THIS action and waits. We resolve it with { accepted, steps } —
  // the shape the backend expects (its check is `"accepted" in parsed`).
  // Nothing consequential runs until the user clicks Approve.
  useCopilotAction({
    name: "confirm_changes",
    available: "disabled",
    renderAndWaitForResponse: ({ status, args, respond }) => {
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
        return <div className="card resolved">✓ Decision recorded</div>;
      }
      return (
        <div className="approval">
          <div className="approval-head">
            ✋ Approval required <span className="pill">HUMAN-IN-THE-LOOP</span>
          </div>
          <div className="approval-body">
            <div className="fn">{fnName}</div>
            <pre className="args">{JSON.stringify(fnArgs, null, 2)}</pre>
            <div className="approval-actions">
              <button className="btn approve" onClick={() => respond?.({ accepted: true, steps })}>
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

  // ── Result card for the consequential tool (post-execution) ───────────────
  useCopilotAction({
    name: "apply_delta",
    available: "disabled",
    render: ({ result, status }) => {
      if (status !== "complete") return <></>;
      const p = asPayload(result);
      if (p.status !== "ok") return <></>;
      return <div className="card resolved">✓ Applied · value is now {p.value}</div>;
    },
  });

  // ── Read-only render for context ──────────────────────────────────────────
  useCopilotAction({
    name: "get_value",
    available: "disabled",
    render: ({ result }) => {
      const p = asPayload(result);
      if (p.value === undefined) return <></>;
      return <div className="card">Current value · {p.value}</div>;
    },
  });

  return (
    <CopilotChat
      className="chat"
      labels={{
        title: "forgewright assistant",
        initial:
          "Hi! Ask me for the current value, or to apply a change — e.g. " +
          "“apply a delta of 25”. Any change pauses for your approval first.",
      }}
    />
  );
}
