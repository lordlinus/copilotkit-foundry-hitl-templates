"use client";

import {
  CopilotChat,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

const AGENT_NAME = "health_claim_intake";

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

function ClaimForm({ form }: { form: Record<string, any> }) {
  const entries = Object.entries(form || {});
  if (!entries.length) return <></>;
  return (
    <table className="args" style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td style={{ opacity: 0.7, paddingRight: 12 }}>{k}</td>
            <td>{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Chat() {
  // -- THE HITL GATE (v2 useHumanInTheLoop) ---------------------------------
  // A tool marked approval_mode="always_require" (submit_claim) surfaces as a
  // synthetic `confirm_changes` tool call. Resolve with { accepted, steps }.
  // Nothing consequential (filing the claim) runs until Approve.
  useHumanInTheLoop({
    agentId: AGENT_NAME,
    name: "confirm_changes",
    description: "Approve or reject filing the claim before it is submitted.",
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
    render: ({ status, args, respond }: any) => {
      const fnName = String(args?.function_name ?? "submit_claim");
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
      const isSubmit = fnName === "submit_claim";
      return (
        <div className="approval">
          <div className="approval-head">
            Approval required <span className="pill">HUMAN-IN-THE-LOOP</span>
          </div>
          <div className="approval-body">
            <div className="fn">{fnName}</div>
            {isSubmit ? (
              <p style={{ margin: "6px 0" }}>
                File this claim with the insurer? This finalizes the submission.
              </p>
            ) : (
              <pre className="args">{JSON.stringify(fnArgs, null, 2)}</pre>
            )}
            <div className="approval-actions">
              <button className="btn approve" onClick={() => respond?.({ accepted: true, steps })}>
                Approve &amp; submit
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

  // -- Result card for the consequential tool (post-execution) --------------
  useRenderTool({
    name: "submit_claim",
    parameters: z.object({}),
    render: ({ result, status }: any) => {
      if (status !== "complete") return <></>;
      const p = asPayload(result);
      if (p.status !== "ok") return <></>;
      return (
        <div className="card resolved">
          Claim filed - reference <strong>{p.reference}</strong>
        </div>
      );
    },
  });

  // -- Intake documents -----------------------------------------------------
  useRenderTool({
    name: "list_documents",
    parameters: z.object({}),
    render: ({ result }: any) => {
      const p = asPayload(result);
      if (!p.documents) return <></>;
      return (
        <div className="card">
          <div className="fn">Intake documents - {p.count}</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {p.documents.map((d: any) => (
              <li key={d.id}>
                {d.id} <span className="pill">{d.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    },
  });

  // -- Auto-filled claim form -----------------------------------------------
  useRenderTool({
    name: "extract_claim_form",
    parameters: z.object({}),
    render: ({ result }: any) => {
      const p = asPayload(result);
      if (!p.form || !Object.keys(p.form).length) return <></>;
      return (
        <div className="card">
          <div className="fn">Auto-filled claim form</div>
          <ClaimForm form={p.form} />
        </div>
      );
    },
  });

  // -- Field edit -----------------------------------------------------------
  useRenderTool({
    name: "update_claim_field",
    parameters: z.object({ field: z.string().optional(), value: z.string().optional() }),
    render: ({ result, status }: any) => {
      if (status !== "complete") return <></>;
      const p = asPayload(result);
      if (!p.field) return <></>;
      return (
        <div className="card resolved">
          Updated <strong>{p.field}</strong> - {String(p.value)}
        </div>
      );
    },
  });

  // -- Read-only claim snapshot ---------------------------------------------
  useRenderTool({
    name: "get_claim",
    parameters: z.object({}),
    render: ({ result }: any) => {
      const p = asPayload(result);
      if (!p.status) return <></>;
      return (
        <div className="card">
          <div className="fn">
            Claim - {p.status}
            {p.reference ? ` - ${p.reference}` : ""}
          </div>
          {p.form && Object.keys(p.form).length ? <ClaimForm form={p.form} /> : null}
        </div>
      );
    },
  });

  return <CopilotChat agentId={AGENT_NAME} className="chat" />;
}
