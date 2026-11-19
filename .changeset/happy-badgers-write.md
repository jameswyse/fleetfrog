---
"@fleetfrog/hub": patch
---

Stop a stalled T3 Code release check from blocking later checks, and report a dashboard socket the hub can't replace as a startup error. Requests from a deleted account now show it as signed out, and a fetch or pull that includes a machine that's no longer paired says so, instead of failing with an internal error.
