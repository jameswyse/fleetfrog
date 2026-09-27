# @fleetfrog/agent-ts

## 0.1.0

### Minor Changes

- 17c1b9f: Read T3 Code on each machine: show its project names and icons for repositories, and add Settings › Integrations › T3 Code with switches, what each machine's agent found, and a warning when T3 Code's database schema differs from the one FleetFrog was built for.
- 8041d44: Show T3 Code's version, whether its server is running and its coding agents' versions, updates and sign-in state for each machine, and line up the grid's project and host icons and names.

### Patch Changes

- a395c22: Keep the agent running when the hub restarts while the agent is reconnecting.
- 1acd887: Wait for the agent's first scan after it starts, instead of saying a checkout doesn't exist.
