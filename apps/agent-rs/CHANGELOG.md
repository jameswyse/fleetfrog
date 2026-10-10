# @fleetfrog/agent-rs

## 0.8.0

### Minor Changes

- 2ddf973: Show the disk space macOS can purge as a lighter part of each disk bar, and count it as free, as Finder does.

## 0.7.0

### Patch Changes

- 11bf0a8: Refresh runtime dependencies, build tooling, Node.js and the Rust toolchain.

## 0.6.1

### Patch Changes

- 57cb148: Refresh runtime dependencies and build tooling, including fixes for vulnerable development dependencies.

## 0.6.0

### Minor Changes

- 597b8a7: Discard a checkout's uncommitted changes from its More menu, and choose to discard rather than stash changes when switching branches or removing a worktree. Discarded changes go to Cleanup → Trash, where they can be restored until the Trash is emptied. Discarding needs the cleanup tier. Group actions no longer offer Rescan.

### Patch Changes

- 366cc12: Read T3 Code's threads from `statev2.sqlite`, where T3 Code keeps them from migration 55, so threads and what their agents are doing stay current after T3 Code updates. Machines on an older T3 Code are still read from `state.sqlite`.

## 0.5.3

### Patch Changes

- 015d547: Sign each release's checksums, and check that signature in the install script and before the agent updates itself.
- db83ce2: Run Git with the repository's file system monitor and hooks turned off and with remote helpers such as ext:: disallowed, so a repository on disk can't run programs through the agent. Skip a remote whose name starts with a dash when counting unpushed tags.
- db83ce2: Strip credentials from remote URLs in Git output before it reaches the hub, cap captured output, and download updates to a fresh file name each time.
- 2562d33: The install script downloads only over HTTPS, writes to a fresh file name each time, and runs nothing until the whole script has arrived. Releases also attest SHA256SUMS and install.sh.
- db83ce2: Archive and Trash move only worktrees that still link back to the checkout, and Unarchive puts a worktree back only at a place inside a project folder, so a record written into a repository can't move another folder.

## 0.5.2

No changes in this release.

## 0.5.1

No changes in this release.

## 0.5.0

No changes in this release.

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

- de5e2e6: Add the agent as a native Rust binary, which needs no Node and uses a fraction of the memory.
- 4674765: Release the agent as prebuilt binaries for Linux and macOS, with a script that installs and updates it.
