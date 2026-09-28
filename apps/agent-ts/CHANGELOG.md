# @fleetfrog/agent-ts

## 0.4.0

No changes in this release.

## 0.3.1

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.1

### Patch Changes

- e26d3b3: Add `fleetfrog update`, which asks the hub for its version, lists the agent's changes since the installed version and, once confirmed or with `--yes`, installs that release and restarts the service. Release builds of the agent also update when the hub asks, then restart on the new version.
- 2b33ebe: Add an `update` policy tier, allowed by default, that decides whether the hub may update the agent. `fleetfrog deny update` leaves updates to `fleetfrog update` on the machine. The policy now records denied tiers as well as allowed ones, and the agent writes the default for any tier it hasn't decided into the policy the first time it runs, recording that in the audit log.
- c392fb9: After archiving, unarchiving, trashing, restoring or deleting a checkout, the agent reports all of its linked worktrees where they are now, including ones inside the checkout's folder, in the same report as the checkout. Before, a nested worktree stayed at its old path until the next status pass. Discovery now also lists the linked worktrees of archived checkouts, so a worktree archived inside its checkout no longer disappears.
- 6019bc5: Run a second agent beside the default one on the same machine by naming it with `FLEETFROG_INSTANCE`. A named instance has its own pairing, policy, action log and service.
- 4ce9018: Retry a GitHub repository the agent can't read after a minute, then less often, up to the GitHub interval, and log its error only when it changes. On macOS, the agent's log now moves to `.1` once it passes 1 MB.

## 0.1.0

### Minor Changes

- 17c1b9f: Read T3 Code on each machine: show its project names and icons for repositories, and add Settings › Integrations › T3 Code with switches, what each machine's agent found, and a warning when T3 Code's database schema differs from the one FleetFrog was built for.
- 8041d44: Show T3 Code's version, whether its server is running and its coding agents' versions, updates and sign-in state for each machine, and line up the grid's project and host icons and names.

### Patch Changes

- a395c22: Keep the agent running when the hub restarts while the agent is reconnecting.
- 1acd887: Wait for the agent's first scan after it starts, instead of saying a checkout doesn't exist.
