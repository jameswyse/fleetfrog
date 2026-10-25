---
"@fleetfrog/hub": patch
---

Base the hub image on Debian 13 slim instead of the pnpm build image, so it carries 23 fewer OS packages and none of the 3 critical and 49 high fixable vulnerabilities Trivy reports in the 0.10.2 image.
