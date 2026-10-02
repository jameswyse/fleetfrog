---
"@fleetfrog/agent-rs": patch
---

Run Git with the repository's file system monitor and hooks turned off and with remote helpers such as ext:: disallowed, so a repository on disk can't run programs through the agent. Skip a remote whose name starts with a dash when counting unpushed tags.
