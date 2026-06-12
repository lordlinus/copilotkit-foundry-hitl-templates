#!/usr/bin/env python3
"""End-to-end HITL smoke test against the local AG-UI backend.

Drives backend/ag_ui_app.py on http://localhost:8080/ exactly as the CopilotKit
frontend does. Designed to run with `LLM_MODE=mock` so it needs NO Azure and NO
real model (the Makefile `smoke` target starts the backend in mock mode).

Asserts:
  1. A read prompt reaches RUN_FINISHED and exposes state.
  2. A consequential prompt PAUSES (function_approval_request / confirm_changes)
     and does NOT execute (state unchanged).
  3. Replaying {accepted: true, steps} executes the tool (state changes).
  4. Replaying {accepted: false, steps} does NOT change state.
  5. The MESSAGES_SNAPSHOT has no assistant message with len(toolCalls) > 1 (C9).
  6. A crafted orphaned-call history reaches RUN_FINISHED, never RUN_ERROR /
     "No tool output found" (C10).

Exits non-zero on the FIRST failed category. If you rename the demo tools,
update READ_PROMPT / ACTION_PROMPT / STATE_FIELD / READ_TOOL below.
"""
from __future__ import annotations
import json, re, subprocess, sys

BASE = "http://localhost:8080/"
PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
rc = 0

# ── EDIT these to match your tool surface ─────────────────────────────────────
READ_PROMPT   = "What is the current value?"
ACTION_PROMPT = "Apply a delta of 10."
STATE_FIELD   = "value"
READ_TOOL     = "get_value"   # used only to craft the C10 orphan history
def parse_state(blob: str):
    # The AG-UI stream embeds tool-result JSON inside SSE strings, so braces and
    # quotes arrive backslash-escaped. Unescape before matching.
    flat = blob.replace('\\"', '"').replace("\\\\", "\\")
    m = re.search(r'"%s":\s*([0-9.]+)' % STATE_FIELD, flat)
    return float(m.group(1)) if m else None
# ──────────────────────────────────────────────────────────────────────────────

def post(body: dict) -> str:
    return subprocess.run(
        ["curl", "-s", "-m", "60", "-N", BASE, "-H", "Content-Type: application/json",
         "-d", json.dumps(body)],
        capture_output=True, text=True).stdout

def check(name: str, ok: bool) -> None:
    global rc
    print(f"  [{PASS if ok else FAIL}] {name}")
    if not ok:
        rc = 1

def extract_snapshot(blob: str):
    i = blob.find('"type":"MESSAGES_SNAPSHOT"')
    if i < 0:
        return None
    j = blob.rfind('{', 0, i)
    depth, k, instr, esc = 0, j, False, False
    while k < len(blob):
        c = blob[k]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        elif c == '"': instr = True
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(blob[j:k+1])
                except Exception:
                    return None
        k += 1
    return None

def find_confirm_changes(snap: dict):
    for m in snap.get("messages", []):
        for tc in m.get("toolCalls", []) or []:
            if tc.get("function", {}).get("name") == "confirm_changes":
                return tc["id"], json.loads(tc["function"].get("arguments", "{}"))
    return None, None

# 1. Read prompt
print("1) Read tool -> RUN_FINISHED")
b = post({"threadId": "s1", "runId": "s1",
          "messages": [{"id": "m", "role": "user", "content": READ_PROMPT}],
          "tools": [], "context": [], "state": {}})
start = parse_state(b)
check("run reached RUN_FINISHED", "RUN_FINISHED" in b)
check(f"parsed initial state.{STATE_FIELD}", start is not None)

# 2. Consequential prompt: must pause, must NOT execute
print("2) Consequential prompt PAUSES + does NOT execute")
b2 = post({"threadId": "s2", "runId": "s2",
           "messages": [{"id": "m", "role": "user", "content": ACTION_PROMPT}],
           "tools": [], "context": [], "state": {}})
check("emitted function_approval_request", "function_approval_request" in b2 or "confirm_changes" in b2)
snap = extract_snapshot(b2)
check("snapshot present", snap is not None)
confirm_id, confirm_args = find_confirm_changes(snap or {})
check("confirm_changes tool call captured", confirm_id is not None)
bad = [m for m in (snap or {}).get("messages", [])
       if m.get("role") == "assistant" and len(m.get("toolCalls") or []) > 1]
check("C9: no assistant snapshot message has >1 tool_calls", not bad)
b3 = post({"threadId": "s2r", "runId": "s2r",
           "messages": [{"id": "m", "role": "user", "content": READ_PROMPT}],
           "tools": [], "context": [], "state": {}})
mid = parse_state(b3)
check("state UNCHANGED before approval", start is not None and mid == start)

# 3. Approve -> tool executes -> state changes
if confirm_id and confirm_args is not None:
    print("3) Approve -> tool executes")
    approval_msg = {"id": "approve-1", "role": "tool", "toolCallId": confirm_id,
                    "content": json.dumps({"accepted": True, "steps": confirm_args.get("steps")})}
    history = (snap or {}).get("messages", []) + [approval_msg]
    b4 = post({"threadId": "s2", "runId": "s2-approve",
               "messages": history, "tools": [], "context": [], "state": {}})
    check("approval run reached RUN_FINISHED", "RUN_FINISHED" in b4)
    check("no RUN_ERROR after approve", "RUN_ERROR" not in b4)
    check("no 'No tool output found' (C10 regression)", "No tool output found" not in b4)
    b5 = post({"threadId": "s2re", "runId": "s2re",
               "messages": [{"id": "m", "role": "user", "content": READ_PROMPT}],
               "tools": [], "context": [], "state": {}})
    after_approve = parse_state(b5)
    check("state CHANGED after approval",
          start is not None and after_approve is not None and after_approve != start)

    # 4. Reject -> tool does NOT execute
    print("4) Reject -> tool does NOT execute")
    b6 = post({"threadId": "s3", "runId": "s3",
               "messages": [{"id": "m", "role": "user", "content": ACTION_PROMPT}],
               "tools": [], "context": [], "state": {}})
    snap6 = extract_snapshot(b6)
    cid6, cargs6 = find_confirm_changes(snap6 or {})
    if cid6:
        reject_msg = {"id": "reject-1", "role": "tool", "toolCallId": cid6,
                      "content": json.dumps({"accepted": False, "steps": cargs6.get("steps")})}
        history6 = (snap6 or {}).get("messages", []) + [reject_msg]
        post({"threadId": "s3", "runId": "s3-reject",
              "messages": history6, "tools": [], "context": [], "state": {}})
        b7 = post({"threadId": "s3re", "runId": "s3re",
                   "messages": [{"id": "m", "role": "user", "content": READ_PROMPT}],
                   "tools": [], "context": [], "state": {}})
        after_reject = parse_state(b7)
        check("state UNCHANGED after rejection",
              after_approve is not None and after_reject == after_approve)

# 5. C10 orphaned-call replay regression
print("5) C10: crafted orphaned tool-call history -> RUN_FINISHED")
orphan_history = [
    {"id": "u1", "role": "user", "content": READ_PROMPT},
    {"id": "a1", "role": "assistant", "content": "",
     "toolCalls": [{"id": "call_orphan_xyz", "type": "function",
                    "function": {"name": READ_TOOL, "arguments": "{}"}}]},
    {"id": "u2", "role": "user", "content": "Continue."},
]
b8 = post({"threadId": "c10", "runId": "c10",
           "messages": orphan_history, "tools": [], "context": [], "state": {}})
check("C10 reached RUN_FINISHED", "RUN_FINISHED" in b8)
check("C10 no RUN_ERROR", "RUN_ERROR" not in b8)
check("C10 no 'No tool output found'", "No tool output found" not in b8)

print()
sys.exit(rc)
