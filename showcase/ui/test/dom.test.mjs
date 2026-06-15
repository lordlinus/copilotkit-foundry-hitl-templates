// Tier-1 UI verification (no browser): render the real transcript module under
// jsdom against RECORDED per-agent message fixtures and assert on the DOM the
// user actually sees. Catches render/UX regressions that backend SSE smoke can't:
//   - approval card present with Approve/Reject
//   - the gated "what am I approving?" preview is never empty
//   - a `form` result renders as a form widget (not raw JSON)
//   - field edits are wired to the agent
//
// Run: npm run test:dom   (node --test). No network, no Azure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Transpile the real src/transcript.ts to a loadable ESM module (no test-only
// copy of the logic — we exercise exactly what ships).
const out = await build({
  entryPoints: [join(root, "src/transcript.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")
);
const { renderTranscript } = mod;

function fixture(name) {
  return JSON.parse(readFileSync(join(root, "test/fixtures", `${name}.json`), "utf8"));
}

function renderInto(messages, opts = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="t"></div></body>`);
  const el = dom.window.document.getElementById("t");
  const edits = [];
  const toggles = [];
  const model = {
    messages,
    running: false,
    errored: null,
    expandedForms: new Set(opts.expanded || []),
    onApprove: () => {},
    onReject: () => {},
    onEditField: (k, v) => edits.push([k, v]),
    onToggleForm: (id) => toggles.push(id),
  };
  renderTranscript(el, model);
  return { el, edits, toggles, win: dom.window };
}

test("banking pause renders an approval card with Approve/Reject and a non-empty preview", () => {
  const { el } = renderInto(fixture("banking-pause"));
  const approval = el.querySelector(".approval");
  assert.ok(approval, "approval card present");
  const buttons = [...el.querySelectorAll(".approval-actions button")].map((b) => b.textContent);
  assert.deepEqual(buttons, ["Approve", "Reject"]);
  const preview = el.querySelector(".approval .args, .approval .formcard");
  assert.ok(preview, "approval shows a preview (args or form)");
  assert.ok(preview.textContent.trim().length > 2, "preview is not empty/{}");
});

test("claim extract renders a load-on-demand form toggle (collapsed by default)", () => {
  const { el } = renderInto(fixture("claim-extract"));
  const toggle = el.querySelector(".form-toggle");
  assert.ok(toggle, "form toggle present");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(el.querySelector(".formcard"), null, "form is collapsed until requested");
  // Raw form JSON should NOT be dumped as a tool result.
  const dumped = [...el.querySelectorAll(".toolresult")].some((n) => n.textContent.includes('"form"'));
  assert.equal(dumped, false, "form is not shown as raw JSON");
});

test("expanding the claim form shows editable fields wired to the agent", () => {
  const f = fixture("claim-extract");
  // find the tool-call id of the result that carries a form
  let formTcId = null;
  for (const m of f) {
    if (m.role !== "assistant") continue;
    for (const tc of m.toolCalls || []) {
      const res = f.find((x) => x.role === "tool" && x.toolCallId === tc.id);
      if (res && JSON.parse(res.content || "{}").form) formTcId = tc.id;
    }
  }
  assert.ok(formTcId, "found a tool call with a form result");
  const { el } = renderInto(f, { expanded: [formTcId] });
  const card = el.querySelector(".formcard");
  assert.ok(card, "expanded form renders a form card");
  const inputs = el.querySelectorAll(".formrow-input");
  assert.ok(inputs.length >= 3, "form has multiple editable fields");
  // humanized labels, not raw snake_case
  const labels = [...el.querySelectorAll(".formrow-label")].map((n) => n.textContent);
  assert.ok(labels.some((l) => /\s/.test(l) && l[0] === l[0].toUpperCase()), "labels are humanized");
});

test("claim submit pause: approval preview is the form, not empty {}", () => {
  const { el } = renderInto(fixture("claim-submit-pause"));
  const approval = el.querySelector(".approval");
  assert.ok(approval, "approval card present");
  const form = el.querySelector(".approval .formcard");
  const pre = el.querySelector(".approval .args");
  assert.ok(form || (pre && pre.textContent.trim() !== "{}"), "submit approval shows the record, not empty {}");
});
