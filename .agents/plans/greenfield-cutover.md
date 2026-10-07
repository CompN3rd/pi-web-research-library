# Greenfield cutover checkpoint

Operator request: migrate and clean this project as greenfield. Execution is direct; no new delegation, commits, staging, release, host installation/restart or research-data deletion is authorized.

## Preservation

- Checkout: `C:/Users/Wizar/Documents/projects/pi-web-research-library`, branch `main`, original HEAD `c4b7ed0180ee4e04990cb8343110bffc861b7980`.
- Before cleanup, backed up 149 tracked/untracked files, binary tracked/staged patches and status to `C:/Users/Wizar/AppData/Local/Temp/research-library-greenfield-XHRVEm`. This includes the pre-existing uncommitted question-conversation work being superseded by the operator's greenfield request.
- Obsolete ignored `.host-package/pi-web.tgz` and old legacy/failure smoke screenshots were moved into the same checkpoint's `obsolete-build-artifacts/`; the bootstrap ignore entry and current setup reference were removed.
- `.pi-web/`, `raw/` and `Thesis/` are absent here. No external workspace or live host was searched or modified; no research-data migration was needed/performed.
- Previous implementation contracts/checkpoints are archived under `.agents/archive/`. Completed coordinator scripts and contradictory pending release notes were removed after backup. Do not resume the old workflows. Historical verification is in `docs/history/pre-greenfield-verification.md`; comparative research is preserved.

## Implementation

- Only Library + Discover, one catalog; remove pilot/synthetic loaders, annotation/question service/store, legacy tools and demo asset.
- Preserve attachment range transport, rendering, marking, notebook, explicit task/result/acceptance and writing boundaries.
- Decouple PDF geometry into `src/domain/pdf.ts`; quote capture into `src/browser/pdfQuote.ts`; catalog-only `PdfPeerSource` and `PdfReaders`.
- Standalone synthetic PDF fixture; port native integration/PDF tests; new registration/retired-operation/no-mutation regressions.
- Compiled browser smoke now drives native-only metadata conflict, evidence/reload, research/writing and discovery. Package checks reject retired runtime strings/demo and require exactly six companion tools.
- Docs and AGENTS describe greenfield behavior. Old data, if found elsewhere, needs separately scoped backed-up conversion; no compatibility loader or converter is retained.

## Checks

- `npm run typecheck && npm run lint && npm test`: passed, 281 tests / 23 files.
- `npm run verify`: passed, 281 tests / 23 files, typecheck/lint/build, distribution validation and extracted-tarball storage/codec/CSL/PDF-worker execution. Distribution 234 files / 10,923,524 bytes; package 244 entries / approximately 10.5MiB unpacked.
- `RESEARCH_BROWSER_CHANNEL=msedge npm run smoke:browser`: passed, Edge 153.0.4234.48, 12,583,518-byte PDF and 147 range requests bounded to 256KiB. Native-only end-to-end flow, real rendering/indexing and synthetic hosted result protocol; no live daemon/provider/network calls.
- `git diff --check`, Changeset status, empty staged diff, 34 local doc links/anchors, one JSON example and 60 untracked-file whitespace checks passed; 42 research source definitions unchanged.
- Direct review compared the checkpoint with root; only intended greenfield code/docs/test/build removals, ports and cleanup changed. Catalog/research/writing implementations beyond shared geometry/routing/description are unchanged; unrelated pre-existing changes preserved. No independent cleanup review was requested or claimed.
- Early typecheck found stale test imports/scope fields; ported. One boundary test exposed the old default fixture's missing EOF marker; fixed admission-only fixture. Documentation checking found historical source links to removed modules; converted those to explicitly historical paths without changing source definitions. Do not count those intermediate runs as passes.

Implementation and cleanup are complete. Current authoritative evidence is `docs/verification.md`. Independent review from the earlier implementation does not certify this cleanup. No active workflow remains; deployment, migration of another workspace or release requires a new request.
