---
"@fleetfrog/agent-rs": patch
"@fleetfrog/agent-ts": patch
---

Add an `update` policy tier, allowed by default, that decides whether the hub may update the agent. `fleetfrog deny update` leaves updates to `fleetfrog update` on the machine. The policy now records denied tiers as well as allowed ones, and the agent writes the default for any tier it hasn't decided into the policy the first time it runs, recording that in the audit log.
