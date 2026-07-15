# State isolation — one agent, many sandboxes

A minimal GitHub Copilot SDK demo that proves per-session state isolation and
persistence for a single agent:

- write a fact in session A,
- session B cannot see it (**isolation**),
- resuming session A from a fresh client still remembers it (**persistence**).

The SDK persists each session's conversation + workspace under `COPILOT_HOME`
(`createSession({sessionId})` / `resumeSession(sessionId)`) — the same
per-session mechanism a Foundry hosted agent gets via `$HOME`. There is no
AG-UI here; this is a pure state-management showcase, separate from the
template apps.

## Run

```bash
cd copilot-sdk
npm install && npm start   # needs the same model env as the showcase PR agent
```

Session state is written to `./.state/` at runtime (gitignored — it contains
local paths and SQLite session databases; never commit it).
