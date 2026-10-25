---
"@fleetfrog/web": patch
---

Stop flagging a branch whose upstream was deleted once it has merged, in the grid and the Out of sync filter. The grid now marks a deleted upstream with no merge in amber rather than red, and flags a Git operation in progress.
