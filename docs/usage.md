# Usage and migration

## A local pilot library

The Research panel discovers `raw/_processed/research-library-pilot/library.json` in the selected workspace. This remains the existing bounded pilot format, not a general import/search service. It supports 1–20 papers and PDFs up to 128 MiB each. A minimal manifest has this shape:

```json
{
  "version": 1,
  "pilot": true,
  "libraryId": "pilot-demo",
  "papers": [{
    "id": "pilot-paper",
    "bibkey": "Example2026",
    "title": "Example paper",
    "authors": ["Example author"],
    "sourceNotePath": "Thesis/Citations/Example2026.md",
    "sourceNoteSha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS",
    "relatedTopics": [],
    "metaCategories": [],
    "usedBy": [],
    "pdf": {
      "path": "raw/research-library-pilot/paper.pdf",
      "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS",
      "size": 12345,
      "sourceUrl": "https://example.org/paper.pdf",
      "sourcePageUrl": "https://example.org/paper",
      "retrievedAt": "2026-08-08T12:00:00.000Z",
      "rights": "local-research-copy; redistribution-not-asserted"
    }
  }]
}
```

Replace the digests, byte size, source URLs and retrieval time with the real local document's metadata; placeholders deliberately fail validation. IDs must start with `pilot-`. Store source notes beneath `Thesis/Citations/` and PDFs beneath `raw/research-library-pilot/`, using normalized workspace-relative paths. Unknown fields, oversized files and invalid identities fail closed. The companion reads the same manifest without needing PI WEB running.

The panel displays provenance as **manifest declarations**, not verified URL ownership or redistribution permission. The server hashes a PDF before admitting its reader, compares its actual size and digest, and then serves an immutable local snapshot. It does not fetch the source URL, hash the source note at display time, or infer citation edges from topic/wiki relations.

## Reading and marking

Select a paper, use the page/zoom controls, choose **Mark region**, and drag over the passage. Enter a question or note and save it. Extracted text may be empty for scanned documents; the page rectangle remains the anchor. The reader is a visual canvas preview, not a complete accessible PDF viewer. **Open PDF** uses the host's download helper.

Annotations are stored at `.pi-web/research-library-runtime/annotations/<paperId>/<annotationId>.json`. Their anchor (paper, PDF digest, page, rectangle and quote) is immutable. Editing text or resolving/reopening increments the revision. Stale edits and deletions fail visibly rather than overwrite a newer record. Refresh after a conflict.

A save with an uncertain response retains its original record for **Retry original save**. That retry cannot replace another record. Inspect the refreshed list before cancelling an uncertain save and creating a new one. Edits/deletions are not automatically replayed after a transport failure.

**Delete is recoverable soft deletion:** the server atomically renames the file to `<annotationId>.deleted`. It disappears from the panel and read tools but retains its contents on disk, prevents a delayed create retry from resurrecting it, and can be restored manually with the writer stopped. It is not secure erasure. Include these recovery files in privacy/backup/retention decisions. Do not manually reuse deleted IDs.

Use one active Research Library writer per physical workspace. Server serialization protects cooperating requests within one daemon, not concurrent external file editors, the old fork, another daemon, or arbitrary tools running as your account. Back up records before manual changes. Do not treat local JSON as a tamper-resistant database.

PDF readers expire after two idle minutes to reclaim temporary snapshots. If an unloaded page needs an expired reader, refresh/reopen it. At most four snapshots can be active or opening per server plugin. Closing a browser is best-effort cleanup; abandoned snapshots expire and crash leftovers are removed on plugin startup.

## Pi research tools

Install the **whole Pi package** on the target machine, not just a plugin symlink. The package declares `dist/companion.js`; trust/enable it and use `/reload` in existing idle sessions. `/research-library` reports source/tool availability.

A valid pilot enables:

- `research_library_list_papers`: bounded manifest metadata and annotation counts.
- `research_library_list_annotations`: bounded, filterable annotation summaries.
- `research_library_get_annotation`: one complete validated annotation and paper context.

These tools do not insert prompts, fetch documents, publish answer drafts for real papers, or mark an answer accepted. They still return research content to the agent, which may transmit it to its configured provider. Viewing/marking alone does not call a model. Ordinary Pi tools retain their own account-level permissions; this companion is not a sandbox.

The historical synthetic fixture at `.pi-web/research-library.synthetic.json` and its token/claim/draft tools remain an explicitly synthetic-only demonstration. An example ships as `dist/browser/example.synthetic.json`. If both the synthetic fixture and pilot manifest exist, the integration refuses the ambiguous source. Never put real research into the synthetic flow to bypass this boundary.

## Cut over from the fork

1. Back up the manifest and `.pi-web/research-library-runtime/`, including recovery files. Preserve the originals.
2. When authorized and safe, stop the old research writer. Do not run old and new writers against the same workspace.
3. Use a host built from the [supported source](development.md). Install this built package through **Settings → Pi packages** on the selected target machine. Ensure only one installed plugin owns id `research-library` and only one research companion is enabled.
4. Enable Research Library in **Settings → PI WEB plugins**. From outside hosted work, manually restart the target session daemon, then reload the browser. A restart interrupts active sessions and terminals. Existing idle conversations need `/reload` to load the companion.
5. Confirm the existing papers and annotations are present, then test a new annotation and a read tool before retiring the fork.

No automatic schema conversion, path relocation, daemon restart, plugin enablement or backup migration is performed. Existing pilot JSON paths and identities are retained. Keep research PDFs, notes and runtime records out of Git and npm artifacts.

The plugin is machine-specific. Install it and its companion on each target and use matching gateway/target host versions. Data is not copied or failed over between machines. The implementation uses host-scoped peer/file helpers, but real remote federation remains an unverified deployment path; see [verification](verification.md).
