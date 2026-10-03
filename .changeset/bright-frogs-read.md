---
"@fleetfrog/agent-rs": patch
"@fleetfrog/agent-ts": patch
---

Read T3 Code's threads from `statev2.sqlite`, where T3 Code keeps them from migration 55, so threads and what their agents are doing stay current after T3 Code updates. Machines on an older T3 Code are still read from `state.sqlite`.
