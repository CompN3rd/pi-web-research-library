# Development and compatibility

## Supported development target

Build against **`jmfederico/pi-web@60a29acbfc710908e73b0df9857cb63b53b672d3`**, browser API **v4**, server API **v3**, with Pi **^0.85.1**. The pinned host still declares version `1.202609.0`; its npm registry artifact predates this plugin contract. Some upstream examples instead declare `2.202609.0`. Neither string is sufficient evidence of compatibility. A published-host range must be selected and verified before an npm release of this package.

This repository has no PI WEB CLI, web server, session daemon, or private host API dependency. Its `.host-package/pi-web.tgz` development dependency is an ignored artifact built from that exact source. Runtime entrypoint imports are Node built-ins and the companion's native `typebox` / Pi AI `StringEnum` peers. PI WEB imports and Pi coding-agent imports are type-only; the enum helper produces provider-compatible tool schemas.

## Bootstrap

Run from this repository using Bash (or equivalent PowerShell commands), against a **separate build checkout**, never an installed live host:

```sh
mkdir -p .host-package
git clone https://github.com/jmfederico/pi-web.git ../pi-web-research-host-build
git -C ../pi-web-research-host-build checkout --detach 60a29acbfc710908e73b0df9857cb63b53b672d3
(cd ../pi-web-research-host-build && npm ci && npm run build && npm pack)
cp ../pi-web-research-host-build/jmfederico-pi-web-1.202609.0.tgz .host-package/pi-web.tgz
node scripts/refresh-host-integrity.mjs
npm ci
npm run verify
```

The hash refresh updates only the local host artifact's lockfile integrity, not its source identity. Platform builds need not be byte-identical. Run it only after verifying the source SHA; do not substitute the registry tarball. Existing sibling `pi-web-upstream-plugins` builds can supply this artifact after the same revision check. No host rebuild is needed for subsequent plugin edits. Keep the host build checkout **outside** the local plugin directory: host discovery counts ignored files too (except `.git` and `node_modules`), so a nested host source/build can exceed its 4,096-entry / 16 MiB package limit. Git ignore rules alone do not hide files from plugin discovery.

The CI workflow builds that pinned host before installing this package's development dependencies. Build tools are dev dependencies; the package's compiled browser modules, PDF assets, server entry and companion are all included by `npm pack`. A bare source Git install is **not** a prebuilt distribution: build first and install the local directory or a packed tarball. No npm release workflow is configured or invoked here.

## Commands

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run validate:dist
npm run pack:validate
npm run verify
```

`verify` runs all of those checks. `pack:validate` creates and inspects a real tarball in a temporary directory, then removes it. Distribution checks verify entries, public import boundaries, PDF assets, publication allowlists and host size limits. Tests use temporary research fixtures and do not touch live state.

For a real-browser package smoke test:

```sh
npx playwright install chromium
npm run smoke:browser
# Or use installed Microsoft Edge on Windows:
RESEARCH_BROWSER_CHANNEL=msedge npm run smoke:browser
```

The browser smoke uses a generated 12 MiB PDF, compiled plugin entries and an ephemeral loopback **test transport adapter**, not a PI WEB daemon. It exercises nested asset URLs, the actual PDF.js worker/canvas, selection coordinates, reload persistence and conflicting edits from two tabs. Screenshots stay in ignored `.smoke/`. It does not prove host catalog discovery, remote federation, or service installation.

Any full-host smoke must use distinct `PI_WEB_DATA_DIR`, daemon endpoint and web port. Never inherit the live `PI_WEB_*` state into a second instance. Server entry changes require a manual restart of that test daemon; UI reload or Pi `/reload` alone does not activate them.
