---
"@fleetfrog/hub": patch
---

Keep agent sessions, actions, updates and settings consistent when requests overlap or are cancelled. A reconnecting agent no longer appears offline or loses its connection, cancelling a request no longer stops a saved batch from being sent, and two people changing sign-in settings at once no longer undo each other.
