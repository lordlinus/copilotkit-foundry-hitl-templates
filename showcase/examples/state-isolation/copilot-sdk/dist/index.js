// State isolation with the GitHub Copilot SDK — "one agent, many sandboxes".
//
// Demonstrates that each `sessionId` is its own persistent, isolated sandbox:
//   • write a fact in session A,
//   • a different session B cannot see it (ISOLATION),
//   • resuming session A in a fresh client still remembers it (PERSISTENCE).
//
// The SDK persists each session's conversation + workspace under COPILOT_HOME
// (createSession({sessionId}) / resumeSession(sessionId)) — the same mechanism a
// Foundry hosted agent gets per-session via $HOME. No AG-UI here: this is a pure
// state-management showcase.
//
// Run:  npm install && npm start      (needs the same model env as the PR agent)
import { CopilotClient, ToolSet, defineTool } from "@github/copilot-sdk";
import { buildProvider, MODEL_NAME } from "./provider.js";
const NOTE_TOOLS = [
    defineTool("save_note", {
        description: "Save a short note to this workspace.",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        skipPermission: true,
        // The note lives in the model's per-session memory (conversation history),
        // which the SDK persists per sessionId — so it's isolated + survives resume.
        handler: async ({ text }) => ({ saved: text }),
    }),
];
const SYSTEM = "You manage a private notebook for ONE user. When asked to save a note, call save_note. " +
    "When asked what's in the notebook, answer ONLY from notes saved in THIS conversation; " +
    "if none, say the notebook is empty. Never invent notes.";
async function newClient() {
    const c = new CopilotClient({ mode: "empty", baseDirectory: process.env.COPILOT_HOME || `${process.cwd()}/.state`, logLevel: "error" });
    await c.start();
    return c;
}
async function session(client, sessionId, resume) {
    const cfg = {
        sessionId,
        model: MODEL_NAME,
        provider: await buildProvider(),
        tools: NOTE_TOOLS,
        availableTools: new ToolSet().addCustom("*"),
        systemMessage: { mode: "replace", content: SYSTEM },
    };
    return resume ? client.resumeSession(sessionId, cfg) : client.createSession(cfg);
}
async function ask(client, sessionId, prompt, resume = false) {
    const s = await session(client, sessionId, resume);
    const res = await s.sendAndWait({ prompt }, 60_000);
    await s.disconnect();
    return res?.data?.content?.trim() ?? "";
}
function check(name, ok) {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}`);
    if (!ok)
        process.exitCode = 1;
}
async function main() {
    const A = "alice-thread-1";
    const B = "bob-thread-1";
    console.log("1) Write a note in session A");
    await ask(await newClient(), A, "Save a note: the launch code is TEAL-42.");
    console.log("2) ISOLATION — a different session B cannot see A's note");
    const bSees = await ask(await newClient(), B, "What notes are in my notebook?");
    console.log("     B says:", JSON.stringify(bSees.slice(0, 120)));
    check("session B does not know A's note", !/teal-42/i.test(bSees));
    console.log("3) PERSISTENCE — resume session A in a FRESH client; note remembered");
    const aResumed = await ask(await newClient(), A, "What is the launch code in my notebook?", true);
    console.log("     A (resumed) says:", JSON.stringify(aResumed.slice(0, 120)));
    check("resumed session A still remembers TEAL-42", /teal-42/i.test(aResumed));
    console.log("\nOne agent · per-session sandboxes · isolated + persistent.");
}
main().catch((e) => {
    console.error("ERROR", e);
    process.exit(1);
});
