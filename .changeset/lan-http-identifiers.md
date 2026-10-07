---
"@compn3rd/pi-web-research-library": patch
---

Fix Library startup and Discover saved searches on trusted LAN HTTP origins. Generate the existing identifier format with cryptographic random bytes instead of the secure-context-only `crypto.randomUUID` API. This does not add authentication or transport encryption; use PI WEB only on a trusted network or behind appropriately secured HTTPS.
