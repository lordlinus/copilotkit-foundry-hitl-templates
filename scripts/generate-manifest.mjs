#!/usr/bin/env node
// generate-manifest.mjs — regenerate the gallery manifests + README table from
// each template's manifest.json. Run from the repo root.
//
//   node scripts/generate-manifest.mjs           # write
//   node scripts/generate-manifest.mjs --check    # verify in sync (CI), exit 1 if not
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES_DIR = join(ROOT, "templates");
const CHECK = process.argv.includes("--check");

function readTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(TEMPLATES_DIR, name, "manifest.json")))
    .map((name) => {
      const m = JSON.parse(readFileSync(join(TEMPLATES_DIR, name, "manifest.json"), "utf8"));
      if (m.templateId !== name) {
        throw new Error(`templateId '${m.templateId}' != directory '${name}'`);
      }
      return { name, ...m };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function rootManifest(templates) {
  const entries = templates
    .map(
      (t) =>
        `  - path: templates/${t.name}\n    name: ${t.displayName}\n    description: ${t.description}`
    )
    .join("\n");
  return `apiVersion: v1
metadata:
  name: copilotkit-foundry-hitl-templates
  displayName: CopilotKit + Foundry HITL Templates
  description: One-prompt CopilotKit + AG-UI + Foundry hosted-agent apps with HITL
entries:
${entries}
`;
}

function leafManifest(t) {
  return `apiVersion: v1
metadata:
  name: ${t.name}
  displayName: ${t.displayName}
  description: ${t.description}
entries:
  - path: .
    name: ${t.displayName}
`;
}

function readmeTable(templates) {
  const header =
    "| Template | Description | Stack |\n| --- | --- | --- |";
  const rows = templates
    .map(
      (t) =>
        `| **[${t.displayName}](templates/${t.name})** | ${t.description} | ${(t.stack || []).join(", ")} |`
    )
    .join("\n");
  return `${header}\n${rows}`;
}

function spliceReadme(readme, table) {
  const START = "<!-- TEMPLATES:START -->";
  const END = "<!-- TEMPLATES:END -->";
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s < 0 || e < 0) return readme; // markers absent — leave untouched
  return readme.slice(0, s + START.length) + "\n" + table + "\n" + readme.slice(e);
}

function writeOrCheck(path, content) {
  const exists = existsSync(path);
  const current = exists ? readFileSync(path, "utf8") : "";
  if (CHECK) {
    if (current !== content) {
      console.error(`✗ out of date: ${path.replace(ROOT + "/", "")}`);
      return false;
    }
    return true;
  }
  if (current !== content) {
    writeFileSync(path, content);
    console.log(`• wrote ${path.replace(ROOT + "/", "")}`);
  }
  return true;
}

const templates = readTemplates();
let ok = true;

ok = writeOrCheck(join(ROOT, "template-manifest.yml"), rootManifest(templates)) && ok;
for (const t of templates) {
  ok = writeOrCheck(join(TEMPLATES_DIR, t.name, "template-manifest.yml"), leafManifest(t)) && ok;
}
const readmePath = join(ROOT, "README.md");
if (existsSync(readmePath)) {
  const updated = spliceReadme(readFileSync(readmePath, "utf8"), readmeTable(templates));
  ok = writeOrCheck(readmePath, updated) && ok;
}

if (CHECK && !ok) {
  console.error("Run: node scripts/generate-manifest.mjs");
  process.exit(1);
}
if (!CHECK) console.log(`✓ ${templates.length} template(s) processed`);
