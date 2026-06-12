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

const money = (n: any) =>
  typeof n === "number" ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : String(n);

export default function Chat() {
  // ── THE HITL GATE — the "press before any transaction" widget ────────────
  // When a tool marked approval_mode="always_require" is called (transfer_funds
  // / pay_bill), the AG-UI runtime PAUSES and emits a synthetic `confirm_changes`
  // tool call carrying the original function name + arguments + approval `steps`.
  // CopilotKit renders THIS action and waits. We resolve it with { accepted,
  // steps } — the shape the backend expects (its check is `"accepted" in parsed`).
  // No money moves until the user presses Approve.
  useCopilotAction({
    name: "confirm_changes",
    available: "disabled",
    renderAndWaitForResponse: ({ status, args, respond }) => {
      const fnName = String(args?.function_name ?? "transfer_funds");
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

      const isTransfer = fnName === "transfer_funds";
      const isBill = fnName === "pay_bill";
      const headline = isTransfer
        ? `Transfer ${money(fnArgs.amount)}`
        : isBill
        ? `Pay ${money(fnArgs.amount)} to ${fnArgs.payee ?? "payee"}`
        : fnName;

      return (
        <div className="approval">
          <div className="approval-head">
            🔒 Confirm transaction <span className="pill">APPROVAL REQUIRED</span>
          </div>
          <div className="approval-body">
            <div className="fn">{headline}</div>
            <table className="args" style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {Object.entries(fnArgs).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ opacity: 0.7, paddingRight: 12 }}>{k}</td>
                    <td>{k === "amount" ? money(v) : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="approval-actions">
              <button className="btn approve" onClick={() => respond?.({ accepted: true, steps })}>
                Approve &amp; pay
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

  // ── Result cards for the consequential tools (post-execution) ─────────────
  const txnResult = ({ result, status }: any) => {
    if (status !== "complete") return <></>;
    const p = asPayload(result);
    if (p.status !== "ok") {
      if (p.status === "error")
        return <div className="card resolved">⚠ Transaction blocked · {p.reason}</div>;
      return <></>;
    }
    return (
      <div className="card resolved">
        ✓ {p.type === "bill_pay" ? "Bill paid" : "Transfer complete"} · {money(p.amount)} ·
        ref <strong>{p.reference}</strong>
      </div>
    );
  };
  useCopilotAction({ name: "transfer_funds", available: "disabled", render: txnResult });
  useCopilotAction({ name: "pay_bill", available: "disabled", render: txnResult });

  // ── Read-only render: accounts + balances ─────────────────────────────────
  useCopilotAction({
    name: "list_accounts",
    available: "disabled",
    render: ({ result }) => {
      const p = asPayload(result);
      if (!p.accounts) return <></>;
      return (
        <div className="card">
          <div className="fn">Accounts</div>
          <table className="args" style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {p.accounts.map((a: any) => (
                <tr key={a.name}>
                  <td style={{ opacity: 0.7, paddingRight: 12 }}>{a.name}</td>
                  <td>{money(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "get_balance",
    available: "disabled",
    render: ({ result }) => {
      const p = asPayload(result);
      if (p.balance === undefined) return <></>;
      return (
        <div className="card">
          {p.account} balance · {money(p.balance)}
        </div>
      );
    },
  });

  useCopilotAction({
    name: "get_recent_transactions",
    available: "disabled",
    render: ({ result }) => {
      const p = asPayload(result);
      if (!p.transactions) return <></>;
      if (!p.transactions.length) return <div className="card">No recent transactions.</div>;
      return (
        <div className="card">
          <div className="fn">Recent transactions · {p.count}</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {p.transactions.map((t: any) => (
              <li key={t.ref}>
                {t.ref} · {t.type} · {money(t.amount)}
              </li>
            ))}
          </ul>
        </div>
      );
    },
  });

  return (
    <CopilotChat
      className="chat"
      labels={{
        title: "Banking assistant",
        initial:
          "Hi! Ask me for your balances or recent activity, or to move money — " +
          "e.g. “transfer 250 from checking to savings” or “pay 80 to City Power”. " +
          "Every transaction pauses for your approval first.",
      }}
    />
  );
}
