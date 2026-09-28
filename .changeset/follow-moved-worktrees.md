---
"@fleetfrog/agent-rs": patch
"@fleetfrog/agent-ts": patch
---

After archiving, unarchiving, trashing, restoring or deleting a checkout, the agent reports all of its linked worktrees where they are now, including ones inside the checkout's folder, in the same report as the checkout. Before, a nested worktree stayed at its old path until the next status pass. Discovery now also lists the linked worktrees of archived checkouts, so a worktree archived inside its checkout no longer disappears.
