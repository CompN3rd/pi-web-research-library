# Archived native workbench integration notes

Historical pre-greenfield evidence only; all workflows below are completed. Their coordinator scripts were removed after checkpointing during greenfield cleanup. The earlier independent review does not cover that later cleanup. Current status is in `docs/verification.md` and `.agents/plans/greenfield-cutover.md`.

## Final checkpoint — implementation and review complete

Workflow `d8debeac-6fe0-474e-99a9-811f047116fb` completed successfully with nine children. Two root remediation passes fixed ten integrated findings; both final independent reviewers returned `{"verdict":"ok","findings":[]}`:

- Data/storage reviewer: `9a3996ae-631e-441a-aba3-814ce15b8275`, artifact `final/review-0-2.md`.
- Workflow/UI reviewer: `36676876-245a-47f1-9e44-59dd5b0dd3ef`, artifact `final/review-1-2.md`.
- Sole root remediation writer, latest continuation: `20c7ea01-60fa-4195-a9af-85cc40e19db2`, artifact `final/remediation-1.md`; first pass `bc004d20-fccf-450c-8486-7c3d47ac94ca`, artifact `final/remediation-0.md`.
- Artifacts are under the session's `subagent-artifacts/outputs/d8debeac-6fe0-474e-99a9-811f047116fb/` directory.

Final worker evidence: **428 tests in 43 files**, full verify, extracted-package execution, Edge smoke with302 bounded ranges, no staged files. Runtime distribution **235 files / 11,186,034 bytes**. Parent compared the integration checkpoint against the final source: only the 18 expected native source/test files and `docs/usage.md` changed, plus two new native patch Changesets; unrelated pre-existing tracked/untracked content was preserved. Parent only updates this checkpoint and `docs/verification.md` after review; no post-review production changes.

Fixes: manuscript/collection decoder limits; frozen evidence ownership; repeated attachment hashes; CSL boolean name flags; saved-query disclosure reset; rejecting evidence-stranding merges; explicit stale-task unlinking; first-citation Vancouver order; evidence-query preflight. The merge guard does not migrate/repair older merged records. Final evidence and residual deployment/provider/platform limitations are in `docs/verification.md`. No root commit, version bump, publishing, live-host changes/restart, or real research data. Review is agent-assisted, not a security/legal certification.

## Integration checkpoint (before final review)

- All 28 exclusive component files were copied into root after final component verdicts `ok`. Parent contracts/entrypoints and legacy/pre-existing changes were not overwritten from snapshots.
- Recovery workflow `95b34fe3-bac2-4bde-809f-837c48f1702b` then failed at coordinator report serialization only: `emit.components[0].outputPathMapping must be a JSON value; received undefined`. All 10 children completed; no failed review was treated as approval. A second complete parent/clone checkpoint is under the clone base `review-coordinator-checkpoint/`.
- Same-protocol continuation **`d8debeac-6fe0-474e-99a9-811f047116fb`** uses `.agents/plans/native-library-final-review-workflow.js`. JSON-safe optional metadata was simulated locally before launching. The integration delegate is **`caaf3bb1-3bee-4888-825c-eb0c614d39e5`**. Its contact requests have fixed timeouts and are renewed; use the latest actual pending request, not an expired id. It must receive exact **INTEGRATION READY** plus evidence before final root reviewers run.
- Parent fixes: workspace path is part of native UI authority; latest same-authority peer/file wrappers are rebound without wiping drafts, and missing→available peer transitions recover. Discovery likewise does not confuse wrapper identity with authority. Text query max300, explicit derivative rebuild, 1MiB UTF-8 import preflight, explicit accessible select names, actual viewer source typing and ready-event constant are integrated and regression-tested.
- `npm run verify` passed: **409 tests / 43 files**, typecheck/lint/build, native tool discovery, distribution **235 files / 11,183,765 bytes**, real tarball **244 entries / approximately10.8MiB**, extracted execution without repo devDependencies (actual store, codec/CSL and PDF worker; network forbidden).
- `RESEARCH_BROWSER_CHANNEL=msedge npm run smoke:browser` passed on **153.0.4234.48**, **302 bounded range requests**, actual compiled native UI → PDF/index → anchored evidence → compiled companion result tool and durable ack → fake completion → human acceptance → CSL audit/export → preview/consented application/preserved backup. Discovery only local. Existing pilot/source PDF unchanged. Test adapters are NOT daemon/provider integration.
- Browser failures corrected before passing: select option text affected exact label lookup; four-reader capacity was exhausted by prior rapid-navigation scenario readers, now explicitly closed through the public operation between scenarios. Two-minute expiry remains the production fallback, not guaranteed unload cleanup.
- Artifact licensing discovery: citeproc-js is **CPAL-1.0** (chosen option), not MIT. It is now copied byte-identically into `dist/vendor/citeproc.cjs` and a browserRoot source download; full pinned CPAL/source provenance is under `third-party/citeproc/`, copied into distribution. All three panels display the required Frank Bennett/CSL attribution plus local source/license links. Citation.js helper packages omit license files; their declarations/author metadata and parent MIT notice are retained explicitly. No legal certification or release authorization is claimed.
- New verification scripts: `scripts/smoke-native.mjs`, `smoke-native-host.mjs` (compiled companion, no model), `smoke-packed.mjs`, `synthetic-pdf.mjs`. `validate-pack.mjs` safely extracts and runs the actual artifact outside dependencies. `validate-dist.mjs` checks tools, notices, byte-identical engine and static import/require boundaries.
- `docs/verification.md` now distinguishes current native integration from historical187-test results and lists unverified daemon/provider/services/platform/OCR/Word/Docs/sync paths. Final independent integrated review remains pending.
- After readiness reply, parent stops ALL writes until final independent review/remediation workflow completes. Remediation child becomes sole root writer; reviewers must not run build/verify/smoke concurrently because they regenerate shared artifacts.

The earlier checkpoint below is historical context, not the current integration state.

Operator task: native replacement inside standalone PI WEB plugin; use workers/review/remediation, not vendor reference-manager connectors or a first-slice stop. Preserve dirty main and pilot/synthetic data. No main commits, host changes/restarts, publishing or real research data.

## Worktrees / orchestration

- Main: `C:/Users/Wizar/Documents/projects/pi-web-research-library`, branch `main`, HEAD `c4b7ed0180ee4e04990cb8343110bffc861b7980` plus substantial pre-existing changes.
- Isolated clones: `C:/Users/Wizar/AppData/Local/Temp/pi-research-native-qlrUpi/{catalog,research,writing,ui}`, branch `master`, snapshot HEAD `d8ab45f2dfb66283ecf3ff1bbec27ca8c4262514`. Shared node_modules junction; never overwrite manifests or shared/legacy files from these snapshots.
- Initial workflow `8d59b657-2ffe-4530-9606-9a0a18b65754` stopped after read-only `outputSchema` + `outputMode:file-only` output persistence failures. Actual findings were recovered but not treated as approval. Parent + all clone diffs/untracked files captured at `.../review-infra-checkpoint/state.json` and sibling directories.
- Same-protocol retry workflow **`95b34fe3-bac2-4bde-809f-837c48f1702b`**, mission `3b1182f4-25d9-4bed-a765-3fdad5509fcb`, uses `.agents/plans/native-library-review-workflow.js` with inline structured reviewer output and fail-closed result checks. It resumes known reviewers/writers, fixes findings and rechecks. Writing reviewer fallback is explicitly labeled: stopped reviewer resume was rejected.
- It will issue a **contact_supervisor integration gate**. Parent must integrate only exclusive new lane files, finish its work, run complete verify/browser smoke and then reply **INTEGRATION READY** with evidence. After that reply, parent must not write while root reviewers/remediation worker operate.
- No polling or bg_wait for these native runs. Notifications arrive automatically. Do not start another execution workflow unless recovering a documented blocker.

## Current parent-owned additions

- Shared `src/domain/workbench.ts`: frozen native contracts; CRLF-safe scalar validation; 25-record/192KiB framed pagination. Per-entity190KiB/result128KiB/full-state16MiB agreed and enforced by catalog validators.
- `src/server/workbenchText.ts`, `src/pdf-text-worker.ts`: bounded source-verified local unpdf text indexing, checksummed version/source-bound indexes, page retrieval/search, isolated worker cancellation; no OCR. `src/server/workbenchText.test.ts`.
- `src/server/discovery.ts`, `src/domain/discovery.ts`, `src/browser/discoveryElement.ts` and tests: optional consented public Crossref/OpenAlex metadata, local graph/saved queries, selected-only provenance imports. No vendor connector/auth or automatic downloads.
- `src/server/workbenchRoutes.ts` and entrypoint edits wire native services and public session-events capability. `src/nativeWorkbench.test.ts` is an as-yet-unrun real-store/codec/result-bridge integration test with fake host execution/events.
- Viewer/range changes preserve legacy and add native `{peer,openOperation:'library.pdf.open',openPayload:{referenceId,documentId},expectedSha256}` plus `research-pdf-ready` after successful current-source rendering.
- Build bundles implementation dependencies plus worker, retains dependency licenses; validate-dist AST walker made iterative for deeply nested bundled PDF parser. Exact unpdf1.8.1 added, Citation.js0.9.0 already added. No version bump.
- README/usage/architecture/development/NOTICE and research-proposal supersession note updated; `.changeset/native-research-workbench.md` added. Verification evidence still needs current final results.

## Integration follow-ups

1. Wait for reviewed component handoff before copying its exclusive new files; all lane report paths are under session `subagent-artifacts/outputs/8d59.../<lane>/implementation.md`, and remediation/review artifacts under `.../95b34...`.
2. Native entry/routes currently import absent lane modules, deliberately pending integration; do not claim the current combined tree typechecks/builds yet.
3. Run `npm run typecheck`, lint, all tests and fix integration failures. `src/nativeWorkbench.test.ts` may need response-shape adjustments against actual services, not weakening behavior assertions.
4. Inspect native UI context identity: `contextKey` currently omits `workspace.path`, and same-key setter updates binding without refreshing the WorkbenchClient's stored context/peer. Include path in authority and refresh current peer safely without relying on peer object identity stability. Add regression for path change/late replies and peer becoming available in same authority. Parent integration-only fix, then final reviewers inspect it.
5. Align UI metadata/full-text query maxima with server (`library.text.search` max300, native tool max200); UI currently max1000 for text search. Prefer clear scope/index labels; selected unindexed attachments now fail visibly rather than imply complete no-hit search.
6. `scripts/smoke-browser.mjs` must select legacy panel by stable ID (new native panel is first), supply public session-events fake, and add real native catalog → attach → index → evidence → explicit task/actual companion result bridge → acceptance → manuscript/audit/export/apply flow. Use only synthetic fixture + loopback test adapter, never real host/provider. Fake host model completion must wait for durable synthetic result publication; no private transcripts.
7. Strengthen artifact checks to require worker/licenses/native tools and exercise packed server outside repo dependencies if practical. Complete real package and browser runs. Native actual compiled PDF worker was already probed successfully with a synthetic PDF (Node inline probe, no host).
8. Update docs/verification.md with exact final counts/commands, failed/fixed checks and unverified real-daemon/provider/discovery/platform paths. Check documentation links, `git diff --check`, package limits/licenses and Changeset status.
9. Reply to integration gate only once full integration is ready. Root final independent review/remediation loop then owns writes; synthesize final evidence honestly, not full commercial-vendor parity claims (OCR/live Word/Docs/cloud collaboration remain excluded and documented).

## Verification already observed (before entry wiring)

- Parent `npm run typecheck` and targeted ESLint passed.
- Seven focused files: 45 tests passed (discovery service/UI, PDF text, range/readers/viewer, shared bounds).
- `npm run build && npm run validate:dist` passed at that stage: 211 files / 8,141,582 bytes (not integrated final artifact).
- Compiled PDF worker extracted `Synthetic native research text` from an authored temp PDF; no external canvas/native binary dependency required.
- Later added checksum regression and integration test have not yet been rerun together with all lanes.
- Review recovery fixed infrastructure only; recovered catalog/UI/writing findings are under active worker remediation, not yet parent-approved.
