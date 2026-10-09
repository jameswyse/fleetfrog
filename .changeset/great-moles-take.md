---
"@fleetfrog/web": patch
---

Expect T3 Code's database schema at migration 60. Machines on the same T3 Code schema now share one notice, and a schema mismatch shows as a neutral notice instead of a red warning, because FleetFrog usually still reads it correctly.
