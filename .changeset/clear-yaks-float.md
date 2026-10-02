---
"@fleetfrog/hub": patch
---

Cut text an agent reports to 4096 characters and lists to 5000 items, and keep at most 5000 checkouts for a machine, so one compromised agent can't fill the hub's database or every dashboard's memory.
