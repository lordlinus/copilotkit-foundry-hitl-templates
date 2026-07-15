import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic Copilot",
  description: "CopilotKit + AG-UI + Foundry hosted agent with human-in-the-loop",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          CopilotKit v2 (react-core ɵcreateThreadStore + @ag-ui/client HttpAgent)
          captures the global `fetch` as a bare reference and later calls it with
          the wrong `this`, throwing "Failed to execute 'fetch' on 'Window':
          Illegal invocation" (agent_run_failed_event). CopilotKitCore exposes no
          `fetch` option, so we bind the global fetch to `window` BEFORE any module
          loads. Runs synchronously during HTML parse — before the app bundle.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(typeof window!=='undefined'&&typeof window.fetch==='function'&&!window.fetch.__bound){var __f=window.fetch.bind(window);__f.__bound=true;window.fetch=__f;}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
