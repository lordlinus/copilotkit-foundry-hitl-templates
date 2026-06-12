"""Foundry hosted-agent entrypoint (Responses protocol).

The SAME agent as the local AG-UI backend, served via the hosted-agent protocol
so `azd up` (azure.ai.agents extension) can publish it as a Foundry hosted agent.
"""

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from dotenv import load_dotenv

from agent_framework_foundry_hosting import ResponsesHostServer

from agent import build_agent

load_dotenv()
logging.basicConfig(level=logging.INFO)


def main() -> None:
    ResponsesHostServer(build_agent()).run()


if __name__ == "__main__":
    main()
