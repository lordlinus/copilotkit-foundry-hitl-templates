"""Supervisor for the showcase container.

For each agent in ``agents.json`` it starts the SAME two-process stack the
templates use locally (`make local`) and in production:

  * **MAF agents** (the default): the Foundry hosted-agent runtime
    (``ResponsesHostServer`` = ``<template>/app.py``, the same thing ``azd ai agent
    run`` runs) on an internal host port, plus the thin AG-UI<->Responses **bridge**
    (``bridge_app:app``) on the agent's public port, pointed at that runtime in
    DIRECT mode. All tools + HITL + history run server-side in the runtime; the
    bridge only translates protocols and forwards ``mcp_approval_response``.
  * **Node agents** (``runtime: node``): a self-contained AG-UI backend
    (``node dist/index.js``) -- left unchanged.

The gateway (``app.py``) then reverse-proxies ``/agents/<id>/*`` to each bridge.
On SIGTERM/SIGINT every child is torn down.

Environment passed through to each backend:
  FOUNDRY_PROJECT_ENDPOINT       the Foundry project (keyless; model for the runtime)
  AZURE_AI_MODEL_DEPLOYMENT_NAME the model deployment the hosted agent runs on
  AZURE_*                        DefaultAzureCredential inputs (managed identity in ACA)
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
# Internal Foundry hosted-agent runtime port = public bridge port + this offset.
HOST_PORT_OFFSET = int(os.environ.get("HOST_PORT_OFFSET", "1000"))

_children: list[subprocess.Popen] = []


def _log(msg: str) -> None:
    print(f"[launcher] {msg}", flush=True)


def _host_port(agent: dict) -> int:
    return int(agent["port"]) + HOST_PORT_OFFSET


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


def _spawn_maf_backend(agent: dict) -> list[subprocess.Popen]:
    """Start the hosted-agent runtime (ResponsesHostServer) + the bridge (DIRECT)."""
    # backendDir is templates/<id>/backend; the runtime entrypoint app.py + src/ are
    # one level up at the template root.
    backend_dir = (REPO_ROOT / agent["backendDir"]).resolve()
    template_dir = backend_dir.parent
    app_py = template_dir / "app.py"
    bridge = backend_dir / "bridge_app.py"
    if not app_py.exists():
        raise FileNotFoundError(f"app.py (hosted-agent runtime) not found at {app_py}")
    if not bridge.exists():
        raise FileNotFoundError(f"bridge_app.py not found at {bridge}")

    public_port = str(agent["port"])
    host_port = str(_host_port(agent))
    agent_name = agent.get("agentName", agent["id"])

    # 1) Foundry hosted-agent runtime (Responses) on the internal host port.
    _log(f"starting '{agent['id']}' hosted-agent runtime (ResponsesHostServer) on :{host_port}")
    runtime = subprocess.Popen(
        [sys.executable, "app.py"],
        cwd=str(template_dir),
        env={**os.environ, "PORT": host_port},
    )

    # 2) The AG-UI bridge (DIRECT mode) on the public port the gateway proxies to.
    _log(f"starting '{agent['id']}' AG-UI bridge on :{public_port} -> runtime :{host_port}")
    bridge_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "bridge_app:app", "--host", "127.0.0.1", "--port", public_port],
        cwd=str(backend_dir),
        env={
            **os.environ,
            "PORT": public_port,
            "HOSTED_AGENT_DIRECT_URL": f"http://127.0.0.1:{host_port}",
            "HOSTED_AUTH": "none",
            "AGENT_NAME": agent_name,
        },
    )
    return [runtime, bridge_proc]


def _spawn_backend(agent: dict) -> list[subprocess.Popen]:
    if agent.get("runtime", "python") == "node":
        return _spawn_node_backend(agent)
    return _spawn_maf_backend(agent)


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

    for agent in agents:
        _children.extend(_spawn_backend(agent))
    for agent in agents:
        _wait_ready(agent)

    _log(f"starting gateway on :{GATEWAY_PORT}")
    gateway = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", GATEWAY_PORT],
        cwd=str(GATEWAY_DIR),
        env={**os.environ},
    )
    _children.append(gateway)

    try:
        gateway.wait()
    finally:
        _terminate_all()


if __name__ == "__main__":
    main()
