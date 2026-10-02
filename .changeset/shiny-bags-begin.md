---
"@fleetfrog/agent-rs": patch
---

Archive and Trash move only worktrees that still link back to the checkout, and Unarchive puts a worktree back only at a place inside a project folder, so a record written into a repository can't move another folder.
