# Workflow — upgrade agent-framework and re-check / remove patches

The bridge carries a small number of patches that exist **only** because of open
upstream bugs. This stack's durable value is keeping them minimal: on every package
bump, re-run the matrix and delete a patch the moment upstream closes its issue.
Never remove a patch on the strength of a version bump alone.

## The tracked patches and their issues

| Patch (where) | Exists because of | Remove when |
| --- | --- | --- |
| HITL approval routing (`bridge_app.py` neutralises ag-ui local interception) + `HostedProxyAgent` forwarding `mcp_approval_response` | **#6652** — AG-UI adapter doesn't forward HITL approval to a hosted/remote agent | #6652 closes AND `make smoke` approve/reject stays green with the native `FoundryAgent` path |
| Multi-tool snapshot split (`bridge_app.py::_build_messages_snapshot`) | CopilotKit v1 renders only `toolCalls[0]` (`confirm_changes` card vanishes at RUN_FINISHED); related to **#6828** | frontend is v2-only AND C9 passes with `DISABLE_C9_SPLIT=1` |
| DIRECT-mode `previous_response_id` guard (`hosted_client.py::converse_stream`) | **#6851 / #6828** — approved tool silently re-executes on a later turn | #6851 & #6828 close AND C11 passes without the guard |

## Steps

1. **Bump the pins** in `hosted/responses/requirements.txt` (and any bridge deps):
   `agent-framework-core`, `agent-framework-foundry`, `agent-framework-ag-ui`,
   `agent-framework-foundry-hosting`. Keep them **consistent** — do not mix
   major/protocol lines of the same family.
2. **Match the protocol version.** `agent-framework-foundry-hosting`'s protocol must
   equal the `version` in `hosted/responses/agent.yaml` **and**
   `agent.manifest.yaml`, or the hosted runtime fast-fails: `RuntimeError: the hosted
   environment is running on protocol X, but the agent requires protocol Y`. Bump
   both manifests together (v2.0 is `1.0.0a260630`+; see
   `../references/architecture.md`, "Protocol v2.0").
3. **`make verify`** (structural, no network) — must stay green.
4. **`make smoke`** — the full 15-assertion live matrix against the REAL agent via
   `azd ai agent run` (read, HITL pause, approve re-executes, reject doesn't, C9,
   C10, C11 for DIRECT mode, and C12 persistent approved-action cards). Must stay green.
   Then run **`make e2e`** so the built UI proves reject, approve, visible action
   result, state change, and same-thread follow-up behavior.
5. **Re-run the native-path matrix** in `../references/architecture.md` ("Why the
   bridge is the MINIMUM") — not just the top row — whenever any of #6652/#6828/#6851
   shows a merged fix. Otherwise a targeted re-check of the one issue that moved is
   enough; don't burn live Foundry calls reconfirming a known negative.
6. **Check upstream status** of #6652, #6828 (fix PR #6829 was closed unmerged),
   #6851. Only when an issue is **closed/merged** and its patch's smoke assertion
   still passes **without** the patch do you delete that patch. Then re-run steps 3–4.

## CopilotKit / AG-UI upgrades (separate cadence, same discipline)

CopilotKit's API moves between minor versions. Before bumping `@copilotkit/*`,
re-verify against the new version's own bundled `.d.ts`/docs, not assumptions:
- route-handler factory name (`createCopilotHonoHandler` today),
- single-route vs multi-route default (`useSingleEndpoint`),
- provider name (`CopilotKit` vs `CopilotKitProvider`),
- `@ag-ui/client` pin must match the version `@copilotkit/runtime` resolves (a
  mismatch gives `HttpAgent` type errors like missing `pendingInterrupts`).
See `../references/troubleshooting.md` (CopilotKit bridge table).

## Deployed-path caveat

`make smoke`/`make local` (DIRECT mode) is currently the only live-verifiable path;
`azd deploy`/`azd up` packaging can hit an azd-side `project: ..` path check
(`../references/troubleshooting.md`, Containers/azd). Verify what you can via DIRECT
mode and note anything left unproven on the deployed path.
