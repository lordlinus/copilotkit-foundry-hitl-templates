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
  // ── THE HITL GATE ───────────────────────────────────────────────────────
  // When a tool marked approval_mode="always_require" is called, the AG-UI
  // runtime PAUSES and emits a synthetic `confirm_changes` tool call carrying
  // the original function name + arguments + approval `steps`. CopilotKit
  // renders THIS action and waits. We resolve it with { accepted, steps } —
  // the shape the backend expects (its check is `"accepted" in parsed`).
  // Nothing consequential (here: filing the claim) runs until the user approves.
  useCopilotAction({
    name: "confirm_changes",
    available: "disabled",
    renderAndWaitForResponse: ({ status, args, respond }) => {
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
        return <div className="card resolved">✓ Decision recorded</div>;
      }
      const isSubmit = fnName === "submit_claim";
      return (
        <div className="approval">
          <div className="approval-head">
            ✋ Approval required <span className="pill">HUMAN-IN-THE-LOOP</span>
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

  // ── Result card for the consequential tool (post-execution) ───────────────
  useCopilotAction({
    name: "submit_claim",
    available: "disabled",
    render: ({ result, status }) => {
      if (status !== "complete") return <></>;
      const p = asPayload(result);
      if (p.status !== "ok") return <></>;
      return (
        <div className="card resolved">
          ✓ Claim filed · reference <strong>{p.reference}</strong>
        </div>
      );
    },
  });

  // ── Intake documents ──────────────────────────────────────────────────────
  useCopilotAction({
    name: "list_documents",
    available: "disabled",
    render: ({ result }) => {
      const p = asPayload(result);
      if (!p.documents) return <></>;
      return (
        <div className="card">
          <div className="fn">Intake documents · {p.count}</div>
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

  // ── Auto-filled claim form ────────────────────────────────────────────────
  useCopilotAction({
    name: "extract_claim_form",
    available: "disabled",
    render: ({ result }) => {
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

  // ── Field edit ────────────────────────────────────────────────────────────
  useCopilotAction({
    name: "update_claim_field",
    available: "disabled",
    render: ({ result, status }) => {
      if (status !== "complete") return <></>;
      const p = asPayload(result);
      if (!p.field) return <></>;
      return (
        <div className="card resolved">
          ✎ Updated <strong>{p.field}</strong> → {String(p.value)}
        </div>
      );
    },
  });

  // ── Read-only claim snapshot ──────────────────────────────────────────────
  useCopilotAction({
    name: "get_claim",
    available: "disabled",
    render: ({ result }) => {
      const p = asPayload(result);
      if (!p.status) return <></>;
      return (
        <div className="card">
          <div className="fn">
            Claim · {p.status}
            {p.reference ? ` · ${p.reference}` : ""}
          </div>
          {p.form && Object.keys(p.form).length ? <ClaimForm form={p.form} /> : null}
        </div>
      );
    },
  });

  return (
    <CopilotChat
      className="chat"
      labels={{
        title: "Claim intake assistant",
        initial:
          "Hi! I can intake your claim documents and fill out the form. Try: " +
          "“list the documents”, “extract the claim form”, “change the billed amount to 1450”, " +
          "then “submit the claim” — submission pauses for your approval first.",
      }}
    />
  );
}
