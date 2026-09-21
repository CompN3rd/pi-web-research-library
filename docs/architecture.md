# Architecture and bounds

One package declares a machine-specific browser/server pair and one native Pi companion. The browser uses API v4 and the server uses API v3. There is no workspace provider, scheduler, session creation, private host route, or runtime host import. The package is independent of Automations; it shares its upstream-contract/distribution approach, not its runtime.

- `src/browser/`: custom elements, source cache, annotation client and PDF.js range adapter. All browser assets are bundled inside `dist/browser/`. Files outside that root must not be served.
- `src/domain/`: pure pilot/synthetic schemas, annotations and protocol primitives. Browser and server validate independently; client validation is not authority.
- `src/server/`: host-scoped annotation repository and bounded PDF snapshots. The host provides the workspace path; peer input cannot supply project/root authority.
- `src/companion/`: bounded local filesystem read tools and historical synthetic-only protocol. This entry runs in ordinary Pi sessions without a web backend.
- `src/server-plugin.ts`: lifecycle and strict, versioned peer operation dispatch. It needs no host session capability for the current read/mark workflow.

## PDF boundary

`pdf.open` resolves a manifest paper and verifies the local PDF's signature, declared size and SHA-256 while copying it to a plugin-owned disk snapshot. The PDF must be a regular file beneath the workspace's permitted PDF subtree; symlink traversal is rejected. The daemon hashes/copies in 256 KiB pieces. A changed source or digest mismatch rejects the open and removes its partial snapshot. An admitted snapshot remains the verified revision even if the source changes later.

Readers are opaque random identities scoped to the host's project/workspace/path tuple. The server admits at most four active or pending readers, each at most 128 MiB. It bounds ranges to 256 KiB, allows at most two active reads per reader, and expires idle readers after two minutes. The supplied `dataDirectory/pdf-cache/` is reconstructible cache, not the annotation store. Lifetime cancellation stops ingress and copying; disposal closes snapshots, and startup clears crash leftovers. OS/filesystem errors remain visible in request errors or server logs.

The browser requests ranges through JSON peers with base64 payloads; it never builds a private PDF URL. PDF.js can coalesce a range larger than one transport chunk. The adapter fetches its 256 KiB pieces serially, accumulates **one browser range buffer up to the document's 128 MiB cap**, then delivers exactly one PDF.js callback for that range. It permits at most 16 queued PDF.js ranges. PDF.js itself retains document/rendering data, so this is not a 256 KiB browser-memory promise. Canvas limits remain 16 million pixels and 16,384 pixels per dimension, with device scale capped at 2. Documents with large decoded resources can still be expensive; only trusted local PDFs should be opened.

PDF assets (worker, CMaps, standard fonts, WASM and ICC profiles) are module-relative and shipped with their licenses. The generic host download URL is only an explicit fallback. `files.pdfPreviewUrl` and the fork's PDF routes are not used.

## Mutation boundary

Annotations remain workspace JSON compatible with the pilot companion. Mutations are queued per canonical workspace/paper, including the read/compare/publish window. The repository bounds pending operations at 64 and active annotation files at 500 per paper. Listings use 20-record pages; they are refreshable views, not a transactionally frozen multi-page snapshot.

Create uses a flushed temporary file and exclusive hard-link publication. Update compares the complete expected record and atomically renames a flushed replacement. Delete compares the expected record and atomically renames it to a retained `.deleted` file. Exact create/update replays return the existing result; deleted IDs cannot be recreated. Temporary publication files are removed on handled failures. A process crash may leave an ignored `.tmp` file; it is not a committed annotation. Recovery files and external edits are operator-owned and are not garbage-collected silently.

These guarantees cover cooperating plugin operations in one daemon on filesystems supporting the required primitives. No cross-process mutation fencing or power-loss transaction guarantee is claimed. Local account peers/tools can modify files; plugins and Pi extensions are trusted code, not sandboxes.

## Future agent actions

An explicit ask/answer workflow can later use upstream `pi-sessions@1` and `pi-session-events@1` plus a correlated companion protocol. That would require user disclosure, admission/result acknowledgement, settlement tracking and draft acceptance semantics. Published conversations belong to the user; disposing a plugin is not permission to stop them. None of that automated answering behavior is enabled by this release candidate.
