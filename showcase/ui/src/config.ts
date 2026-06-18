// Where the always-on gateway lives, and where the source links point.
declare global {
  interface Window {
    SHOWCASE_API_BASE?: string;
  }
}

// Stamped into public/config.js at publish time (prod). For local dev you can
// instead pass VITE_API_BASE (e.g. `VITE_API_BASE=https://... npm run dev`).
// Falls back to a local gateway on :8080.
const fromEnv = (import.meta as any).env?.VITE_API_BASE as string | undefined;
export const API_BASE = (window.SHOWCASE_API_BASE || fromEnv || "http://localhost:8080").replace(/\/+$/, "");

// Public GitHub repo that hosts the templates (for "View source" links).
export const REPO_URL = "https://github.com/lordlinus/forgewright";
export const REPO_BRANCH = "main";

export interface AgentTool {
  name: string;
  description: string;
  consequential?: boolean; // true => HITL-gated (Approve/Reject before it runs)
}

export interface AgentInfo {
  id: string;
  title: string;
  agentName: string;
  tagline: string;
  description: string;
  stack: string[];
  sourcePath: string;
  tryPrompts: string[];
  tools?: AgentTool[];
}

export function agentEndpoint(id: string): string {
  return `${API_BASE}/agents/${id}/`;
}

export function sourceUrl(sourcePath: string): string {
  return `${REPO_URL}/tree/${REPO_BRANCH}/${sourcePath}`;
}
