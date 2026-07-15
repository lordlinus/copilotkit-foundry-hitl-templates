// Showcase front door — a two-panel console:
//   • LEFT rail: agent picker, the selected agent's guided sample questions,
//     its tool list (capabilities at a glance), and a source link.
//   • RIGHT: the CopilotKit chat for the selected agent (ChatPanel).
//
// The AG-UI agents are registered CLIENT-SIDE (HttpAgent straight to the
// gateway over SSE) so the whole site stays static and deploys to GitHub
// Pages — no CopilotKit runtime server. That is the demo trade-off: for a
// production app use the runtime-backed wiring shown in
// templates/agentic-copilot-foundry/frontend (Next.js API route +
// CopilotSseRuntime), which adds thread persistence and keeps agent URLs
// and credentials server-side.

import { useMemo, useState } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";
import { agentEndpoint, sourceUrl, type AgentInfo } from "./config";
import ChatPanel from "./ChatPanel";

// Every agent title carries an "(HITL)" suffix in the registry; the gate badge
// says it better, so strip it for display.
function displayTitle(a: AgentInfo): string {
  return a.title.replace(/\s*\(HITL\)\s*$/, "");
}

function Rail({
  agents,
  selectedId,
  onSelect,
}: {
  agents: AgentInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const agent = agents.find((a) => a.id === selectedId)!;
  return (
    <aside className="rail">
      <div className="rail-intro">
        <p>
          Each app is one agent over the open{" "}
          <a href="https://docs.ag-ui.com/introduction" target="_blank" rel="noopener">
            AG-UI
          </a>{" "}
          protocol with native <strong>human-in-the-loop approval</strong>, rendered with CopilotKit. Pick an
          agent, then a sample question.
        </p>
        <p>
          Build your own: scaffold with{" "}
          <a
            href="https://github.com/lordlinus/copilotkit-foundry-hitl-templates#getting-started"
            target="_blank"
            rel="noopener"
          >
            copilotkit-foundry-hitl-templates
          </a>
          , then develop with the{" "}
          <a href="https://awesome-copilot.github.com/skill/foundry-hosted-agent-copilotkit/" target="_blank" rel="noopener">
            foundry-hosted-agent-copilotkit
          </a>{" "}
          skill.
        </p>
      </div>
      <div className="rail-section-title">Agents</div>
      <div className="agent-list">
        {agents.map((a) => {
          const gates = (a.tools ?? []).filter((t) => t.consequential).length;
          return (
            <button
              key={a.id}
              className={"agent-item" + (a.id === selectedId ? " active" : "")}
              onClick={() => onSelect(a.id)}
            >
              <span className="agent-item-top">
                <span className="agent-item-title">{displayTitle(a)}</span>
                {gates > 0 && <span className="agent-item-gates">{gates} gated</span>}
              </span>
              <span className="agent-item-tagline">{a.tagline}</span>
            </button>
          );
        })}
      </div>
      <div className="agent-guide">
        {agent.tools && agent.tools.length > 0 && (
          <>
            <div className="guide-section-title">Tools</div>
            <div className="guide-tools">
              {agent.tools.map((t) => (
                <div className="guide-tool" key={t.name}>
                  <span className="guide-tool-name">{t.name}</span>
                  {t.consequential && <span className="guide-tool-badge">approval</span>}
                  <span className="guide-tool-desc">{t.description}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <a className="guide-source" href={sourceUrl(agent.sourcePath)} target="_blank" rel="noopener">
          ‹ › View source
        </a>
      </div>
    </aside>
  );
}

export default function App({ agents, live }: { agents: AgentInfo[]; live: boolean }) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id);
  const selected = agents.find((a) => a.id === selectedId)!;

  // Client-side AG-UI agents: the browser talks straight to the gateway.
  const registry = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.agentName, new HttpAgent({ url: agentEndpoint(a.id) })])),
    [agents],
  );

  return (
    <CopilotKitProvider agents__unsafe_dev_only={registry} showDevConsole={false}>
      <header className="topbar">
        <span className="logo">⚒︎</span>
        <span className="brand">
          CopilotKit <em>×</em> Foundry
        </span>
        <span className="brand-sub">HITL agent console</span>
        <span className="spacer" />
        <span className={`status ${live ? "live" : "idle"}`}>{live ? "gateway live" : "gateway asleep"}</span>
        <a
          className="topbar-link"
          href="https://github.com/lordlinus/copilotkit-foundry-hitl-templates"
          target="_blank"
          rel="noopener"
        >
          GitHub ↗
        </a>
      </header>
      <div className="console">
        <Rail agents={agents} selectedId={selectedId} onSelect={setSelectedId} />
        {/* key= forces a fresh chat per agent (own thread, own HITL registration) */}
        <ChatPanel key={selected.id} agent={selected} displayTitle={displayTitle(selected)} />
      </div>
    </CopilotKitProvider>
  );
}
