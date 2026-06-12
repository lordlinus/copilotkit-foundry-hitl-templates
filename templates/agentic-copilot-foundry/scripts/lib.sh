#!/usr/bin/env bash
# Minimal pass/fail helpers for forgewright app scripts.
set -euo pipefail

_PASS="\033[32mPASS\033[0m"
_FAIL="\033[31mFAIL\033[0m"
_WARN="\033[33mWARN\033[0m"
_FAILED=0

pass() { printf "  [$_PASS] %s\n" "$1"; }
fail() { printf "  [$_FAIL] %s\n" "$1"; _FAILED=1; }
warn() { printf "  [$_WARN] %s\n" "$1"; }
info() { printf "• %s\n" "$1"; }

finish() {
  echo
  if [ "$_FAILED" -ne 0 ]; then
    printf "$_FAIL — one or more checks failed\n"
    exit 1
  fi
  printf "$_PASS — all checks passed\n"
}
