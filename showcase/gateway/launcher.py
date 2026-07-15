"""Supervisor for the showcase container.

For each agent in ``agents.json`` this starts ONLY the thin AG-UI<->Responses
bridge (``bridge_app:app``) on the agent's public port, in **PLATFORM/HOSTED**
mode — pointed at the REAL Foundry hosted agent deployed via each template's
``hosted/`` azd project (or ``showcase/agents/<id>/`` for non-template agents).
All tools + HITL + history run server-side in that deployed hosted agent, where
governance/tracing/evaluations/Optimize apply; the bridge only translates
AG-UI <-> Responses and forwards ``mcp_approval_response`` on approve. The
gateway container never runs a template's own runtime (``app.py``/``src/``)
locally — that pattern (DIRECT mode) is for `make local`/`make smoke` dev loops
only, not this deployment.

Node agents (``runtime: node``) remain a self-contained AG-UI backend, unchanged.

The gateway (``app.py``) then reverse-proxies ``/agents/<id>/*`` to each bridge.
On SIGTERM/SIGINT every child is torn down.

Environment passed through to each bridge:
  FOUNDRY_PROJECT_ENDPOINT  the Foundry project hosting the deployed agents (keyless)
  AZURE_*                   DefaultAzureCredential inputs (managed identity in ACA)
  HOSTED_AGENT_NAME         set per-agent from `hostedAgentName` (or `id`) below
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

GATEWAY_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("REPO_ROOT", str(GATEWAY_DIR.parents[1])))
REGISTRY_PATH = Path(os.environ.get("SHOWCASE_REGISTRY", str(GATEWAY_DIR.parent / "agents.json")))
GATEWAY_PORT = os.environ.get("PORT", "8080")
READY_TIMEOUT = float(os.environ.get("BACKEND_READY_TIMEOUT", "120"))

_children: list[subprocess.Popen] = []


def _log(msg: str) -> None:
    print(f"[launcher] {msg}", flush=True)


def _spawn_node_backend(agent: dict) -> list[subprocess.Popen]:
    backend_dir = (REPO_ROOT / agent["backendDir"]).resolve()
    port = str(agent["port"])
    entry = backend_dir / "dist" / "index.js"
    if not entry.exists():
        raise FileNotFoundError(
            f"{entry} not found -- build the Node agent first (npm install && npm run build in {backend_dir})"
        )
    _log(f"starting '{agent['id']}' Node backend on :{port} (cwd={backend_dir})")
    env = {**os.environ, "PORT": port}
    return [subprocess.Popen(["node", "dist/index.js"], cwd=str(backend_dir), env=env)]


def _spawn_bridge_backend(agent: dict) -> list[subprocess.Popen]:
    """Start ONLY the AG-UI bridge (PLATFORM/HOSTED mode) against the deployed
    Foundry hosted agent. `backendDir` must contain bridge_app.py + hosted_client.py
    + hosted_proxy.py -- no template runtime is started here."""
    backend_dir = (REPO_ROOT / agent["backendDir"]).resolve()
    bridge = backend_dir / "bridge_app.py"
    if not bridge.exists():
        raise FileNotFoundError(f"bridge_app.py not found at {bridge}")

    public_port = str(agent["port"])
    hosted_agent_name = agent.get("hostedAgentName", agent["id"])
    agent_name = agent.get("agentName", agent["id"])

    _log(f"starting '{agent['id']}' AG-UI bridge on :{public_port} -> "
         f"hosted agent '{hosted_agent_name}' (PLATFORM mode)")
    bridge_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "bridge_app:app", "--host", "127.0.0.1", "--port", public_port],
        cwd=str(backend_dir),
        env={
            **os.environ,
            "PORT": public_port,
            "HOSTED_AGENT_NAME": hosted_agent_name,
            "AGENT_NAME": agent_name,
        },
    )
    return [bridge_proc]


def _spawn_backend(agent: dict) -> list[subprocess.Popen]:
    if agent.get("runtime", "python") == "node":
        return _spawn_node_backend(agent)
    return _spawn_bridge_backend(agent)


def _wait_url(url: str, label: str) -> bool:
    deadline = time.time() + READY_TIMEOUT
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:  # noqa: S310 -- localhost only
                if r.status == 200:
                    _log(f"{label} is ready")
                    return True
        except Exception:  # noqa: BLE001 -- still booting
            time.sleep(1)
    _log(f"WARNING: {label} did not become ready within {READY_TIMEOUT}s")
    return False


def _wait_ready(agent: dict) -> bool:
    # The public surface for every agent is the bridge's /healthz on its port.
    return _wait_url(f"http://127.0.0.1:{agent['port']}/healthz", f"'{agent['id']}' bridge")


def _terminate_all(*_: object) -> None:
    _log("shutting down child processes")
    for child in _children:
        if child.poll() is None:
            child.terminate()
    for child in _children:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
    sys.exit(0)


def main() -> None:
    agents = json.loads(REGISTRY_PATH.read_text())["agents"]
    signal.signal(signal.SIGTERM, _terminate_all)
    signal.signal(signal.SIGINT, _terminate_all)

    # An agent whose runtime isn't in this image (e.g. a Node agent in a
    # Python-only build) must not take the whole gallery down: skip it loudly
    # and tell the gateway which agents actually run, so /agents only
    # advertises cards a visitor can use.
    started: list[str] = []
    for agent in agents:
        try:
            _children.extend(_spawn_backend(agent))
            started.append(agent["id"])
        except Exception as exc:  # noqa: BLE001 — one bad agent must not kill the rest
            _log(f"WARNING: skipping '{agent['id']}' — {exc}")
    for agent in agents:
        if agent["id"] in started:
            _wait_ready(agent)

    _log(f"starting gateway on :{GATEWAY_PORT} (agents: {', '.join(started) or 'none'})")
    gateway = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", GATEWAY_PORT],
        cwd=str(GATEWAY_DIR),
        env={**os.environ, "SHOWCASE_STARTED_AGENTS": ",".join(started)},
    )
    _children.append(gateway)

    try:
        gateway.wait()
    finally:
        _terminate_all()


if __name__ == "__main__":
    main()
