# Archived Research Library standalone direction

Historical extraction design, not current instructions. The greenfield cutover removed the pilot/synthetic application; consult current `docs/` instead of implementing this old compatibility plan.

> Historical accepted design, preserved from the source fork before extraction.
> Implementation now lives in this standalone repository. `README.md` and
> `docs/{usage,development,architecture,verification}.md` supersede prospective
> status statements below. Do not treat old paths or release notes as current instructions.

## Decision and status

Research Library will be a standalone Pi package, **`@compn3rd/pi-web-research-library`**, with a PI WEB plugin and bundled Pi companion. Its destination is a CompN3rd-owned repository/package, following the distribution model of sibling `pi-web-automations`, **not a feature PR or release of `@jmfederico/pi-web`**.

This is the migration design, not a completed extraction. This checkout currently remains a PI WEB fork at research source commit `c8b15ec4`; its root package, README, release workflow and host code still describe PI WEB. Do not publish or rename that host package as if doing so completed the extraction. No repository, registry release, installation, state migration or daemon restart is performed by this decision.

Reference host: sibling `pi-web-upstream-plugins` at **`60a29acbfc710908e73b0df9857cb63b53b672d3`**, browser API **v4**, server API **v3**. The source package still reports `1.202609.0`, while example compatibility declarations are inconsistent (one names `2.202609.0`). Use the exact source-built host for development; do not infer registry compatibility from those version strings. Select a released host range only after testing the actual released artifact.

## Product scope

The first standalone milestone preserves the useful local pilot:

- Browse manifest papers, source-note provenance and explicitly labeled wiki/context relations.
- Read local PDFs and mark page regions as questions or notes.
- Create, edit, resolve, reopen and delete annotations tied to a paper and declared PDF digest.
- Let ordinary Pi sessions use the existing bounded read tools: `research_library_list_papers`, `research_library_list_annotations`, and `research_library_get_annotation`.
- Keep documents local unless the user deliberately invokes agent work that sends selected content to a model provider.

The historical synthetic token/claim/draft flow is not the production answering architecture. Preserve its fixtures and protocol tests during extraction; any retained runtime support must remain explicitly synthetic-only. Never make real pilot data eligible by relaxing the synthetic parser.

Automated answering, accepted wiki answers, background indexing, fetching papers and scheduling are later product work. Research Library does not depend on Automations, copy its scheduler, or introduce a workspace provider. It operates on workspaces already resolved by PI WEB.

## Package and code boundaries

Proposed package metadata (paths describe the future build):

```json
{
  "name": "@compn3rd/pi-web-research-library",
  "type": "module",
  "files": ["dist", "docs", "README.md", "LICENSE"],
  "piWeb": {
    "plugins": [{
      "id": "research-library",
      "browserRoot": "dist/browser",
      "module": "dist/browser/pi-web-plugin.js",
      "serverModule": "dist/server-plugin.js",
      "machineSpecific": true
    }]
  },
  "pi": { "extensions": ["dist/companion.js"] }
}
```

Keep plugin id `research-library` and existing data identities. Install exactly one owner of that plugin id. The npm scope changes ownership without requiring a research-data rename.

| Layer | Responsibility |
| --- | --- |
| `src/browser/` | Panel, PDF.js adapter, navigation, annotation interaction and scoped peer client |
| `src/server/` | Peer operation validation, workspace-contained file access, bounded PDF reads and annotation persistence |
| `src/companion/` | Pi tool registration and agent-facing adapters; later, optional session-message protocol |
| `src/domain/` | Environment-independent manifest/annotation schemas, limits, identities and transformations |
| `src/server-plugin.ts` / `src/companion.ts` | Thin lifecycle/registration entries |

Browser code imports only the public `@jmfederico/pi-web/plugin-api` types. Server host integration uses only `@jmfederico/pi-web/server-plugin-api`. The companion uses native Pi extension APIs. No imports from host `src/**`, `dist/**`, unstable APIs, private HTTP routes, or Pi CLI subprocesses.

Share pure validation where appropriate, but validate independently at each trust boundary. Sharing a parser does not make browser input authoritative. Keep Node filesystem/crypto imports out of the browser dependency graph.

Build and ship PDF.js and its worker inside `dist/browser/`, addressed relative to the module. Include their license and any required rendering assets. Do not serve the server entry, companion, source documents, configuration or runtime state from `browserRoot`. Check the complete package against the host's 4,096-entry / 16 MiB discovery limits; do not copy the entire PDF.js distribution without measuring it.

## What changes relative to this fork

| Current dependency | Standalone treatment |
| --- | --- |
| Browser `apiVersion: 1` | Port to v4 lifecycle and contexts, including invalidation and teardown |
| Fork-only `files.pdfPreviewUrl` | Replace with a package-owned bounded PDF transport, below |
| Host PDF routes, remote-proxy changes and URL helpers | Do not extract; selected-machine peer transport replaces them |
| Browser annotation read/check/write | Move mutations to one server-owned repository with revision checks inside the write boundary |
| Host create-only write patch | Do not assume upstream generic writes provide atomic publication; own required guarantees in the package |
| Raw `extensions/research-library.ts` | Build as the package's explicitly declared Pi companion |
| Host-wide plugin build and PDF.js copying | Replace with package-local build and distribution checks |
| `dev:research-pilot` spawning the fork | Replace with external-host development instructions and an isolated smoke harness |
| PI WEB CLI, services, bundled plugins, website and release machinery | Remain host responsibilities; not part of the new distribution |

### PDF transport is a real migration requirement

The pinned upstream contract exposes `files.previewUrl(path, { version })`, `downloadUrl`, and `maxInlinePreviewBytes`, but not `pdfPreviewUrl`. Its generic inline preview is capped at 10 MiB and does not reproduce this fork's range endpoint. The pilot accepts PDFs up to 128 MiB. Renaming the helper, fetching a whole download into browser memory, or adding a private route would not preserve the existing bounded-reader behavior.

Recommended implementation: a PDF.js range adapter backed by **bounded `peer.request` operations**. Browser requests identify a manifest paper and digest, not an arbitrary filesystem path. The host supplies machine/workspace scope to the server. Use a small versioned protocol such as metadata/open, range-read and close; return base64 chunks because peers transport JSON, not binary HTTP responses.

Start with a conservative chunk size (for example 256 KiB decoded) and a small concurrency limit. Bound document size, integer offsets, response size, outstanding requests, active readers and idle lifetime. Forward abort signals, release readers on panel changes and plugin shutdown, and expire abandoned handles server-side because browser cleanup is not guaranteed. Scope every handle to the host-resolved workspace, paper and source revision. Reject stale handles and changed sources rather than mixing PDF versions.

Open only validated regular files within the permitted workspace subtree. Resolve containment and reject symlink escapes; never use a client-provided root as authority. Read from the validated descriptor or a plugin-owned immutable snapshot. If digest verification/snapshotting is required, bound its work and make verification status explicit. A manifest digest remains a declaration until bytes have actually been checked; a filename, size or mtime check is not digest verification.

The range adapter's correctness and performance, especially on federated machines, are an implementation gate—not a verified capability today. If it cannot meet the bounds, report the blocker instead of quietly lowering document support or requesting a host fork. A host-provided download link can remain an explicit fallback, not proof that the integrated reader works.

### Durable data and concurrent edits

Keep the initial workspace data layout compatible:

- Pilot manifest: `raw/_processed/research-library-pilot/library.json`.
- Local PDFs: manifest-declared paths beneath `raw/research-library-pilot/`.
- Source notes: manifest-declared paths beneath `Thesis/Citations/`.
- Annotations: `.pi-web/research-library-runtime/annotations/<paperId>/`.

This preserves the companion's local read tools and avoids an unnecessary database migration. Continue keeping private research material and runtime records out of Git and the npm artifact. A future general library configuration may use one plugin-owned `.pi-web/research-library.json`, but introducing it requires an explicit schema/import step, not silently reinterpreting the pilot manifest.

The server becomes the sole application writer for pilot annotations. The browser sends semantic create/update/delete requests with expected revisions; it does not overwrite record files directly. Serialize mutations per record, compare revisions inside that critical section, publish complete records atomically, and guard deletion too. Create-only operations must never replace an existing record. A retried request with an uncertain response must be reconcilable by a stable identity/idempotency rule rather than creating duplicate annotations.

A per-daemon queue protects cooperating requests, not external editors or a second daemon writing the same workspace. Require one active writer owner during cutover; document this boundary rather than claiming filesystem-wide compare-and-swap. Test interrupted publication and temporary-file cleanup. Preserve malformed/foreign records for diagnosis instead of rewriting them automatically.

Use the server's supplied `dataDirectory` only for plugin-owned machine-local caches or later job state, partitioned by workspace identity as needed. It is shared across the plugin's projects. Do not copy PDFs or relocate annotations there merely because the contract supplies a directory. Standalone Pi sessions must still be able to read workspace research without a running web backend.

### Agent work, when added

The first milestone needs no session-creation capability: ordinary user sessions already invoke the read-only companion tools. Installing a PI WEB plugin alone must not be mistaken for loading its companion.

For a later explicit “Ask about this annotation” action, follow upstream's native session model:

1. Gather explicit user intent and a bounded, digest-bound annotation context.
2. Use declared `pi-sessions@1` / `pi-session-events@1` capabilities when creating and messaging a hosted conversation; resolve saved workspace IDs with `workspaces@1` when operating outside a current peer request.
3. Subscribe before sending and require a correlated companion acknowledgement. A successful `emit` is neither delivery proof nor task completion.
4. Observe settlement, preserve the published session identity, and store an answer as a draft pending user acceptance.

Published sessions belong to the user. Plugin disposal or browser disconnection must not terminate later user work. Cancellation is cooperative; uncertain completion is not success and must not trigger automatic duplicate work. Do not transplant Automations' scheduling/state machine until Research Library actually needs it.

## Extraction sequence and acceptance gates

1. **Establish the standalone repository.** Extract the research browser code, companion/domain code, relevant tests and license provenance from `c8b15ec4`. Do not simply change the root fork's npm name or delete its host tree in place. Preserve this checkout as a reference until extraction is verified. Use CompN3rd repository metadata; establish package-local CI and release policy rather than inheriting PI WEB's CalVer workflows or upstream-targeted Changesets.
2. **Bootstrap against the pinned host.** Follow Automations' source-built tarball approach in an ignored `.host-package/` directory, with a reproducible exact-source bootstrap. No absolute workstation dependency or runtime import through a sibling checkout. The local tarball is a development dependency, not a publishable compatibility range.
3. **Port the browser and companion.** Compile against public v4 declarations and current Pi types. Preserve valid pilot reads and rejection behavior; retain the synthetic/real-content boundary. Keep framework-neutral tests in Node and use per-file happy-dom only for component interaction.
4. **Implement peer-backed PDF access and annotation mutations.** Test malformed operation/input, workspace and paper mismatch, traversal/symlinks, invalid offsets, oversized chunks, source changes, revision races, retries, reader cleanup and failure visibility. Tests must exercise the actual storage adapter, not just mocks of atomic writes.
5. **Validate the artifact.** Typecheck, lint, focused tests, complete package tests, build, public-import audit, and real `npm pack` validation. Ensure the tarball contains both entries, companion and PDF assets, excludes research/private state and host executables, and stays within discovery limits.
6. **Smoke on a separately owned host instance.** Use distinct data directory, daemon endpoint and web port. Exercise actual PDF.js rendering and drag coordinates in a real browser (happy-dom cannot prove them), edits from two tabs, reload persistence, companion discovery, nested URL deployment, and web/API loss without restarting sessiond. Test federation before claiming remote support. Record skipped checks explicitly.
7. **Cut over only after validation.** Back up workspace runtime records, stop the old research writer when authorized, install the built package through target-machine Pi package management, enable the plugin and load the companion. Server activation requires a manual session-daemon restart when safe, outside hosted work, then a browser reload. Do not restart the live host as part of extraction. Test the real workspace before retiring the fork; retain backups and avoid simultaneous old/new writers.

No Changeset for `@jmfederico/pi-web` is warranted by this internal design document. User-visible implementation/release notes belong to the new package once its identity and release tooling exist. Nothing in this plan authorizes publishing either package.

## Inspected references

- Upstream [plugin guide](https://github.com/jmfederico/pi-web/blob/60a29acbfc710908e73b0df9857cb63b53b672d3/docs/plugins.md), [browser contract](https://github.com/jmfederico/pi-web/blob/60a29acbfc710908e73b0df9857cb63b53b672d3/src/plugin-api.ts), and [server contract](https://github.com/jmfederico/pi-web/blob/60a29acbfc710908e73b0df9857cb63b53b672d3/src/server-plugin-api.ts).
- Pinned checkout's `examples/workspace-provider-plugin/` packaging and `pi-packages/captains-log/` companion packaging. Copy boundaries, not their inconsistent release ranges.
- Sibling `../pi-web-automations/package.json` and `../pi-web-automations/docs/migration.md` for CompN3rd ownership, source-built host bootstrap and user-owned session constraints.
- This checkout's `pi-web-plugins/research-library/`, `extensions/research-library.ts`, `extensions/research-library-core/`, and host diff from `dbcd19f0` through `c8b15ec4` for extraction inventory.
