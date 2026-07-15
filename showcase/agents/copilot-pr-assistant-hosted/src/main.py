"""Foundry hosted-agent entrypoint.

Wraps the GitHub Copilot SDK (via CopilotSDKAgent) and serves the Foundry
**Responses** protocol with agent_framework_foundry_hosting.ResponsesHostServer.
The Foundry platform routes each session to an isolated microvm ($HOME); this
process keeps one CopilotClient and one Copilot session per Foundry session id.

Local run:   python main.py    (serves the Responses HTTP server)
Deploy:      azd ai agent ...   (see azure.yaml — inline agent definition)
"""
from __future__ import annotations

import logging

from dotenv import load_dotenv

from agent_framework_foundry_hosting import ResponsesHostServer

from agent import CopilotSDKAgent

load_dotenv(override=False)
logging.basicConfig(level=logging.INFO)


def main() -> None:
    agent = CopilotSDKAgent()
    server = ResponsesHostServer(agent)
    server.run()


if __name__ == "__main__":
    main()
