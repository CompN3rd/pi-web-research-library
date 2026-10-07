---
"@compn3rd/pi-web-research-library": minor
---

Make Library and Discover the sole supported workflows. Remove the old Research panel, pilot/synthetic JSON loaders, annotation/question routes, legacy companion tools and shipped demo asset. Research conversations now use the catalog's explicit tasks and structured-result review flow only.

This is a breaking pre-1.0 cleanup: old workspace files and receipts are left untouched but are no longer opened by this package. No automatic migration or deletion is performed; back up historical records before any separately planned conversion. BibTeX, RIS and CSL-JSON portability remains supported. Synthetic test fixtures remain test-only.
