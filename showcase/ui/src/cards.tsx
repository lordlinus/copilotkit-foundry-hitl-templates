// Pure presentational pieces of the Foundry Floor — no CopilotKit imports, no
// network. ChatPanel wires these into CopilotKit render hooks; the tier-1 tests
// render them directly (react renderToStaticMarkup under node).

import { useState } from "react";
import { argSummary, humanizeLabel, isFlatRecord } from "./model";

export function ToolChip({ name, args }: { name: string; args?: any }) {
  const summary = argSummary(args);
  return (
    <div className="toolchip">
      <span className="toolchip-fn">{name}</span>
      {summary ? <span className="toolchip-args">· {summary}</span> : null}
    </div>
  );
}

export function FormCard({
  form,
  label,
  editable,
  disabled,
  onEdit,
}: {
  form: Record<string, any>;
  label: string;
  editable: boolean;
  disabled?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  return (
    <div className="formcard">
      <div className="formcard-head">{label}</div>
      {Object.entries(form).map(([key, value]) => (
        <label className="formrow" key={key}>
          <span className="formrow-label">{humanizeLabel(key)}</span>
          {editable ? (
            <FieldInput value={String(value ?? "")} disabled={disabled} onCommit={(v) => onEdit?.(key, v)} />
          ) : (
            <span className="formrow-value">{String(value ?? "")}</span>
          )}
        </label>
      ))}
    </div>
  );
}

function FieldInput({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="formrow-input"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// The HITL checkpoint — a work order awaiting (or bearing) the human stamp.
export function ApprovalGate({
  fnName,
  previewLabel,
  previewData,
  resolved,
  disabled,
  onApprove,
  onReject,
}: {
  fnName: string;
  previewLabel: string;
  previewData: any;
  resolved: "approved" | "rejected" | null;
  disabled?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  if (resolved) {
    const accepted = resolved === "approved";
    return (
      <div className={`approval ${resolved}`}>
        <div className="approval-head">
          Checkpoint <span className="pill">human-in-the-loop</span>
          <span className={`stamp ${accepted ? "stamp-approved" : "stamp-rejected"}`}>
            {accepted ? "Approved" : "Rejected"}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="approval">
      <div className="approval-head">
        <span className="gate-dot" /> Approval required <span className="pill">human-in-the-loop</span>
      </div>
      <div className="approval-body">
        <div className="fn">{fnName}</div>
        <div className="args-label">{previewLabel}</div>
        {isFlatRecord(previewData) ? (
          <FormCard form={previewData} label="Review before submit" editable={false} />
        ) : (
          <pre className="args">{JSON.stringify(previewData, null, 2)}</pre>
        )}
        <div className="approval-actions">
          <button className="btn approve" disabled={disabled} onClick={onApprove}>
            Approve
          </button>
          <button className="btn reject" disabled={disabled} onClick={onReject}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// Structured tool results: a `form` object renders as a load-on-demand form;
// a single {field, value} update as a compact line; anything else as JSON.
export function ToolResult({
  payload,
  expanded,
  onToggle,
  formDisabled,
  onEditField,
}: {
  payload: any;
  expanded: boolean;
  onToggle: () => void;
  formDisabled?: boolean;
  onEditField?: (key: string, value: string) => void;
}) {
  if (!payload || typeof payload !== "object" || !Object.keys(payload).length) return null;
  if (payload.form && isFlatRecord(payload.form)) {
    const label = payload.reference
      ? `Claim form · ${payload.reference}`
      : payload.status
        ? `Claim form · ${payload.status}`
        : "Claim form";
    return (
      <>
        <button className="form-toggle" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "▾" : "▸"} {label}
        </button>
        {expanded && (
          <FormCard form={payload.form} label={label} editable disabled={formDisabled} onEdit={onEditField} />
        )}
      </>
    );
  }
  if (typeof payload.field === "string" && "value" in payload) {
    return (
      <div className="toolresult">
        {humanizeLabel(payload.field)} → {String(payload.value)}
      </div>
    );
  }
  return <div className="toolresult">{JSON.stringify(payload)}</div>;
}
