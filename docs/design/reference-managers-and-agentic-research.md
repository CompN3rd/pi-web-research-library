# Reference managers and agentic research

**Status:** research and proposed design, not an accepted ADR or implemented feature set.

**Research date:** 2026-09-26.

**Subsequent direction:** the operator chose a **native replacement**, not the connector-first recommendation below. This document preserves the original comparative research and proposal; its repository-current descriptions and delivery recommendations are historical. The implemented native catalog/evidence/research/writing direction, actual limits and verification belong in [usage](../usage.md), [architecture](../architecture.md) and [verification](../verification.md). No reference-manager API or vendor MCP integration was adopted. A subsequent greenfield cleanup removed the pilot/synthetic runtime; source paths in the historical baseline table below are provenance, not links to current modules.

**Repository baseline:** working tree based on `c4b7ed0`, including the in-progress explicit-question-conversation work. This is not a claim about the published package.

**Scope:** what dedicated tools offer; integration into this package's frontend/backend; interaction with agent-assisted literature research and writing.

Current behavior remains documented in [usage](../usage.md), [architecture](../architecture.md), and [development](../development.md). Proposed interfaces, records, tools and phases below are not the implementation contract; consult those current documents rather than assuming every original proposal was adopted.

## Executive recommendation

Build an **interoperable, local-first research workbench**, not another complete Paperpile clone.

1. **Borrow the mature reference-manager workflow:** capture/import, metadata repair, duplicate review, collections, full-text retrieval, reading, notes, and citation export.
2. **Integrate rather than replace:** Paperpile through exports first; Zotero through its documented APIs when a richer connector is needed; Pandoc/Quarto/BibTeX for text-based writing; existing vendor plugins for live Word/Google Docs citations.
3. **Own the evidence-to-writing connection:** immutable source passages, cross-paper comparison, claim/evidence relationships, reviewable agent outputs, and manuscript changes with traceable citations.
4. **Keep model work explicit:** a task describes the corpus, allowed disclosure, intended output, and budget. Reading a paper or refreshing a library must not launch research.
5. **Do not confuse formatting, provenance, or execution with correctness:** a valid DOI is not supporting evidence; a source link is not an entailment check; a completed turn is not an accepted answer.

The most useful first end-to-end demonstration is:

> Select several verified local papers → collect cited passages → request a comparison or related-work draft → inspect every claim beside its source → export Markdown and a bibliography. Keep manuscript application and external-library write-back separate.

In parallel, prove a **read-only Paperpile export bridge** with synthetic fixtures before committing to a general catalog schema. Do not block useful local evidence workflows on a vendor's future API.

## Contents

- [1. Research method and confidence](#1-research-method-and-confidence)
- [2. What dedicated tools offer](#2-what-dedicated-tools-offer)
- [3. Integration choices and limitations](#3-integration-choices-and-limitations)
- [4. This repository today](#4-this-repository-today)
- [5. Proposed frontend](#5-proposed-frontend)
- [6. Proposed backend and data model](#6-proposed-backend-and-data-model)
- [7. Agentic research workflows](#7-agentic-research-workflows)
- [8. Writing and citation integration](#8-writing-and-citation-integration)
- [9. Trust, privacy, and operational boundaries](#9-trust-privacy-and-operational-boundaries)
- [10. Delivery sequence and verification](#10-delivery-sequence-and-verification)
- [11. Decisions to record as ADRs](#11-decisions-to-record-as-adrs)
- [12. Sources and residual research gaps](#12-sources-and-residual-research-gaps)

## 1. Research method and confidence

The research prioritizes vendor help centers, developer documentation, standards/tool documentation, and the repository's source and pinned public host declarations. Search results were used to locate sources; fetched passages underpin the principal recommendations. No paid accounts, authenticated APIs, installed vendor applications, or real research libraries were exercised.

Three different kinds of statement appear below:

- **Documented:** the named source describes the behavior. This is not an independent quality, performance, privacy, or interoperability test.
- **Conditional:** documentation exists, but account entitlement, current client version, API availability, or export fidelity needs a spike.
- **Proposed:** a recommendation for this package, not a vendor feature or existing implementation.

Negative findings are bounded: “no public API verified” does not mean an enterprise or private interface cannot exist. Plan limits and API contracts change; re-check them when implementing. Exact subscription prices are intentionally omitted. Documentation availability is stronger evidence than an indexed marketing snippet, but neither proves a successful integration.

## 2. What dedicated tools offer

### 2.1 Paperpile: the important benchmark is the whole workflow

| Capability | Documented Paperpile behavior | Lesson for this package |
| --- | --- | --- |
| Capture | Browser integrations save references; library workflows connect writing tools and cloud storage. | Begin with identifier/file import and existing exports. A browser capture extension is a separate product and permission surface, not a prerequisite. [P2] |
| Bibliographic library | Multiple reference types; metadata and PDF full-text search; automatic file naming; missing-metadata repair; duplicate merging; journal-name and title cleanup. | A useful library needs metadata-only references, not just PDFs. Repair must preserve provenance and offer a diff. [P1] |
| Organization | Folders and labels; shared-library organization and permissions. | Support project collections and cross-cutting tags without copying the same document into several identities. [P1], [P7] |
| Reading and notes | PDF annotations plus annotation summaries; exports to PDF, text, rich text, Markdown, JSON, and OPML. | Notes must be reusable outside the viewer, with paper identity and source location retained. [P4] |
| Library portability | BibTeX, RIS, CSV, and JSON exports. JSON includes user-editable metadata, attachment descriptions, folders, and labels. | Import/export fidelity matters as much as the visible reference table. The JSON is Paperpile's internal format, not CSL-JSON. [P3] |
| Citation writing | Google Docs and Word integrations; bibliographies, locators, prefixes/suffixes, CSL styles, and document conversion workflows. | Citation identity, rendering, and editor-specific field formats are distinct concerns. [P9], [P10] |
| LaTeX | BibTeX/BibLaTeX configuration, citation keys, and automatic exports to Drive, GitHub, or a downloadable link; Overleaf integration. | A read-only bibliography bridge can deliver value before an API connector. Never let an agent edit an auto-generated upstream bibliography. [P2], [P6], [P11] |
| Collaboration | Shared libraries, Admin/Editor/Viewer roles, shared annotations distinct from personal annotations. | Scope matters: a personal note must not silently become a shared note. This repo does not yet provide equivalent multi-user authorization. [P7] |
| AI assistance | Send selected PDFs and prompts to ChatGPT, Claude, Copilot, Gemini, or NotebookLM; prompt categories include summaries, comparison, extraction, and critique. Responses are encouraged to link back to source PDFs. | Adopt explicit task recipes and evidence navigation, not merely a chat box. Uploading PDFs is a separate disclosure decision. [P5] |

**Important integration constraints, not minor details:**

- Library exports do **not** include PDF bytes; those require a separate download/sync workflow. [P3]
- The internal JSON export cannot currently be re-imported into Paperpile. Do not promise a lossless round trip. [P3]
- Auto-exported BibTeX files are overwritten on the next sync. Paperpile recommends separate files for manually maintained entries; its automatic-export guide also lists a shared-folder limitation. [P6]
- The shared-library guide says direct citation from shared libraries in Word/Docs requires first copying the reference into the personal library, and shared libraries cannot currently sync to Google Drive. Do not assume personal-library integration behavior applies to shared libraries. [P7]
- Ask AI opens the chosen assistant and uploads to the account signed in there. It is not a documented server-side research job API. The help page says automatic saving of AI answers back as notes is not yet available. [P5]
- Both the public REST API and MCP server are marked **Started** on the roadmap; Ask AI explicitly answers the MCP question with “Not yet.” Treat these as future opportunities, not shipped integration dependencies. [P5], [P8]

The opportunity is therefore more substantial than reproducing Paperpile's Ask AI button: retain **structured results, evidence, revisions, and human review** after an agent conversation ends.

### 2.2 Comparable tools: different strengths, not interchangeable products

| Tool/category | Distinctive capability | Most useful integration or design lesson | Evidence/qualification |
| --- | --- | --- | --- |
| **Zotero** | PDF annotations flow into notes with page links and citations; Word, LibreOffice, and Google Docs receive dynamic citations. Web API v3 and a local desktop API are documented. | Best initial candidate for a richer programmable reference-manager connector. Use native item/attachment identities rather than reverse-engineering its database. | Direct documentation. Local behavior is version-dependent. [Z1]–[Z5] |
| **Better BibTeX for Zotero** | Targeted library/collection exports can stay updated. | A useful optional citation-file bridge, not a built-in Zotero guarantee. It does not replace metadata/annotation synchronization. | Third-party plugin's own documentation. Its optional Git feature can commit other already-staged files; do not enable it implicitly. [Z6] |
| **Mendeley** | Integrated reader, highlights, notebook, and private groups; documented OAuth REST resources for documents, files, groups, and annotations. | Notebook-style cross-paper synthesis is worth borrowing. Prefer export ingestion initially unless a user needs a live connector. | Feature guide and developer portal read; registration, current resource coverage, and notebook export/API fidelity untested. Portal contains legacy retirement notices. [M1]–[M3] |
| **EndNote** | EndNote 2025 Research Assistant produces key-point summaries from an attached PDF; the broader product markets citation-writing and research workflows. | A summary belongs to a specific attached source, not just a reference title. Preserve existing citation-manager workflows instead of cloning them first. | Research Assistant manual read. Broader product page blocked during retrieval; no public library API validated. [N1], [N2] |
| **Papers / ReadCube Papers** | Official indexed guides describe SmartCite for Word/Docs, single/multi-paper AI assistance, and figure-oriented AI Vision. | Compare selected documents and bring visual evidence into the same review surface as text. | Lower-confidence secondary benchmark here: indexed official materials found, but PDF extraction was inadequate and feature URLs returned 404. No public API validated. [R1], [R2] |
| **Elicit** | Research workflows covering search, screening, structured extraction, reports, and interactive research sessions; documented REST v2 and OAuth MCP. | Strong example of an evidence table as a first-class output. Optional remote research provider, not the local source of truth. | API docs read; plan, quota, upload, and account access gates remain. MCP is explicitly not feature-identical to REST. [E1] |
| **scite** | Smart Citation context and reference-checking workflows; a documented MCP integration with OAuth. | Add supporting/contrasting citation context and editorial notices as review signals, not truth scores. | MCP page read; API/reference-check pages blocked. Exact tool inventory, entitlements, and citation-label coverage need validation. [S1], [S2] |
| **ResearchRabbit** | Iterative discovery, recommendations, collections, and visual paper/author connections. | A seed-paper exploration queue is useful before a large graph visualization. Bring selected discoveries back as candidates. | Feature and sharing/export guides read. No public API verified. [D1], [D2] |
| **Litmaps** | Citation/reference-based discovery, visual maps, Zotero synchronization, and topic-monitoring email alerts. | Preserve the search/seed/edge provenance behind a recommendation. Monitoring should feed an inbox, not silently expand a writing corpus. | Feature and export guides read. No public API verified. [D3], [D4] |
| **Connected Papers** | Similarity-graph exploration; an official JS client documents graph retrieval and usage accounting. | Optional graph provider; distinguish similarity from actual citation edges. | Official client documents **early-access** API keys. About-page extraction failed; graph semantics need a contract check before implementation. [D5], [D6] |

### 2.3 Three feature layers to keep separate

1. **Reference management:** identity, metadata, attachments, folders, deduplication, synchronization, citation formatting.
2. **Research assistance:** discovery, reading, extraction, comparison, appraisal, contradiction search, and review provenance.
3. **Writing assistance:** claim planning, section drafting, source-grounded revision, citation checking, bibliography generation, and editor handoff.

Most dedicated tools now span several layers. The differentiator for this repo should be the **connections between layers**, especially an inspectable chain from a sentence in a draft to a specific source revision and passage. Citation graphs and multi-PDF chat alone do not provide that chain.

## 3. Integration choices and limitations

### 3.1 Recommended connector strategy

| Integration | First supported direction to design | What it provides | What must not be assumed |
| --- | --- | --- | --- |
| Paperpile BibTeX/RIS | User-selected export → staged local import; optional explicit refresh from an approved export location later | Bibliographic metadata and citation keys where the format preserves them | No PDF bytes, reliable annotation geometry, complete folder semantics, deletions, or write-back protocol |
| Paperpile JSON + annotation JSON | Separate, version-profiled importers; retain bounded original payloads and loss reports | Richer library structure and programmatically processable annotations | Internal JSON is not CSL-JSON; field stability, coordinate conventions, IDs, and round-trip support are not established |
| Zotero Web API v3 | Read-only personal/group library pull first | Stable provider-scoped item identities, collections, attachments, annotations, versioned synchronization | Access to one library does not authorize another; attachment availability and permission must be checked separately |
| Zotero local API | Explicit same-machine connector, version/capability checked | Offline local-library access without scraping SQLite | Browser `localhost` is not necessarily the selected backend machine; never forward the unauthenticated read API publicly |
| Mendeley / EndNote / Papers | Standard file exports first; API spike only for demonstrated demand | Compatibility with existing users and writing tools | No common annotation, note, or live-citation field format across vendors |
| Elicit / scite | Optional, user-authorized external research tools or backend adapters | Discovery, structured review outputs, citation context | Agent credentials, quotas, full-text access, or reliable result import are not supplied by this package today |
| ResearchRabbit / Litmaps | Manual bibliography/result import and links back to the source tool | Selected candidate sets with discovery provenance | No undocumented service scraping; no assumption that export retains graph layout or relation semantics |
| Connected Papers | Evaluate early-access API only if graph retrieval becomes a real requirement | Provider graph results and usage state | Early access is not a stable, generally available production dependency |

#### Paperpile bridge details

Use **two lanes**, not a fragile bidirectional sync:

- **Inbound source lane:** immutable snapshots of exported metadata, separately admitted PDFs, and separately imported notes/annotations.
- **Local research lane:** workspace collections, questions, evidence, agent drafts, and accepted writing artifacts owned by this package.

External metadata changes become proposed changes with field-level provenance. Local research is not overwritten. Removing an item from an export is not proof of deletion: the user may have exported a smaller folder. An imported annotation without verified page/geometry mapping becomes an **unanchored imported note**, not a fabricated rectangle.

A future official API can replace the transport without changing these ownership rules. Do not use authenticated browser cookies, private app endpoints, or automation of the Paperpile UI as the production integration.

#### Zotero bridge details

The documented Web API supplies library/object versions and conditional writes. A connector must retain the provider namespace, remote item key, remote version, and last imported representation. Later write-back would require an explicit three-way conflict policy; last-writer-wins is inappropriate for notes. [Z2]

The current local API documentation describes newer write support gated on Zotero 10+, with locally granted authorization, and local instance/version semantics that differ from the Web API. Start with read-only capability detection rather than assuming all installed Zotero clients behave alike. Explicitly paginate local reads even though the local API can otherwise return all results. [Z3]

Local attachment endpoints may redirect to `file://` paths. Do not follow those through a generic network fetcher or let them bypass workspace containment. Copy through a separately authorized local-file admission workflow into the workspace, then hash and verify normally; otherwise offer manual attachment import. A same-machine integration still needs a deliberate authority boundary.

#### Remote agent-provider bridge details

Prefer one execution owner per operation:

- A **UI-owned provider request** uses a backend adapter for credentials, consent, limits, status, and receipts.
- An **agent-owned provider request** uses an operator-configured native/MCP integration and submits its bounded result/provenance through the research result contract.

Do not silently call both and pay twice. MCP provides a tool transport, not evidence correctness or durable delivery. Do not add a generic MCP client to the browser or assume a host capability for vendor credentials exists.

Elicit's documentation is particularly relevant: creation/message requests are not guaranteed idempotent; timeouts can leave work running; results can include warnings; reports and interactive sessions have different polling/completion semantics; export availability can lag completion. Preserve returned IDs, distinguish unknown admission from failure, and do not retry creation blindly. Its MCP tool set omits some REST upload/artifact/source operations. [E1]

### 3.2 Scholarly infrastructure: integrate data services, not every product

| Source | Proposed role | Limits that matter |
| --- | --- | --- |
| **Crossref** | DOI metadata resolution, metadata repair suggestions, publication/update relationships | Deposited metadata can be incomplete or wrong. Crossref is not every DOI registration agency and does not provide universal full text. Preserve original values and provenance. [I1] |
| **Crossref / Retraction Watch** | Retraction/correction/concern warnings at import and before export | Store the notice relationship, source, and checked-at time. Missing notice data is not proof that a work is valid; update types have different coverage. [I2] |
| **OpenAlex** | Discovery, reference/citation graph data, and selected open-access content lookup | Implement current authentication/budget behavior rather than assuming unlimited free calls. PDF/TEI content availability is separate from metadata. PDFs retain original copyright. [I3], [I4] |
| **Semantic Scholar** | Seed-paper recommendations, graph relationships, metadata enrichment | API keys, throttling, service terms, and corpus coverage must be checked; recommendations are candidates, not evidence of relevance or validity. [I5] |
| **Unpaywall** | Optional DOI-level OA-location lookup | Documentation surfaced in search but readable retrieval failed here. Verify current endpoint/terms before implementation; do not base the first slice on unverified search APIs. [I6] |

Start with **one metadata resolver and one discovery provider**, not simultaneous fan-out to all of them. Keep provider-specific IDs and timestamps so conflicting records are inspectable. A DOI match is a useful identity signal, but preprints, accepted manuscripts, versions of record, corrections, and supplemental files must not be collapsed indiscriminately.

## 4. This repository today

The working tree already has important foundations but is not a general reference manager.

| Area | Current source-backed baseline | Gap to the proposed workbench |
| --- | --- | --- |
| Library | Strict pilot manifest, 1–20 papers; each has a bibkey, metadata, source-note identity, and required PDF. Unknown fields reject. Historical `src/domain/pilot.ts` | No general catalog, metadata-only reference, standard importer, editable metadata UI, or provider connector |
| Reading | PDF.js reader, verified bounded PDF snapshots and range transport, region marks and source provenance. Historical `src/server/pdfReaders.ts` | No indexed full-corpus text, semantic retrieval, OCR pipeline, or structured table/figure extraction |
| Annotations | Question/note, immutable PDF digest/page/rectangle/quote anchor, revisioned edits, recoverable deletion. Historical `src/domain/annotation.ts` | No cross-paper evidence notebook, structured extraction schema, claim graph, or accepted-answer record |
| Agent access | Real-pilot tools list papers/annotations and retrieve one annotation. Historical `src/companion.ts` | No bounded real-paper full-text search/read tool or production draft-submission/acceptance workflow |
| Explicit questions | Saved question → consent → visible Pi conversation; durable replay-protection receipt and initial-turn status. Historical `src/server/questionRuns.ts` | No captured answer text, structured result validation, multi-paper task model, or acceptance into writing |
| Frontend | One Research workspace panel and a separate question component; host-scoped file/peer helpers. Historical `src/browser/pi-web-plugin.ts` | No import inbox, comparison matrix, citation picker, or manuscript review panel |
| Backend | Versioned package peer operations, scoped annotation repository, PDF readers, and question receipts. Historical `src/server-plugin.ts` | No ingestion/extraction/provider jobs or general catalog storage |
| Citation data | Pilot bibkey and declared `usedBy`/topic relations | These are not a parsed manuscript citation index or a verified scholarly citation graph |

Two boundaries are especially important:

- The historical `research_library_search` and answer-draft tools belong to the **synthetic-only** demonstration. Their names are not evidence of real-paper retrieval or publishing support. Do not expand them by quietly relabeling real data as synthetic.
- A source-note hash declared in a manifest is not proof that the note was rehashed or read. Any new extraction/evidence workflow must verify the bytes it actually uses.

The pinned development target is `@jmfederico/pi-web@1.202609.1`, browser v4/server v3. The public `pi-sessions@1` capability supplies visible conversation creation/run and initial completion; `pi-session-events@1` supplies ephemeral session-local messages, **not durable result storage, acknowledgment, replay, or an agent-control API**. No host patches or Automations dependency are needed or proposed.

## 5. Proposed frontend

### 5.1 Information architecture

Keep one workspace-scoped Research entry, with progressive subviews rather than immediately building six independent applications:

1. **Library:** searchable table/list; collection/tag filters; metadata/PDF availability; duplicate and metadata-warning badges.
2. **Reader:** current reader plus annotation/evidence sidebar; neighboring passage context; page and printed-page labels; keyboard-accessible text fallback.
3. **Evidence notebook:** selected excerpts, notes, structured extractions, and claims across papers; every card can show its source.
4. **Tasks and results:** explicit task recipe, corpus/disclosure preview, status, provider/conversation identity, and reviewable output.
5. **Writing:** outline/section draft, bibliography preview, claim/evidence side panel, and export/apply review.
6. **Import inbox/settings:** staged imports, conflicts, missing PDFs, provider status, and scope-specific settings. This can begin as a dialog rather than a new permanent tab.

The paper selection and PDF reader should survive unrelated filtering, receipt refresh, and evidence edits. Persist only intentional drafts; do not expand the existing in-memory annotation draft into accidental browser-only durable storage.

### 5.2 Feature-to-implementation map

All rows are proposals; “early” means high value, not zero effort.

| Feature | Frontend interaction | Backend responsibility | Agent interaction / sequencing |
| --- | --- | --- | --- |
| Standard import | Preview candidates, field losses, duplicates, and attachment matches before confirmation | Bounded parsers, normalization, provenance, staged publication | Agent can recommend matches; cannot silently merge. Early interoperability work |
| Collections, tags, reading queue | Multi-select and filter; explicit unread/reading/read and included/excluded states | Membership and workflow records separate from provider metadata | Scope a task by an immutable selection. Early catalog work |
| Metadata repair | Before/after field diff with source labels | Deterministic identifier lookup and conflict candidates | Agent suggests; resolver and human decide. After import |
| Citation copy/export | Citekey, formatted citation, bibliography, or note bundle | Stable key resolution, formatter adapter, export manifest | Model uses resolved keys, never invents them. Early |
| Full-text retrieval | Search results show document, page, matched text, and availability | Verified extraction, bounded local index and passages | On-demand passage retrieval instead of sending an entire library. Core research foundation |
| Evidence cards | Quote, source location, note, claim links, and review state | Immutable evidence references and revision checks | Tool output is a structured evidence object. Early |
| Structured extraction | Matrix columns such as method, sample, outcome, limitation; cells open evidence | Schema/versioned extraction records, missing/not-reported states | Agent fills proposed cells with evidence per cell; human corrects. After retrieval |
| Multi-paper comparison | Select corpus and comparison axes | Frozen corpus snapshot and task admission | Synthesis across selected evidence, with conflicting/null findings visible |
| Discovery and snowballing | Candidate inbox; reason for recommendation; citation/reference/similarity badges | Provider adapters, query history, provenance, bounded expansion | Agent proposes query/seed expansion; user controls scope. After catalog |
| Claim checking | Draft sentence beside source and critique | Citation resolution, stale-source checks, editorial notices | Agent assesses support and counterevidence; human judges entailment |
| Figures and tables | Region/caption context and extraction preview | Admitted image/table artifacts, document hash and page binding | Optional vision/OCR with explicit disclosure; no fabricated values. Later |
| Writing review | Draft diff; unresolved citations; export/apply confirmation | Immutable draft bundle and expected target revision | Agent proposes changes; user accepts separately. Core differentiator |
| Alerts | New candidates shown since a saved search | Explicit refresh initially; scheduling is a separate future decision | No autonomous corpus expansion or background agent loop by default |
| Collaboration | Export/share scope preview and review attribution | Real authorization/storage model before multi-user editing | Do not imply vendor-style roles from host workspace visibility. Defer |

### 5.3 Essential interaction details

- **Show provenance at the point of use:** “abstract only,” “full text verified,” “OCR-derived,” “imported annotation, location unresolved,” “AI draft,” and “human-reviewed” are different states.
- **Make corpus scope visible:** “these 6 document revisions,” not a mutable collection name hidden in a prompt.
- **Make uncertainty visible:** inaccessible PDF, scanned page, unsupported table, missing method description, stale source, and conflicting metadata are normal results.
- **Separate action verbs:** Import, Verify, Retrieve, Ask, Propose, Accept, Export, and Apply should not be one ambiguous Save button.
- **Use public navigation:** encode paper/annotation/evidence selection through the panel's supported navigation query. Resolve opaque identities on load. Do not invent private PDF or session URLs.
- **Provide accessible evidence review:** text excerpts and keyboard navigation alongside canvas marks; use real-browser tests for geometry and assistive-technology checks for the reading flow.

## 6. Proposed backend and data model

### 6.1 Preserve the current boundaries

```text
Browser library / reader / evidence / writing views
                    |
          versioned package peer operations
                    |
       thin dispatcher + application services
          /             |                 \
 workspace records   plugin-private     provider adapters
 and verified PDFs   receipts/caches    and bounded workers
          |
 bounded companion read tools + reviewed result protocol
          |
     ordinary Pi conversations
```

- Keep pure identity, parsing, conflict, citation, and evidence rules in `src/domain/`.
- Keep network, filesystem, workers, clocks, provider credentials, and lifecycle in injected adapters/services under `src/server/`.
- Keep native agent behavior in the companion; share domain contracts, not host internals.
- Keep the dispatcher thin. Add operations by capability domain, not a generic “execute arbitrary research command” peer.
- Do not add a database, vector service, workflow framework, or full MCP implementation merely for architectural symmetry.

### 6.2 Domain records worth separating

These are logical contracts, not a finalized schema or approved directory layout.

| Record | Identity / essential fields | Why separate it? |
| --- | --- | --- |
| **Reference** | Stable local ID; type; structured creators/date/title/venue/identifiers; stable citekey plus explicit aliases; revision | Bibliographic identity must not depend on a filename, mutable title, or one provider |
| **SourceRecord** | Provider + library/account namespace + remote key; remote version; observed time; bounded raw payload/hash; import batch | Several providers can describe the same work; provenance and conflict resolution need the originals |
| **DocumentRevision** | Reference ID; immutable byte digest; size; format; admitted workspace-relative location; retrieval/source/rights declarations | A work can have no PDF, multiple PDFs, versions, or supplements. Evidence binds to bytes, not merely DOI |
| **Extraction** | Document digest; extractor/version/configuration; language; page mapping; text/artifact hashes; warnings | Parser/OCR changes can invalidate offsets without changing the PDF |
| **Passage / Evidence** | Document and extraction identities; exact text/hash; page index and display label; optional rectangles; origin and review state | Allows deterministic source checks and honest “unanchored” states |
| **Collection / SearchSnapshot** | Members or query definition; provider/query/date/filter/result provenance; frozen membership for a run | Saved discovery searches are mutable; the corpus used in a result must not be |
| **Claim / ExtractionCell** | Bounded statement or typed value; evidence references; support/contrast/context relationship; method/units; review state | A formatted citation alone cannot express what supports a claim |
| **TaskSpec / RunReceipt** | Task version, corpus fingerprint, consent scope, intended output, limits, run/session/provider IDs, execution state | Admission, provider progress, result receipt, and approval are separate lifecycles |
| **DraftBundle** | Immutable output plus references, evidence map, input identities, warnings, generator metadata, result hash | Drafts must remain reviewable after the chat or connection disappears |
| **Acceptance / Application** | Accepted result hash, actor/time, expected target revision, applied revision/backup reference | Accepting a draft is not identical to applying it or resolving its source annotation |

For systematic-review work, add a distinction between **study** and **report/reference** when required: several publications can describe the same participants or experiment. DOI-level deduplication alone does not prevent double-counting evidence.

Do not make `CSL-JSON` the entire domain model. It is a useful bibliographic interchange/rendering projection, but it does not represent attachment revisions, import ownership, passage provenance, or review state. Preserve unsupported fields in a bounded provider-specific envelope and show export losses.

### 6.3 Pilot compatibility and catalog evolution

The pilot schema rejects unknown fields and requires a PDF and particular paths. It cannot simply absorb collections, DOI fields, metadata-only references, or arbitrary IDs.

Proposed path:

1. Keep pilot v1 readable and writable exactly as supported today.
2. Add a read projection for citation/evidence export without changing the pilot manifest.
3. Design a separate, opt-in general-catalog version and explicit source selection before general import.
4. If migration is requested, produce a dry-run plan and backup; preserve pilot paper/annotation identities and citekeys or maintain an explicit mapping. Never silently relocate PDFs or source notes.
5. Retain `.deleted` recovery records and synthetic/pilot disambiguation. A new catalog must not introduce another ambiguous implicit source.

Schema versioning, coexistence, paths, and rollback deserve an ADR before implementation. “Raise the 20-paper limit” is not a catalog migration strategy.

### 6.4 Ingestion and conflict handling

A proposed import pipeline:

1. Admit a user-selected workspace export or upload using public host file helpers; do not accept peer-supplied workspace roots.
2. Read with explicit byte, record, string, nesting, and attachment-count limits. Detect format by structure as well as extension.
3. Parse through a format-specific adapter: BibTeX/BibLaTeX, RIS, CSL-JSON, or version-profiled vendor JSON. Do not interpret imported TeX/HTML as executable content.
4. Retain the import's origin and a hash of the input. Produce normalization warnings and a field-loss report.
5. Match exact provider identities first; use identifiers and bibliographic similarity to propose, not force, other merges. Display version-of-record/preprint ambiguity and citekey collisions.
6. Admit attachments separately: controlled copy/download, rights declaration, file type/size/digest validation, then publication. Never trust a filename as attachment identity.
7. Present a bounded change set. Re-check the expected catalog revision when publishing.
8. Reimport the same snapshot without duplicating records. Do not propagate deletions from a partial export.

Later synchronization needs three inputs: last imported state, current external state, and local edits. A field ownership policy might make Paperpile authoritative for core metadata while this package owns evidence and draft records. Make that choice explicit per connector; it cannot be inferred from timestamps.

### 6.5 Extraction and retrieval

Start with **local lexical search over verified page text**, plus metadata/annotation filters. Add embeddings only after evaluating retrieval failures and the disclosure/cost trade-off.

- Key extraction caches by PDF digest and extractor version/configuration, not path or title.
- Preserve physical page index, printed-page label when known, and passage/rectangle mapping. Do not turn an imported “page 12” into an exact PDF coordinate without verification.
- Return bounded passages with IDs, provenance, and neighboring context. Record which evidence was actually supplied to a task.
- Treat OCR and table/figure extraction as separate optional adapters with confidence/warning information. A blank text layer is not evidence that a paper has no relevant content.
- Keep parsing/OCR CPU work out of the daemon's main event loop; use cancellable, bounded worker/child-process execution. Large optional runtimes must not inflate the shipped browser bundle or exceed host package limits.
- Do not substitute remotely obtained TEI text for the verified local PDF silently. OpenAlex documents both parsing errors and the absence of OCR in its GROBID output. Bind external text to its own provenance until a verified correspondence exists. [I4]
- A cache/index is reconstructible. Human notes, accepted evidence, and manuscripts are not disposable cache.

### 6.6 Persistence and operation shapes

Keep **portable research artifacts** in the selected workspace under a deliberately chosen, versioned layout; keep **credentials, provider/session receipts, and reconstructible caches** in private/operator-managed locations. Plugin `dataDirectory` is shared across the plugin's machine-local workspaces, so authority namespacing remains mandatory. Moving/archiving a workspace must have an explicit policy for its private receipts.

For initial implementation, use existing flushed, revision-checked, atomic single-record patterns. A multi-file draft/export bundle needs a publication boundary: write an immutable staged bundle, validate it, then atomically publish its manifest. Do not claim a sequence of renames makes a multi-file transaction. Cross-process writers and power-loss guarantees remain separate problems.

Illustrative future peer families:

- `catalog.list`, `imports.preview`, `imports.commit`
- `evidence.search`, `evidence.get`, `evidence.export`
- `researchTasks.preview`, `researchTasks.start`, `researchTasks.list`
- `researchResults.get`, `researchResults.review`
- `writing.export`, and only later `writing.apply`

Each needs strict versioned input/output validation, host authority, bounded pages/results, revision preconditions, explicit error states, and cancellation behavior. Names above are **not available APIs**. Avoid a public arbitrary-URL fetch operation or unrestricted filesystem write operation.

## 7. Agentic research workflows

### 7.1 Task recipes, not an unconstrained “research everything” button

| Task | Inputs and agent work | Durable output | Required gate / quality check |
| --- | --- | --- | --- |
| **Triage a reading queue** | Selected metadata/abstracts; classify relevance against stated criteria | Ranked candidates with reasons and missing-data flags | Label abstract-only decisions; do not claim full-text appraisal |
| **Read one paper critically** | Verified passages or explicitly admitted PDF; question/method checklist | Structured summary, limitations, open questions, evidence links | Every factual summary field points to evidence or is marked not found |
| **Build an evidence matrix** | Frozen paper set and versioned extraction columns | Per-paper cells for method/population/outcome/limitations, each with evidence | Preserve units, sample definitions, and “not reported”; review ambiguous extraction |
| **Compare or synthesize** | Evidence matrix and bounded neighboring passages | Themes, agreements, disagreements, and candidate claims | Look for incompatible settings, null findings, and overlapping studies rather than count papers |
| **Plan an outline / research gap** | Research question, corpus coverage, accepted findings, counterexamples | Argument outline, unresolved questions, proposed search follow-ups | Absence from retrieved results is not proof of novelty or absence from the literature |
| **Expand the literature** | Seed IDs, search scope, date/language/venue criteria, provider budget | Candidate inbox and search/edge provenance | User approves expansion; recommendations are not automatically included evidence |
| **Draft related work / a section** | Outline, intended claim, approved evidence set, style constraints | Markdown/LaTeX draft, resolved bibliography, claim/evidence map | Unknown citation identities reject; flagged or unreviewed support remains visible in draft exports; no silent manuscript overwrite |
| **Audit a manuscript** | Authorized manuscript snapshot plus bibliography/evidence set | Unresolved keys, metadata mismatches, stale sources, quotation issues, support/counterevidence review | Separate deterministic errors from model judgments and absence of evidence |
| **Draft methods/results/discussion** | Authorized study protocol, code/data versions, experiment outputs, and literature evidence | Section draft separating the user's results from prior work and interpretation | Experimental claims require actual supplied artifacts; papers cannot stand in for experiments the user has not performed |
| **Prepare a response to reviewers** | Reviewer comments, relevant manuscript passages, admitted source set | Response draft and proposed manuscript changes | No invented experiments/results; changes require independent acceptance |

For original-research writing, experiment artifacts need their own provenance adapter and review contract; they are not PDF annotations in disguise. Abstracts and conclusions should be derived from accepted manuscript claims and verified results, with uncertainty preserved. Style rewriting must not strengthen a claim or detach its citation.

For a systematic review, add protocol/search versions, databases and exact queries, search dates, screening decisions and reasons, reviewer disagreements, study/report deduplication, and an auditable selection flow. Exporting a PRISMA-shaped diagram alone does not make a review systematic or compliant; PRISMA is a reporting guideline. [W3]

Quantitative synthesis is a separate analysis workflow: retain effect definitions, units, denominators, uncertainty, and study dependence; compute through reviewed statistical code rather than model-generated arithmetic. A comparison table or a tally of supporting papers is not a meta-analysis.

### 7.2 Bounded tool design

Existing real-pilot tools are read-only. Possible future tools should expose **research objects**, not arbitrary file access or opaque chat history:

| Proposed tool | Contract |
| --- | --- |
| `research_library_search_papers` | Query selected catalog/snapshot; return bounded metadata and availability/provenance |
| `research_library_read_passages` | Resolve verified document/extraction identities; return bounded passage IDs and text/context |
| `research_library_get_evidence` | Resolve evidence IDs with exact source revision and review state |
| `research_library_resolve_citations` | Resolve registered reference IDs/keys to bibliography entries; fail on ambiguous or missing identity |
| `research_library_propose_result` | Submit a bounded typed draft tied to an admitted task and input revisions; never mark it accepted |

These are proposals, not newly registered tools. Use a separate real-data protocol rather than widening the synthetic tool contract. Share validation and read projections with the backend, while retaining normal companion operation without a web daemon: local reads can use the native session's workspace; hosted result submission may require a negotiated capability. An unavailable bridge must fail visibly, not fabricate a saved result.

### 7.3 Example: related-work task

A synthetic task specification might describe:

```json
{
  "taskType": "related-work-draft",
  "taskVersion": 1,
  "corpusSnapshotId": "example-snapshot",
  "goal": "Compare how the selected studies evaluate robustness",
  "evidenceIds": ["example-evidence-a", "example-evidence-b"],
  "output": "markdown-with-claim-map",
  "disclosure": { "externalSearch": false, "uploadFullPdfs": false },
  "limits": { "maxPapers": 6, "maxPassages": 30 },
  "applyToManuscript": false
}
```

The UI should preview the real resolved papers, passages, provider destination, and limits before confirmation. The server resolves IDs against the selected authority and snapshot; an agent cannot substitute a different workspace or corpus by supplying another path.

The result should contain prose **and** a structured mapping, for example:

```text
Draft sentence / claim c1
  -> registered citation key example2026
  -> evidence example-evidence-a
  -> reference identity + document SHA-256 + extraction identity
  -> physical page, optional printed-page label, exact excerpt
  -> support assessment: proposed / human-reviewed / rejected
```

The model's rationale is useful for review, but is not a substitute for stored evidence or a deterministic source check. Record prompt/task version, available provider/model identity, tool/evidence provenance, and material warnings. This improves auditability; it does not promise identical model output on rerun.

### 7.4 Separate execution, result, and review state

Use separate state dimensions rather than one overloaded `completed` flag:

- **Execution:** requested, admitting, running, completed, failed, cancelled, interrupted, or admission-unknown.
- **Result:** absent, received, structurally validated, invalid, or stale.
- **Review/application:** unreviewed, accepted, rejected, applied, or application-conflict.

The existing question receipt remains an execution receipt. A new result store must not reinterpret older completed questions as saved answers.

For hosted structured results, design a companion bridge using the public `pi-session-events@1` capability:

1. Persist task/admission intent before starting work; assign a task/run correlation ID and input fingerprint.
2. Establish a session-local protocol with explicit companion readiness. Subscribe before emitting because replies can be synchronous. Do not assume a companion exists just because a session was created.
3. If using `pi-sessions.create` followed by companion kickoff, the companion must initiate the agreed native turn and report its actual settlement. The event bus does not start model work by itself. If using `pi-sessions.run`, account for early results before a messaging connection is attached; a durable/recoverable result path is required.
4. Bind submitted results to the admitted run, session, schema, and input revisions. Persist validated results before acknowledging them. Deduplicate result retries by run/result identity.
5. Track final native outcome as well as result arrival. A tool submission or `agent_end` event alone is not proof of a successfully settled task; a result may remain a draft after execution failure.
6. Let the user inspect, accept, export, or apply. Never infer acceptance from turn completion, tool success, or annotation resolution.
7. On disconnect/restart, report incomplete observation honestly. The event contract has no replay. Do not start another model run merely to restore the panel.

Start with a small bounded result protocol, not a general durable job engine. If no robust result channel is implemented, the supported fallback is the existing visible conversation with manual review/export—not chat scraping through private routes.

## 8. Writing and citation integration

### 8.1 Text-first writing is the practical initial target

Pandoc accepts BibTeX/BibLaTeX, CSL-JSON/YAML, and RIS bibliographic data, and uses citeproc/CSL for citation rendering. Quarto builds on these mechanisms and supports citation keys and locators. This gives the package a useful writing interface without building its own word processor. [W1], [W2]

Proposed export bundle:

- `draft.md` or a deliberately selected LaTeX fragment;
- a bibliography containing resolved references;
- a machine-readable claim/evidence map;
- a provenance manifest with input/output hashes, source revisions, review state, and unresolved warnings.

Keep paths illustrative until the layout ADR is accepted. Draft bundles are private research artifacts, not npm assets. A DOCX produced by a text-first renderer should be described as a rendered document unless live reference-manager fields have been explicitly produced and tested.

### 8.2 Citation identity and formatting rules

- Retain existing pilot bibkeys. Imported citekeys need collision handling and explicit aliases; changing a title must not silently rewrite a cited key.
- Agents choose from resolved references. They do not create authoritative DOIs, bibliographic fields, or citation keys by plausible completion.
- Represent citation locators structurally. Physical PDF page 7 may not be printed page 7.
- Pin the formatter/style identity in an export manifest when reproducibility matters. CSL formatting does not verify the claim being cited.
- Parse manuscript citations with the chosen format's parser/AST, not a universal regular expression. Exclude code blocks and respect citation syntax.
- Distinguish unused bibliography entries, unresolved keys, inaccessible evidence, and unsupported claims. They are different diagnostics.
- Keep generated upstream files separate from local additions: for example, an upstream `paperpile.bib` plus a local reviewed bibliography. Never edit a file known to be overwritten by auto-export. [P6]

### 8.3 Word, Google Docs, and Overleaf

**Word/Google Docs:** initially export text/bibliography or provide a copy-citation workflow, then let Paperpile/Zotero/Papers/EndNote manage their own live fields. A rendered `(Author, Year)` is not an editable reference-manager citation. Even Paperpile documents an explicit conversion between its Google Docs and Word representations. Direct editor integration deserves a separate product decision, authentication design, and real-document tests. [P10], [Z5]

**Overleaf/LaTeX:** produce or consume a user-selected `.bib` artifact and draft fragment. Git/cloud/Overleaf synchronization remains an explicit user-configured external integration. Do not automatically commit or push manuscript content; do not grant an agent permission to overwrite vendor-managed bibliography files. [P2], [Z6]

**Source-note/Markdown workflows:** offer a note bundle containing selected quotes, exact source identities, citation keys, and links resolvable by the package. Preserve existing `Thesis/Citations/` files; source-note augmentation requires a preview and expected-content check, not a background rewrite.

### 8.4 Safe manuscript application

Initially **export without applying**. Later application should require:

1. An explicit target chosen within host-resolved workspace authority.
2. An expected target hash/revision, a narrowly scoped patch, and a visible diff.
3. A backup/recovery record and clear failure outcome.
4. Revalidation of evidence and bibliography identities before publication.
5. Separate reporting of “draft accepted” and “file changed successfully.”

Do not extend current single-file atomicity claims to a manuscript/bibliography/evidence bundle without a tested recovery design. Never auto-apply to a live collaborative Word/Docs document by treating it like a local text file.

## 9. Trust, privacy, and operational boundaries

### 9.1 Data disclosure is an explicit operation

Track distinct consent for:

- metadata or search queries sent to a discovery service;
- selected excerpts sent to the configured model;
- full PDFs, images, or unpublished manuscript content uploaded to a provider;
- external library mutation or sharing;
- local manuscript application.

A user allowed to read a subscribed paper does not necessarily have permission to redistribute it or upload it to every provider. Record rights declarations without inventing a license. An OA metadata record is not itself a full-text reuse grant; OpenAlex explicitly preserves original PDF copyright. [I4]

Provider privacy/retention, regional processing, institutional agreements, and training policies require review for the user's actual plan. This research did not independently validate them. Provide a useful offline/local-read mode, but do not label an ordinary remotely hosted model workflow “local-only.”

### 9.2 Documents and imported metadata are untrusted data

Papers, bibliography fields, abstracts, annotations, and provider results may contain instructions or malicious markup. They must not alter task authority or tool policy.

- Sanitize rendering and reject executable content in import/preview paths.
- Bound JSON/XML/ZIP parsing, decompression, file counts, and path traversal; disable XML external entities if TEI/XML support is added.
- Do not automatically follow arbitrary metadata URLs. Network adapters need approved protocols/destinations, redirect checks, private-address protections, byte/time limits, and credential redaction.
- Treat remote download links containing tokens as secrets, including in logs and exported provenance.
- Keep authentication server-side or in the operator's configured agent integration. Do not store keys in browser assets, manifests, research prompts, or Git. No public host credential-vault capability was established by this research; design an injected credential source rather than inventing one.
- Plugins and ordinary Pi tools run with account permissions. A read-only research tool set or “do not modify files” prompt is **not a sandbox**. Hard filesystem/network isolation would require separately designed execution isolation.

Likewise, configured budgets can strictly bound this package's own adapters; they cannot automatically constrain every unrelated tool available in an ordinary Pi conversation. Make enforcement limits visible.

### 9.3 Ownership, recovery, and scope

- Preserve host-resolved workspace authority, revision comparisons, bounded reads, verified PDF snapshots, and atomic publication.
- Preserve soft-deleted annotation recovery files. Deletion is not secure erasure, and private receipts/results may contain sensitive questions or manuscript material.
- Separate result retention from cache eviction. Archiving receipts can remove duplicate-run protection; offer explicit offline backup/retention guidance before adding cleanup.
- Do not promise cross-process consistency, multi-user roles, or remote-machine data replication that the package does not implement.
- Cancel unpublished ingress/workers on lifetime abort; do not terminate a published user conversation because the panel closes.
- No live-host installation, configuration change, or daemon restart is part of research or tests. Future server-plugin deployment requires an operator-controlled restart when safe, which interrupts active sessions and terminals.

## 10. Delivery sequence and verification

### 10.1 Recommended sequence

Effort labels are relative scope/risk, not calendar estimates.

| Phase | Deliverable | Relative effort | Exit criterion |
| --- | --- | --- | --- |
| **0 — Decide and probe** | Synthetic Paperpile bibliography/annotation import fixtures; representative export-loss report; catalog/ownership ADR proposals | Small–medium | Know what can be preserved; no private API dependency; no change to pilot paths |
| **1 — Evidence portability** | Export current pilot metadata/annotations as citation-aware notes and evidence bundles; stable citation resolution; bounded verified passage extraction/read path | Medium | A user/agent can retrieve a passage and reopen the exact source; export does not modify source notes or annotations |
| **2 — General library bridge** | Explicit catalog v2/coexistence decision; staged BibTeX/RIS/CSL-JSON import; separately admitted PDFs; collections; metadata-only references; Paperpile-specific adapter only where justified | Large | Reimport is safe; losses/conflicts are visible; no implicit v1 migration; missing PDF does not destroy the reference |
| **3 — Agent synthesis and writing** | Frozen corpus tasks; evidence matrix; durable structured result bridge; related-work draft; citation/evidence audit; human review and text-first export | Large | Reload/reconnect never silently duplicates model work; result validation and acceptance are distinct; unresolved reference identities reject while semantic support remains a separate review |
| **4 — Selective enrichment** | One discovery provider and metadata resolver; read-only Zotero connector; notices/retraction checking; optional Elicit/scite integration | Medium–large, provider-dependent | Verified credentials/terms, bounded costs, accurate provenance, and degraded/offline behavior |
| **5 — Earned complexity** | OCR/vision, embeddings, live external write-back, manuscript apply, alerts, collaboration | Individually scoped | Each solves a measured problem and has its own authority/recovery/performance evidence |

Some work can be decoupled: Phase 3's first multi-paper pilot prototype need not wait for a thousands-item catalog, but production result publication still needs its own real-data protocol. Phase 4 may move earlier for an explicitly requested existing Zotero/Elicit workflow. Do not make every provider a launch dependency.

**Defer by default:** native Word/Docs field-code editing, a browser capture extension, a new cloud-sync service, graph-first UI, automatic scheduled research, and bidirectional sync across several reference managers. These have large maintenance/authority costs relative to the initial evidence-to-draft workflow.

### 10.2 Test and evaluation plan

Follow the repository's synthetic-fixture and temporary-directory policy. Proposed coverage:

| Layer | Important cases |
| --- | --- |
| Pure domain/parser | Unicode names, corporate authors, missing dates/DOIs, non-article types, BibTeX macros/escaping, RIS variants, citekey collisions, field loss, unsupported vendor JSON, duplicate reports/versions |
| Import/storage | Same import twice; partial export mistaken for deletion; metadata three-way conflict; changed PDF; digest mismatch; symlink/path escape; failed publication; corrupt/oversized input; backup/rollback; retained tombstones |
| Retrieval/evidence | PDF revision or extractor changes; OCR-empty page; repeated quotations; wrong page labels; multi-column text; unit/table ambiguity; bounded search; stale/invalid evidence rejected |
| Provider adapter | 401/403, 429/backoff, quota pause, schema change, missing full text, partial warnings, unknown admission after timeout, expiring tokenized URL, cancelled fetch, retries without duplicate jobs |
| Task/result lifecycle | Missing companion; synchronous reply; lost acknowledgment; duplicate/mismatched result; late result after task changed; initial failure after a draft; disconnect/restart; explicit acceptance only |
| Frontend (per-file happy-dom) | Import consent and diff, selected-corpus preview, conflict handling, warnings, pending draft protection, no model call on render/refresh, keyboard and focus behavior |
| Real browser | PDF/region/evidence navigation, canvas geometry, worker/asset URLs, readable source context, integration flows on a test adapter |
| Writing | Every used citekey resolves; exported bibliography matches selected references; locator fidelity; static vs live citation disclosure; changed target rejects apply; no overwrite of upstream auto-export |
| Distribution | Browser assets remain inside `browserRoot`; no research data/secrets in tarball; public import boundaries; 4,096-entry/16 MiB host discovery limits |

Measure quality separately from green unit tests:

- proportion of factual draft claims with inspectable evidence;
- quotation/location correctness and stale-source detection;
- retrieval recall on a deliberately constructed synthetic corpus;
- human-rated support, overgeneralization, missed counterevidence, and correction effort;
- unresolved citation rate, import information loss, and duplicate admission rate;
- latency, memory, provider requests/cost, and time spent reviewing versus repairing output.

Do not report a support percentage as a scientific truth score. Evaluation of genuinely useful literature synthesis needs domain-expert review and appropriate data authorization beyond synthetic regression tests.

For implementation, start with targeted tests, then typecheck/lint and `npm run verify`; use `npm run smoke:browser` for test-adapter browser evidence. A real-daemon integration test remains separate and must use an isolated host instance. This research did **not** execute those runtime checks or validate an authenticated vendor integration.

## 11. Decisions to record as ADRs

These are **candidate decisions**, not accepted ADRs. Record alternatives and obtain agreement before implementing schema or authority changes.

| Suggested ADR | Recommended direction | Main alternative / consequence |
| --- | --- | --- |
| Reference identity and catalog v2 | Stable local reference identity, separate source records/document revisions, explicit pilot coexistence/migration | Extending strict pilot v1 in place risks breaking existing records and read tools |
| External-library ownership | Export-first/read-only connectors; explicit field ownership and conflict previews | Bidirectional sync offers convenience but needs deletions, permissions, three-way merge, and recovery semantics |
| Evidence and extraction contract | Immutable document/extraction identities and structured passage/claim links | Plain Markdown notes are simpler but cannot reliably validate source locations or stale evidence |
| Agent result lifecycle | Explicit task admission, correlated durable draft receipt, final-outcome tracking, separate human acceptance | Chat-only results are simpler and remain a valid fallback, but do not support dependable result ingestion |
| Writing boundary | Markdown/LaTeX and CSL/BibTeX export first; vendor plugins retain live editor citations | Native editor integrations create a separate auth, field-format, and collaborative-editing product surface |
| Provider/disclosure policy | Local artifacts; explicit external calls; injected credentials; bounded adapters | Automatic cloud ingestion and agent fan-out increase disclosure, cost, and lifecycle ambiguity |
| Storage and scale, when needed | Start with bounded revisioned artifacts plus rebuildable indexes; benchmark before choosing a database/vector store | Immediate database/service adoption adds migrations and deployment weight before proven need |

Questions for the operator/product owner:

1. Is Paperpile the authoritative personal library, or should this package eventually replace it? Is shared-library use important?
2. Is the primary writing target Markdown/Quarto/LaTeX, Word, or Google Docs?
3. Is the workload a curated thesis corpus, ongoing exploratory research, or a formal systematic review?
4. What scale matters first: tens, hundreds, or thousands of references, and how many PDFs?
5. Which content may leave the machine, to which providers, under which institutional terms?
6. Are human-reviewed exports enough, or is controlled file application a requirement?
7. Which existing account subscriptions/API entitlements justify a connector now?

Unless those answers change the priority, start with **evidence portability + text-first drafting**, then add a safe Paperpile-compatible catalog bridge.

## 12. Sources and residual research gaps

All sources below were consulted on 2026-09-26. “Read” means relevant fetched page content was inspected, not the complete product was tested. Linked manuals and APIs can change after this snapshot.

### Paperpile

| ID | Primary source | Evidence used |
| --- | --- | --- |
| [P1] | Reference-manager features | Read: reference types, metadata/full-text search, duplicates, metadata repair, organization |
| [P2] | Integrations | Read: writing, browser, storage, AI, and export integrations |
| [P3] | Export library data | Read: formats, internal JSON, no JSON reimport, PDFs separate |
| [P4] | Print PDFs and export annotations | Read: export formats and annotation summaries |
| [P5] | Ask AI | Read: prompt recipes, external uploads, backlinks, limitations, MCP/save-back answers |
| [P6] | Automatic BibTeX sync | Read: destinations, overwrite behavior, shared-folder limitation |
| [P7] | Shared libraries | Read: permissions, annotation scope, live/independent copies, integration limitations |
| [P8] | Roadmap | Read: public REST API and MCP marked Started |
| [P9] | Google Docs | Read: citation insertion and structured locators |
| [P10] | Word | Read: citation formatting and editor/vendor conversion |
| [P11] | Customize BibTeX output | Read: keys, BibTeX/BibLaTeX, export settings |

### Reference managers and research products

| ID | Primary source | Evidence used |
| --- | --- | --- |
| [Z1] | Zotero Web API v3 | Read: public API scope and entry points |
| [Z2] | Zotero API syncing | Read relevant passages: versions, conditional requests, synchronization |
| [Z3] | Zotero local API | Read relevant passages: local authority, version-dependent writes, paging, attachment redirects |
| [Z4] | Zotero PDF reader/notes | Read: annotation-to-note workflow, source links, database-stored annotations |
| [Z5] | Zotero word-processor integration | Read: dynamic citations and bibliographies |
| [Z6] | Better BibTeX automatic export | Read: optional plugin auto-export and Git caveats |
| [M1] | Mendeley workflow guide | Read: reader, notebook, private groups |
| [M2] | Mendeley API overview | Read: OAuth/REST resource model |
| [M3] | Mendeley developer portal | Read: legacy service/endpoint retirement notices |
| [N1] | EndNote Research Assistant manual | Read: PDF-backed key-point summaries |
| [N2] | EndNote product page | Search-indexed only; direct retrieval returned HTTP 403 |
| [R1] | Papers Getting Started 2025 | Indexed official guide; fetched PDF extraction insufficient for independent inspection |
| [R2] | Papers AI Vision announcement | Indexed official description; direct retrieval returned HTTP 404 |
| [E1] | Elicit API reference | Read relevant v2/MCP/lifecycle passages; no authenticated requests |
| [S1] | scite MCP | Read: integration and OAuth; tool behavior not tested |
| [S2] | scite API | Search-indexed only; direct retrieval returned HTTP 403; endpoint details not used as implementation contracts |
| [D1] | ResearchRabbit features | Read: discovery and visual connections |
| [D2] | ResearchRabbit sharing/export | Read: collections, sharing, export workflow; some details are image-only |
| [D3] | Litmaps features | Read: search, maps, Zotero, monitoring |
| [D4] | Litmaps export | Read: export/citation workflow; some format details are image-only |
| [D5] | Connected Papers official JS client | Read: early-access API, graph retrieval, usage and overload handling |
| [D6] | Connected Papers About | Search-indexed; direct readable extraction blocked by JavaScript rendering |

### Infrastructure, writing, and review methodology

| ID | Primary source | Evidence used |
| --- | --- | --- |
| [I1] | Crossref REST API | Read: deposited metadata, identifiers, licensing caveat, update data |
| [I2] | Crossref Retraction Watch | Read: notice relationships, coverage, REST and dataset access |
| [I3] | OpenAlex authentication | Read: current API keys and usage/rate-limit behavior |
| [I4] | OpenAlex full text | Read: PDF/TEI availability, parsing/OCR limitations, copyright |
| [I5] | Semantic Scholar API | Read: graph/recommendations services, keys and throttling |
| [I6] | Unpaywall API | Search-indexed; readable retrieval failed; optional integration requires revalidation |
| [W1] | Pandoc citations | Read relevant manual passages: bibliography formats, citeproc, CSL |
| [W2] | Quarto citations | Read: citation syntax, bibliography, style, locator handling |
| [W3] | PRISMA 2020 checklist | Read: reporting-checklist resources; no claim of automated methodological compliance |

Repository evidence additionally includes the source links in section 4, current architecture/usage/development docs, and the published public browser/server declaration surfaces from the pinned development dependency. No private host source or routes were used as integration contracts.

### What remains unverified

- Actual export fixtures and round-trip fidelity, especially Paperpile annotation IDs/coordinates, vendor JSON evolution, notes, folders, and shared-library semantics.
- Vendor account entitlements, OAuth/app registration, paid API cost, current MCP tool inventories, credential storage choice, and service terms/privacy for the intended deployment.
- EndNote/Papers/scite feature details beyond the explicitly qualified evidence above; blocked pages are not treated as verified API contracts.
- Whether retrieved citations or AI extraction are correct; vendor feature claims are not independent benchmarks.
- Performance at larger library sizes; OCR/vision and accessible-PDF behavior; live Word/Docs citation-field interoperability.
- Public-host result-bridge behavior in a real isolated daemon and remote federation. This document is a design proposal, not verification evidence for those paths.

[P1]: https://paperpile.com/features/reference-manager/
[P2]: https://paperpile.com/h/integrations/
[P3]: https://paperpile.com/h/export-library-data/
[P4]: https://paperpile.com/h/print-pdfs-export-annotations/
[P5]: https://paperpile.com/h/ask-ai/
[P6]: https://paperpile.com/h/sync-bibtex-files/
[P7]: https://paperpile.com/h/work-with-shared-libraries/
[P8]: https://paperpile.com/roadmap/
[P9]: https://paperpile.com/h/get-started-google-docs/
[P10]: https://paperpile.com/h/get-started-word/
[P11]: https://paperpile.com/h/customize-bibtex-output/
[Z1]: https://www.zotero.org/support/dev/web_api/v3/
[Z2]: https://www.zotero.org/support/dev/web_api/v3/syncing
[Z3]: https://www.zotero.org/support/dev/web_api/v3/local_api
[Z4]: https://www.zotero.org/support/pdf_reader
[Z5]: https://www.zotero.org/support/word_processor_integration
[Z6]: https://retorque.re/zotero-better-bibtex/exporting/auto/
[M1]: https://blog.mendeley.com/2024/06/14/3-ways-to-get-the-most-out-of-mendeley-references-manager/
[M2]: https://dev.mendeley.com/overview/how_it_works.html
[M3]: https://dev.mendeley.com/
[N1]: https://docs.endnote.com/docs/endnote/2025/v1/macos/en/content/03editref/ai_in_endnote_research_assistant.htm
[N2]: https://endnote.com/product-details/
[R1]: https://www.papersapp.com/wp-content/uploads/2025/12/Papers-Getting-Started-2025.pdf
[R2]: https://www.papersapp.com/highlights/explore-images-and-visualizations-with-ai-vision/
[E1]: https://docs.elicit.com/
[S1]: https://scite.ai/mcp
[S2]: https://scite.ai/api
[D1]: https://www.researchrabbit.ai/features
[D2]: https://learn.researchrabbit.ai/en/articles/13192798-how-to-share-papers-and-collections
[D3]: https://www.litmaps.com/features
[D4]: https://docs.litmaps.com/en/articles/9092828-export-articles-from-litmaps
[D5]: https://github.com/ConnectedPapers/connectedpapers-js
[D6]: https://www.connectedpapers.com/about
[I1]: https://www.crossref.org/documentation/retrieve-metadata/rest-api/
[I2]: https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/
[I3]: https://help.openalex.org/api/authentication/
[I4]: https://help.openalex.org/access/fulltext/
[I5]: https://www.semanticscholar.org/product/api
[I6]: https://unpaywall.org/products/api
[W1]: https://pandoc.org/MANUAL.html#citations
[W2]: https://quarto.org/docs/authoring/citations.html
[W3]: https://www.prisma-statement.org/prisma-2020-checklist
