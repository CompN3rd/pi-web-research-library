---
name: changeset-changelog
description: Standalone package release notes and Changesets guidance for user-visible changes.
---

# Changesets

For shipped user-visible changes, add `.changeset/<unique-name>.md`:

```md
---
"@compn3rd/pi-web-research-library": patch
---

Describe the user-visible change and relevant limits.
```

Do not hand-edit CHANGELOG.md. Do not bump package versions or publish without an explicit release request. This standalone package is not PI WEB and does not use its CalVer release workflow. Repository-only tests/agent guidance need no Changeset. Keep conventional commit messages and release notes focused on their respective developer/user audiences.

Before any future npm release, recheck the published host artifact pinned in `docs/development.md`, distribution validation, and the documented residual integration gaps. The host remains a development-only type dependency, not a bundled executable. There is no automatic npm release workflow in this repository.
