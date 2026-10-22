---
"@fleetfrog/agent-rs": patch
"@fleetfrog/agent-ts": patch
"@fleetfrog/hub": patch
---

Reject TLS certificates issued through the compromised eMudhra CAs. The hub and the TypeScript agent pin Node.js 26.12.1, and the Rust agent uses rustls-webpki 0.103.16 and webpki-roots 1.0.10.
