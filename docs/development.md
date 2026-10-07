# Development and compatibility

## Supported development target

Build against published **`@jmfederico/pi-web@1.202609.1`**, browser API **v4**, server API **v3**, and native Pi **0.87.1**. The release exports `pi-web.host/pi-sessions@1` (initial-prompt admission/completion) and `pi-session-events@1` (session-local ephemeral messaging). Native structured-result publication requires both. The API integers did not change from the earlier source target; the published artifact now supplies the needed public contract. Older registry `1.202609.0` is not a substitute. Local real-host cold-start loading has been tested in an isolated instance. Other host versions, managed-service deployment and provider-backed result delivery remain subject to the [verification gaps](verification.md).

The exact host and Pi development versions are pinned in `package.json` and `package-lock.json`. PI WEB is a development-only type dependency; no PI WEB CLI, web server, session daemon, or private host module is shipped. Citation.js, TypeBox support, Lit and unpdf are build-time dependencies bundled into the relevant entries; citeproc-js is copied unchanged to a separate package-local CommonJS module. Users do not need this project's devDependencies at runtime. Imports outside the package are Node built-ins and the companion's native Pi AI `StringEnum` helper. Structural public capability tokens are checked against published exports without a runtime PI WEB import. Third-party licenses and versions are retained under `dist/licenses/`; browser PDF.js assets retain their own licenses.

## Bootstrap

Run from this repository using Node.js 22.19+:

```sh
npm ci
npm run verify
```

No source-built host tarball, sibling checkout, or live installation change is needed. Keep any independent host build checkout outside an installed plugin directory: discovery counts ignored files too (except `.git` and `node_modules`), so a nested checkout can exceed the host's 4,096-entry / 16 MiB package limit.

The CI workflow installs the pinned registry dependencies directly. Build tools are dev dependencies; the package's compiled browser modules, PDF assets, server entry, companion and isolated `pdf-text-worker.js` are all included by `npm pack`. A bare source Git install is **not** a prebuilt distribution: build first and install the local directory or a packed tarball. No npm release workflow is configured or invoked here.

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

`verify` runs all of those checks. `pack:validate` creates, inspects and safely extracts a real tarball in a temporary directory, then runs its server, bibliography/CSL engine and actual PDF-text worker outside the repository with no installed devDependencies or network calls. The temporary files are removed afterward. Distribution checks verify native tool discovery, source/license identity, public import boundaries, required assets, publication allowlists and host size limits. Tests use temporary research fixtures and do not touch live state.

## Third-party source and notices

The project's MIT license does not replace dependencies' licenses. citeproc-js 2.4.63 is used under its **CPAL-1.0** option. `dist/vendor/citeproc.cjs` is byte-identical upstream source, not a transformed mixed-license bundle. Every panel displays its required Frank Bennett / Citation Style Language attribution and module-relative links to the distributed source and complete CPAL license. Version/source provenance and integration notes live under `dist/licenses/citeproc/`; the pinned license input is under `third-party/citeproc/` in this repository. Other bundled dependencies' notices and declared metadata are retained in `dist/licenses/`. Recheck rights, source availability and attribution before a release or dependency change; automated checks are not a legal certification.

## Browser verification

For a real-browser package smoke test:

```sh
npx playwright install chromium
npm run smoke:browser
# Or use installed Microsoft Edge on Windows:
RESEARCH_BROWSER_CHANNEL=msedge npm run smoke:browser
```

The browser smoke uses a generated 12 MiB PDF, compiled plugin entries and an ephemeral loopback **test transport adapter**, not a PI WEB daemon. It exercises compiled browser/server seams, nested assets and the actual PDF.js worker/canvas. An additional three-page authored fixture checks selectable text geometry, reader Find/highlights, page/width fit, keyboard navigation, modal focus restoration, rapid zoom cancellation, page tones and a 390px layout at device-pixel ratio 2. Reader annotation checks additionally exercise create/save/reload/reopen/edit through the workbench at desktop 1400×1000 and touch-enabled 768×1024 / 390×844, DPR 2. Selected-text highlights additionally exercise native mouse dragging and a keyboard/touch start/end text-run picker, then save without a comment, reload/reopen, add a comment and reopen/edit through the same server adapter. Touch drags use Chromium input dispatch and controls use Playwright taps; native select values use Playwright’s select API after tapping the control (not OS picker automation); these are emulated touch configurations, not physical-device tests. The harness waits for disconnected readers' `pdf.close` responses before navigation so successive tests do not depend on idle snapshot expiry. Library/Discover workflow checks use only synthetic fixtures and fake public session/event capabilities; they make no model-provider calls. No legacy source probes or demo asset are shipped. See the exact checks and current outcomes in [verification](verification.md). Screenshots stay in ignored `.smoke/`. It does not prove host catalog discovery, remote federation, or service installation.

Any full-host smoke must use distinct `PI_WEB_DATA_DIR`, daemon endpoint and web port. Never inherit the live `PI_WEB_*` state into a second instance. Server entry changes require a manual restart of that test daemon; UI reload or Pi `/reload` alone does not activate them.
