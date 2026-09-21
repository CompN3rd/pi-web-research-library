---
name: documentation-guide
description: Documentation placement and verification for the standalone Research Library package.
---

# Documentation guide

Keep README a concise landing page: identity, compatibility warning, shortest supported local setup and links. Detailed material has one canonical home:

- `docs/usage.md`: manifests, read/mark workflows, companion tools, data retention and cutover.
- `docs/development.md`: exact host bootstrap, commands, packaging and test setup.
- `docs/architecture.md`: boundaries, lifecycle, transport and storage limits.
- `docs/verification.md`: actual evidence, failures found/fixed and unverified paths.

Do not copy PI WEB's website, service installation guide or host configuration API. Do not promise registry compatibility from an unreleased source version string. Distinguish implemented behavior from plans and verified behavior from design assumptions. Restart instructions must warn about interrupted sessions. Keep research data/private machine paths out of examples and package assets.

For docs changes, check links and command names, run `git diff --check`, inspect package allowlists and update a Changeset when shipped guidance materially changes. Never label a test transport adapter as a real host-daemon integration test.
