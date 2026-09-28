---
"@fleetfrog/agent-rs": patch
"@fleetfrog/agent-ts": patch
---

Add `fleetfrog update`, which asks the hub for its version, lists the agent's changes since the installed version and, once confirmed or with `--yes`, installs that release and restarts the service. Release builds of the agent also update when the hub asks, then restart on the new version.
