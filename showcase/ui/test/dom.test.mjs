// Tier-1 UI verification (no browser): render the REAL presentational
// components (src/cards.tsx) and model helpers (src/model.ts) under node with
// react-dom/server, and assert on the markup the user actually sees:
//   - approval card present with Approve/Reject and a non-empty preview
//   - resolved approvals carry the correct stamp (Approved vs Rejected)
//   - a `form` payload renders as a form widget (not raw JSON), humanized labels
//   - approvalPreview never resolves to an empty {} for submit-style gates
// Event wiring (clicks, field edits) is covered by the Playwright e2e tier.
//
// Run: npm run test:dom   (node --test). No network, no Azure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Transpile the real src modules to loadable ESM (no test-only copy of the
// logic — we exercise exactly what ships). React stays external so the bundle
// shares the ambient react/react-dom install; emitted under node_modules/.cache
// (a file module, not data:) so bare "react" imports resolve.
async function load(entry) {
  const outfile = join(root, "node_modules/.cache/showcase-tests", entry.replace(/[/\\]/g, "_") + ".mjs");
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    external: ["react", "react-dom", "react/jsx-runtime"],
    outfile,
  });
  return import(pathToFileURL(outfile).href);
}

const { renderToStaticMarkup } = await import("react-dom/server");
const React = (await import("react")).default;
const cards = await load("src/cards.tsx");
const model = await load("src/model.ts");

function dom(markup) {
  return new JSDOM(`<!DOCTYPE html><body><div id="t">${markup}</div></body>`).window.document.getElementById("t");
}

function fixture(name) {
  return JSON.parse(readFileSync(join(root, "test/fixtures", `${name}.json`), "utf8"));
}

// Pull the confirm_changes args out of a recorded transcript fixture.
function confirmArgs(messages) {
  for (const m of messages) {
    for (const tc of m.toolCalls || []) {
      if (tc.function?.name === "confirm_changes") return model.safeParse(tc.function.arguments);
    }
  }
  throw new Error("fixture has no confirm_changes call");
}

test("banking pause renders an approval card with Approve/Reject and a non-empty preview", () => {
  const messages = fixture("banking-pause");
  const parsed = confirmArgs(messages);
  const preview = model.approvalPreview(messages, parsed);
  const el = dom(
    renderToStaticMarkup(
      React.createElement(cards.ApprovalGate, {
        fnName: String(parsed.function_name ?? "action"),
        previewLabel: preview.label,
        previewData: preview.data,
        resolved: null,
      }),
    ),
  );
  assert.ok(el.querySelector(".approval"), "approval card present");
  const buttons = [...el.querySelectorAll(".approval-actions button")].map((b) => b.textContent);
  assert.deepEqual(buttons, ["Approve", "Reject"]);
  const previewEl = el.querySelector(".approval .args, .approval .formcard");
  assert.ok(previewEl, "approval shows a preview (args or form)");
  assert.ok(previewEl.textContent.trim().length > 2, "preview is not empty/{}");
});

test("claim submit pause: approval preview is the form, not empty {}", () => {
  const messages = fixture("claim-submit-pause");
  const parsed = confirmArgs(messages);
  const preview = model.approvalPreview(messages, parsed);
  assert.ok(preview.data && Object.keys(preview.data).length > 0, "preview falls back to the prepared record");
  const el = dom(
    renderToStaticMarkup(
      React.createElement(cards.ApprovalGate, {
        fnName: "submit_claim",
        previewLabel: preview.label,
        previewData: preview.data,
        resolved: null,
      }),
    ),
  );
  const form = el.querySelector(".approval .formcard");
  const pre = el.querySelector(".approval .args");
  assert.ok(form || (pre && pre.textContent.trim() !== "{}"), "submit approval shows the record, not empty {}");
});

test("resolved approval carries the Approved stamp (and never says Rejected)", () => {
  const el = dom(
    renderToStaticMarkup(
      React.createElement(cards.ApprovalGate, {
        fnName: "transfer_funds",
        previewLabel: "Change to apply",
        previewData: {},
        resolved: "approved",
      }),
    ),
  );
  const card = el.querySelector(".approval");
  assert.ok(card.classList.contains("approved"));
  assert.match(card.textContent, /Approved/);
  assert.doesNotMatch(card.textContent, /Rejected/);
  assert.ok(el.querySelector(".stamp.stamp-approved"), "stamp present");
});

test("decodeDecision handles backend rewrites and {accepted} payloads", () => {
  assert.equal(model.decodeDecision('{"accepted":true,"steps":[]}'), true);
  assert.equal(model.decodeDecision('{"accepted":false,"steps":[]}'), false);
  assert.equal(model.decodeDecision("Confirmed"), true);
  assert.equal(model.decodeDecision("Rejected"), false);
});

test("a form payload renders as a load-on-demand toggle, then an editable form", () => {
  const messages = fixture("claim-extract");
  let payload = null;
  for (const m of messages) {
    if (m.role === "tool") {
      const p = model.safeParse(m.content);
      if (p.form) payload = p;
    }
  }
  assert.ok(payload, "fixture carries a form payload");

  const collapsed = dom(
    renderToStaticMarkup(
      React.createElement(cards.ToolResult, { payload, expanded: false, onToggle: () => {} }),
    ),
  );
  const toggle = collapsed.querySelector(".form-toggle");
  assert.ok(toggle, "form toggle present");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(collapsed.querySelector(".formcard"), null, "form is collapsed until requested");
  assert.ok(!collapsed.textContent.includes('"form"'), "form is not dumped as raw JSON");

  const expanded = dom(
    renderToStaticMarkup(
      React.createElement(cards.ToolResult, { payload, expanded: true, onToggle: () => {} }),
    ),
  );
  assert.ok(expanded.querySelector(".formcard"), "expanded form renders a form card");
  const inputs = expanded.querySelectorAll(".formrow-input");
  assert.ok(inputs.length >= 3, "form has multiple editable fields");
  const labels = [...expanded.querySelectorAll(".formrow-label")].map((n) => n.textContent);
  assert.ok(
    labels.some((l) => /\s/.test(l) && l[0] === l[0].toUpperCase()),
    "labels are humanized",
  );
});

test("model helpers: isFlatRecord and humanizeLabel", () => {
  assert.equal(model.isFlatRecord({ a: 1, b: "x", c: null }), true);
  assert.equal(model.isFlatRecord({ a: { nested: true } }), false);
  assert.equal(model.isFlatRecord({}), false);
  assert.equal(model.humanizeLabel("billed_amount"), "Billed Amount");
});
