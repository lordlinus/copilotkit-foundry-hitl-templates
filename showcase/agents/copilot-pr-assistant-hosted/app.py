"""Code-deploy entry point for the Foundry hosted agent.

Foundry direct-code deploy zips this directory and runs `python app.py` on the
remote-built Python runtime. We add `src/` to the path so the shared agent code
(`agent.py`, `provider.py`) imports unchanged, then serve the Responses protocol.

Container deploy uses `src/main.py` instead (see Dockerfile); both share the same
CopilotSDKAgent.
"""
from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from dotenv import load_dotenv

from agent_framework_foundry_hosting import ResponsesHostServer

from agent import CopilotSDKAgent  # noqa: E402  (after sys.path insert)

load_dotenv(override=False)
logging.basicConfig(level=logging.INFO)


def main() -> None:
    ResponsesHostServer(CopilotSDKAgent()).run()


if __name__ == "__main__":
    main()
