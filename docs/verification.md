# Verification evidence

## Local checks

Development used Windows, Node 24.19.0, and the source-built host artifact shared with the sibling Automations migration, targeting upstream `60a29acbfc710908e73b0df9857cb63b53b672d3` (public API v4/v3). No live host files, settings, research data or session daemon were modified.

`npm run verify` passed after review remediation: **166 tests in 26 files**, typechecking, lint, build, public-import/asset validation and real-tarball validation. The package had 215 packed entries and about 5.53 MB of unpacked content, below the host's 16 MiB limit. `RESEARCH_BROWSER_CHANNEL=msedge npm run smoke:browser` also passed after those fixes. The direct review/remediation loop and follow-up inspection completed with no remaining actionable findings. This was parent review, not an independent third-party audit.

The initial review found and fixed mismatched read/write treatment of symlinked annotation directories, noncanonical annotation dates, admitted PDF reader cleanup on setup failures, late annotation-write UI updates after A-to-B-to-A navigation, and stale UI wording about companion tools/PDF verification. Follow-up review also guarded delayed synthetic prompt insertion after workspace changes, rejected ambiguous active/recovery deletion records, and tracked in-flight PDF closes during disposal. Regression tests cover the affected behavior. Development instructions keep the host build outside an installed plugin checkout so ignored host files cannot exceed discovery limits. The companion's filter schemas now use native `StringEnum` for provider-compatible string enums.

A real Microsoft Edge 153.0.4234.48 smoke run passed against the compiled package and an isolated loopback test transport adapter:

- Nested `/nested/` module and PDF asset loading.
- Actual PDF.js worker/canvas text rendering of an authored 12 MiB PDF.
- Mouse-driven region selection and annotation creation.
- Annotation persistence after browser reload.
- Stale two-tab edits rejected without overwriting the accepted revision.
- All observed server PDF range requests bounded to 256 KiB.

The first browser evaluation exposed a real adapter defect: PDF.js requires one callback for each coalesced requested range, not one callback per underlying transport chunk. The adapter now accumulates that serial browser range (bounded by document size) while preserving 256 KiB server transfers, then responds once. Unit coverage and the browser rerun cover this correction. Initial harness setup and exact error-text assertions also needed correction; those failed runs are not treated as passing.

`npm audit` and `npm audit --omit=dev` reported zero vulnerabilities after upgrading the direct esbuild development dependency to 0.28.2. The prior development-only esbuild advisory is no longer present. This is point-in-time dependency evidence, not a security guarantee.

## Not established

The browser smoke uses the public plugin interfaces with a **test authority/transport adapter**, not a real session daemon. It does not establish full host catalog discovery, native service install/restart, the user's provider/extension profile, remote federation, or a registry PI WEB version range. No paid provider calls, automatic answering, production state migration or npm publishing were tested or performed.

Unit and distribution checks exercise the native Pi extension loader for both source and compiled companion entries, plus filesystem compatibility. An installed live session's companion discovery still needs an operator-controlled smoke during cutover. Cross-process concurrent writers, hostile same-account filesystem mutation and power-loss durability are outside the claimed storage contract. The CI matrix is configured for Linux/Windows and Node 22.19/24; do not infer that remote CI passed from local results.
