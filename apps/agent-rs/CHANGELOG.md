# @fleetfrog/agent-rs

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

- de5e2e6: Add the agent as a native Rust binary, which needs no Node and uses a fraction of the memory.
- 4674765: Release the agent as prebuilt binaries for Linux and macOS, with a script that installs and updates it.
