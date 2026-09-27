---
"@fleetfrog/agent-rs": patch
"@fleetfrog/agent-ts": patch
---

Retry a GitHub repository the agent can't read after a minute, then less often, up to the GitHub interval, and log its error only when it changes. On macOS, the agent's log now moves to `.1` once it passes 1 MB.
