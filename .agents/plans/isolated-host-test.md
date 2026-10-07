# Isolated real-host test — 2026-09-26

Operator chose option 1: load this plugin in an isolated instance, leaving the current host untouched. No model-provider calls, live-host installation/configuration changes, managed service operations, commits or publishing were authorized or performed.

## Stopped instance — operator request, 2026-09-26

Stopped at **2026-09-26T19:59:14Z** after revalidating exact process creation times, commands, listener ownership and the isolated daemon owner record. Both isolated processes exited and ports **18504/18505** have no listeners. The normal host's daemon on **8505**, PID **19992**, remained unchanged. Test files, package snapshots, synthetic data and logs were preserved. Receipt: `<root>/shutdown.json`.

The following addresses/process identities are historical, not running endpoints:

- Former URL: `http://192.168.178.48:18504/` (WLAN IPv4, explicitly requested by the operator; formerly loopback).
- Former Library deep link: `http://192.168.178.48:18504/?project=24a1256d-22ec-4bca-9e37-6f8df701192b&workspace=4e991021abbb&tool=research-library%3Aworkspace.research-library.native&view=workspace`.
- Root: `C:/Users/Wizar/AppData/Local/Temp/research-library-host-uyQjjM`.
- Last web process PID (stopped): **18464**, address **192.168.178.48:18504**, started 2026-09-26T18:29:31Z. Earlier web PIDs 15804 and 3192 were verified and stopped during rebind/update.
- Last session daemon PID (stopped): **14008**, endpoint **127.0.0.1:18505**, started 2026-09-26T18:29:31Z. Earlier isolated daemon 5948 was verified and stopped for the paired-package reload. Ownership record: `<root>/data/sessiond-owner.json`.
- Process commands/timestamps/log paths: `<root>/processes.json`. Configuration and sanitized launch environment: `<root>/setup.json` and `<root>/config.json`.
- Each process ran a published package `bin` (`pi-web-server`, `pi-web-sessiond`) via Node; no private host imports/routes or source patches. Host version 1.202609.1 is the pinned repository devDependency.
- Independent `data/`, `agent/`, `sessions/`, home/config directories and `workspace/`. Environment constructed from a small OS/path allowlist, not inherited PI_WEB_* or credential variables. Offline flags on; spawning/subsessions disabled. Empty model-auth profile. Host automatically installed its bundled Relay resources into this isolated profile only; no relay/delegation was invoked.
- Plugin installed from `<root>/installation/package`, an extracted npm tarball snapshot. It does not follow edits/builds in the source checkout. `pi install <absolute-package-path>` ran only with the isolated agent profile.

**Retained files:** No deletion or automatic relaunch was requested. `processes.json` and the owner record retain historical identities; do not act on those PIDs or rerun checkpoint scripts blindly, as PIDs may be reused. Do not use unqualified `pi-web stop/restart` or touch the hosting daemon at port 8505. Preserve or remove the synthetic temp root only as requested.

## LAN rebind and correction

- During the LAN test, web/API listened only on the requested WLAN address; the daemon remained on loopback. No firewall, certificate, browser security settings or normal-host changes. Only trusted-network use is appropriate; the isolated profile is not a filesystem/process sandbox.
- Initial `lan-check.mjs` failed during Library construction because this package used secure-context-only `crypto.randomUUID`. Initial attribution to the host was incorrect; browser stacks localized the error to `workbenchId`. `lan-check-failed.json` preserves the failed observation (its host-blaming reason is superseded), and `lan-failure.png` captures the symptom.
- Changed `src/browser/workbenchClient.ts` to use 16 cryptographic random bytes and retain the prefix/32-hex format; Discover saved searches now share it. Added seven helper cases, one saved-query interaction regression and `.changeset/lan-http-identifiers.md`.
- Targeted tests: 23 passed. `npm run verify`: 289 tests / 23 files, distribution 234 files / 10,923,587 bytes and tarball 244 entries / 11,056,575 unpacked bytes. An initial matcher lint failure was fixed, not counted as a pass.
- Installed snapshot is the updated tarball. Original package retained at `<root>/installation-before-lan-update/package`; new pack metadata/validation at `<root>/installation/{pack,validation}.json`. All runtime files except `dist/browser/pi-web-plugin.js` were byte-identical. Both isolated processes restarted from outside their daemon after verifying commands, exact process creation times, listener ownership and absence of child work. `processes-before-lan-update.json` preserves previous identities. No existing normal-host process was stopped.
- `node <root>/lan-check.mjs` now passes in real Edge with `isSecureContext=false`, no `randomUUID`, native `getRandomValues` and no browser shims. Library, PDF rendering, an unsaved new reference, local discovery and a saved recipe passed. Evidence: `lan-check.json`, `lan-library.png`, `lan-discovery.png`. Original synthetic reference/evidence/manuscript retained, one saved search, zero tasks. Source PDF unchanged.
- HTTP/listener checks and browser test used this machine's WLAN address. Second-device/firewall reachability is not verified. The original loopback URL is no longer the active web listener. The one-off scripts are checkpoint-specific, not safe to rerun blindly with their old expected PIDs/catalog assumptions.

## Initial loopback evidence

- Build/pack passed: `npm run build`, `npm pack --ignore-scripts --pack-destination <root> --json`; tested tarball 244 entries / 11,053,704 unpacked bytes. Safe extraction checked contained regular entries and host limits.
- Local Pi package install passed. Cold startup logs confirmed `research-library` activation; web HTTP 200.
- Real Edge 153.0.4234.48 / Node 24.19.0 test driven by `<root>/host-check.mjs`; machine-readable results `<root>/host-check.json`.
- Setup used ordinary Actions → Add Project and plugin UI controls, not invented API calls. Actual Library/Discover panels, save/attachment, 12,583,523-byte PDF through host peers, real canvas/worker and text-index worker/search, region evidence/reload/backlink/reader reload, model preview/cancel, manuscript/citation audit/HTML download, file preview/cancel and local discovery/graph all passed.
- One synthetic reference, one evidence note, one manuscript; **zero tasks and zero sessions**. Source PDF unchanged, file-apply target never created, no model calls or external scholarly requests. Browser restricted to test origin; zero blocked origins, failed requests or page errors. Both process logs had no warning/error entries.
- Screenshots: `<root>/library-empty.png`, `library-reader.png`, `discover-loaded.png`; HTML export `synthetic-manuscript.html`.
- Initial inline preparation hit a shell-escaping SyntaxError before install/start; the file-backed `prepare.mjs` succeeded. This was a setup-script error, not plugin success or a host defect.

The initial loopback test needed no production changes; the later LAN test required the browser-only correction above. The normal host remained untouched. Live provider execution, hosted result delivery, managed-service upgrades and remote federation remain unverified; do not present the synthetic-adapter result tests as real-provider evidence.
