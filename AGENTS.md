# Research Library agent notes

This is `@compn3rd/pi-web-research-library`, a standalone CompN3rd Pi package—not PI WEB itself. Use only the public browser v4/server v3 contracts of the published host version pinned in `docs/development.md`. Never add host source patches, private routes/imports, PI WEB executables, or an Automations dependency.

Read `.agents/skills/code-quality-architecture/SKILL.md` for production work, `testing-guide/SKILL.md` for test work, `documentation-guide/SKILL.md` for docs, and `changeset-changelog/SKILL.md` for shipped user-visible changes (all paths under `.agents/skills/`).

- Keep README short; detailed usage, compatibility, architecture and verification belong under `docs/`.
- Browser code and public assets stay inside the built `browserRoot`. Use host peer/file helpers for application operations and module-relative URLs for assets; do not import host URL internals.
- Host-resolved workspace context is authority, not peer payload paths. Keep bounded reads, revision checks, atomic publication and source/PDF identity checks intact. Synthetic research fixtures belong only in tests, never a production demo mode.
- Library + Discover are the sole product surfaces; the pilot/synthetic runtime was explicitly retired in the greenfield cutover. Do not reintroduce compatibility loaders or automatic migration. Never delete or rewrite discovered historical workspace records; require a separately scoped, backed-up migration. Evidence deletions retain `.deleted` recovery files, not secure erasure.
- Tests use synthetic fixtures and temporary directories. Prefer pure/storage tests, per-file happy-dom for interaction, and a real browser for canvas/geometry. `npm run verify` validates the real package artifact; `npm run smoke:browser` uses a test host adapter, not a real daemon.
- Never describe failed or skipped checks as passing. Record exact commands and residual gaps.
- Do not install into, modify or restart the live host during tests. A second instance needs a distinct data directory, daemon endpoint and web port. Server plugin changes need an operator-controlled manual session-daemon restart when safe; warn that it interrupts active sessions and terminals.
- No npm publishing is authorized by ordinary implementation/commit/push work. Use this package's name in Changesets, not `@jmfederico/pi-web`. Do not inherit PI WEB CalVer release scripts.
