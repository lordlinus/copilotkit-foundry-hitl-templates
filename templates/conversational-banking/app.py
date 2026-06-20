"""Foundry hosted-agent code-deploy entry point.

Lives at the template root so the deploy ZIP includes src/ (the shared agent).
Adds src/ to the path, builds the SAME MAF agent as the AG-UI backend, and serves
the Responses protocol. Container deploy uses hosted/responses/main.py instead.
"""
from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from dotenv import load_dotenv

from agent_framework_foundry_hosting import ResponsesHostServer

from agent import build_hosted_agent  # noqa: E402  (after sys.path insert)

load_dotenv(override=False)
logging.basicConfig(level=logging.INFO)


def main() -> None:
    ResponsesHostServer(build_hosted_agent()).run()


if __name__ == "__main__":
    main()
