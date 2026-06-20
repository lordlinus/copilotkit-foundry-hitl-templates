"use client";

import { CopilotKit } from "@copilotkit/react-core";
import Chat from "../components/Chat";

export default function Page() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="conversational_banking"
      showDevConsole={false}
      // The route uses the multi-route hono handler (createCopilotHonoHandler),
      // so info/threads/agent-run are dispatched by URL path + HTTP method.
      // CopilotKit's default `useSingleEndpoint: true` POSTs everything to the
      // base path and the multi-route handler 404s it ("Agent ... not found").
      // Setting this false makes the client hit /info, /threads, /agent/<id>/run.
      useSingleEndpoint={false}
    >
      <main className="app">
        <header className="topbar">
          <span className="logo">🏦</span>
          <span className="title">Banking Assistant</span>
          <span className="sub">Chat your banking · every transaction confirmed before it runs</span>
        </header>
        <Chat />
      </main>
    </CopilotKit>
  );
}
