"""Supervisor for the showcase container.

Starts one uvicorn process per template backend (each on its internal port from
``agents.json``), waits for them to report healthy, then runs the gateway
(``app.py``) in the foreground on ``$PORT`` (default 8080). On SIGTERM/SIGINT it
tears every child down.

Environment passed through to each backend process:
  LLM_MODE                  ``mock`` for offline/CI, unset/real for keyless Foundry
  FOUNDRY_PROJECT_ENDPOINT  required when LLM_MODE is not ``mock``
  AZURE_*                   DefaultAzureCredential inputs (managed identity in ACA)
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
READY_TIMEOUT = float(os.environ.get("BACKEND_READY_TIMEOUT", "90"))

_children: list[subprocess.Popen] = []


def _log(msg: str) -> None:
    print(f"[launcher] {msg}", flush=True)


def _spawn_backend(agent: dict) -> subprocess.Popen:
    backend_dir = (REPO_ROOT / agent["backendDir"]).resolve()
    if not (backend_dir / "ag_ui_app.py").exists():
        raise FileNotFoundError(f"ag_ui_app.py not found in {backend_dir}")
    port = str(agent["port"])
    _log(f"starting '{agent['id']}' backend on :{port} (cwd={backend_dir})")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "ag_ui_app:app", "--host", "127.0.0.1", "--port", port],
        cwd=str(backend_dir),
        env={**os.environ},
    )


def _wait_ready(agent: dict) -> bool:
    url = f"http://127.0.0.1:{agent['port']}/healthz"
    deadline = time.time() + READY_TIMEOUT
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:  # noqa: S310 — localhost only
                if r.status == 200:
                    _log(f"'{agent['id']}' is ready")
                    return True
        except Exception:  # noqa: BLE001 — backend still booting
            time.sleep(1)
    _log(f"WARNING: '{agent['id']}' did not become ready within {READY_TIMEOUT}s")
    return False


def _terminate_all(*_: object) -> None:
    _log("shutting down child backends")
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
        _children.append(_spawn_backend(agent))
    for agent in agents:
        _wait_ready(agent)

    _log(f"starting gateway on :{GATEWAY_PORT}")
    gateway = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", GATEWAY_PORT],
        cwd=str(GATEWAY_DIR),
        env={**os.environ},
    )
    _children.append(gateway)

    # Block on the gateway; if any backend dies, surface it but keep serving.
    try:
        gateway.wait()
    finally:
        _terminate_all()


if __name__ == "__main__":
    main()
