import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { LitElement, html, nothing, type TemplateResult } from "lit";
import { emptyReferenceFields, libraryTaskKinds, referenceTypes, LIBRARY_MAX_PDF_BYTES } from "../domain/workbench.js";
import type { BibliographyFormat, CitationStyle, LibraryCollection, LibraryDocument, LibraryEvidence, LibraryManuscript, LibraryPage, LibraryReference, LibraryTask, LibraryTaskKind, LibraryTextHit, ReferenceFields } from "../domain/workbench.js";
import { defineResearchLibraryPdfViewerElement, ResearchLibraryPdfViewerElement, researchPdfSelectionEventName, researchPdfAnnotationEventName, researchPdfReadyEventName, type ResearchPdfSelectionDetail } from "./pdfViewerElement.js";
import type { PdfPeerSource } from "./pdfRange.js";
import { WorkbenchClient, workbenchContextKey, workbenchId, reference, collection, evidence, task, manuscript, page, object, list, text, fields, download, choice, textHit } from "./workbenchClient.js";
import { workbenchStyles } from "./workbenchStyles.js";

type Tab = "Reference" | "Reader" | "Evidence" | "Research" | "Writing" | "Import & export";
interface ReferenceDraft { id: string; revision: number; fields: ReferenceFields }
type EvidenceDraft = Pick<LibraryEvidence, "id" | "referenceId" | "documentId" | "pdfSha256" | "page" | "rect" | "quote" | "body" | "kind" | "status" | "tags"> & { expectedRevision: number };
interface ManuscriptDraft { id: string; expectedRevision: number; title: string; markdown: string; referenceIds: string[]; taskIds: string[]; style: CitationStyle }
interface Drafts { reference: ReferenceDraft | null; evidence: EvidenceDraft | null; writing: ManuscriptDraft | null; referenceDirty: boolean; evidenceDirty: boolean; writingDirty: boolean }
interface WorkspaceDrafts { edits: Drafts; taskKind: LibraryTaskKind; taskGoal: string; importFormat: BibliographyFormat; importText: string; collection: { id: string; revision: number; name: string; parentId: string }; attachment: { path: string; label: string; sourceUrl: string; rights: string }; applyPath: string }
interface TaskPreview { id: string; kind: LibraryTaskKind; goal: string; referenceIds: string[]; corpusHash: string; prompt: string; warnings: string[] }
interface ImportPreview { references: ReferenceFields[]; warnings: string[]; duplicateCandidates: { index: number; referenceId: string; reason: string }[]; fingerprint: string }
interface ApplyPreview { id: string; revision: number; path: string; expectedHash: string | null; previewToken: string; text: string; diff: string }
const emptyPage = <T>(): LibraryPage<T> => ({ items: [], total: 0, nextOffset: null });
const split = (value: string): string[] => [...new Set(value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean))];
function value(event: Event): string { const target = event.currentTarget; if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) throw new Error("Expected a form control"); return target.value; }
function checked(event: Event): boolean { if (!(event.currentTarget instanceof HTMLInputElement)) throw new Error("Expected a checkbox"); return event.currentTarget.checked; }
function emptyDrafts(): Drafts { return { reference: null, evidence: null, writing: null, referenceDirty: false, evidenceDirty: false, writingDirty: false }; }

export function defineLibraryWorkbenchElement(): void {
  defineResearchLibraryPdfViewerElement();
  if (customElements.get("pi-web-library-workbench") === undefined) customElements.define("pi-web-library-workbench", LibraryWorkbenchElement);
}

/** Native catalog UI. Drafts are owned here, never by list responses or the PDF renderer. */
export class LibraryWorkbenchElement extends LitElement {
  static override styles = workbenchStyles;
  private binding: WorkspacePanelContext | undefined;
  private bindingKey = "";
  private client: WorkbenchClient | undefined;
  private epoch = 0;
  private busy = false;
  private error = "";
  private notice = "";
  private tab: Tab = "Reference";
  private readerLibraryVisible = false;
  private focusEvidenceEditor = false;
  private drafts = emptyDrafts();
  private readonly parkedDrafts = new Map<string, WorkspaceDrafts>();
  private references = emptyPage<LibraryReference>();
  private collections: LibraryCollection[] = [];
  private selected = new Map<string, LibraryReference>();
  private active: LibraryReference | null = null;
  private activeDocument: LibraryDocument | null = null;
  private viewer: ResearchLibraryPdfViewerElement | null = null;
  private pendingPage: { sourceUrl: string; page: number } | null = null;
  private evidencePage = emptyPage<LibraryEvidence>();
  private tasks = emptyPage<LibraryTask>();
  private manuscripts = emptyPage<LibraryManuscript>();
  private currentTask: LibraryTask | null = null;
  private query = "";
  private collectionFilter = "";
  private tagFilter = "";
  private readingFilter = "";
  private screeningFilter = "";
  private favoriteFilter = false;
  private trash = false;
  private listGeneration = 0;
  private appliedLibraryFilters: string | null = null;
  private appliedEvidenceFilters: string | null = null;
  private evidenceQuery = "";
  private evidenceKind = "";
  private evidenceStatus = "";
  private evidenceTrash = false;
  private collectionDraft = { id: workbenchId("col"), revision: 0, name: "", parentId: "" };
  private duplicates: { leftId: string; rightId: string; reason: string }[] = [];
  private mergePair: { keep: LibraryReference; remove: LibraryReference } | null = null;
  private attachment = { path: "", label: "", sourceUrl: "", rights: "" };
  private uploadCancel: (() => void) | undefined;
  private uploadProgress = "";
  private textQuery = "";
  private hits: LibraryTextHit[] = [];
  private taskKind: LibraryTaskKind = "summary";
  private taskGoal = "";
  private taskPreview: TaskPreview | null = null;
  private modelConsent = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pollRemaining = 0;
  private importFormat: BibliographyFormat = "bibtex";
  private importText = "";
  private importPreview: ImportPreview | null = null;
  private importSelection = new Set<number>();
  private exportFormat: BibliographyFormat = "bibtex";
  private audit: { issues: { kind: string; message: string; key?: string }[]; citationKeys: string[]; bibliography: string } | null = null;
  private applyPath = "";
  private applyPreview: ApplyPreview | null = null;
  private applyConsent = false;
  private citationId = "";

  get context(): WorkspacePanelContext | undefined { return this.binding; }
  set context(context: WorkspacePanelContext | undefined) {
    const key = context === undefined ? "" : workbenchContextKey(context);
    if (context !== undefined && this.binding !== undefined && this.bindingKey === key) {
      const availabilityChanged = (this.binding.peer === undefined) !== (context.peer === undefined);
      this.binding = context; this.client?.rebind(context);
      // Do not restart on peer object identity: hosts may create wrappers every render.
      if (availabilityChanged) { this.stop(); this.activeDocument = null; if (this.isConnected) this.start(); }
      this.requestUpdate(); return;
    }
    if (this.binding !== undefined) this.parkedDrafts.set(this.bindingKey, { edits: this.drafts, taskKind: this.taskKind, taskGoal: this.taskGoal, importFormat: this.importFormat, importText: this.importText, collection: this.collectionDraft, attachment: this.attachment, applyPath: this.applyPath });
    this.stop();
    this.binding = context; this.bindingKey = key;
    if (context === undefined) { this.requestUpdate(); return; }
    const parked = this.parkedDrafts.get(key);
    this.parkedDrafts.delete(key);
    this.drafts = parked?.edits ?? emptyDrafts();
    this.references = emptyPage(); this.collections = []; this.selected = new Map(); this.active = null; this.activeDocument = null;
    this.evidencePage = emptyPage(); this.tasks = emptyPage(); this.manuscripts = emptyPage(); this.currentTask = null;
    this.appliedLibraryFilters = null; this.appliedEvidenceFilters = null;
    this.taskPreview = null; this.modelConsent = false; this.applyPreview = null; this.applyConsent = false; this.audit = null;
    this.importPreview = null; this.importSelection = new Set(); this.importText = ""; this.hits = []; this.duplicates = []; this.mergePair = null;
    this.query = ""; this.collectionFilter = ""; this.tagFilter = ""; this.readingFilter = ""; this.screeningFilter = ""; this.trash = false; this.favoriteFilter = false;
    this.collectionDraft = { id: workbenchId("col"), revision: 0, name: "", parentId: "" };
    this.attachment = { path: "", label: "", sourceUrl: "", rights: "" }; this.uploadProgress = ""; this.taskGoal = ""; this.applyPath = "";
    this.evidenceQuery = ""; this.evidenceKind = ""; this.evidenceStatus = ""; this.evidenceTrash = false; this.textQuery = ""; this.citationId = "";
    if (parked !== undefined) { this.taskKind = parked.taskKind; this.taskGoal = parked.taskGoal; this.importFormat = parked.importFormat; this.importText = parked.importText; this.collectionDraft = parked.collection; this.attachment = parked.attachment; this.applyPath = parked.applyPath; }
    this.error = ""; this.notice = parked !== undefined ? "Workspace form text restored. Review current records and obtain fresh consent before running a model or applying a file." : "";
    if (this.isConnected) this.start();
    this.requestUpdate();
  }
  override connectedCallback(): void { super.connectedCallback(); if (this.binding !== undefined && this.client === undefined) this.start(); window.addEventListener("beforeunload", this.beforeUnload); }
  override disconnectedCallback(): void { this.stop(); window.removeEventListener("beforeunload", this.beforeUnload); super.disconnectedCallback(); }
  private readonly beforeUnload = (event: BeforeUnloadEvent): void => { if (this.hasDrafts()) event.preventDefault(); };
  private hasDrafts(): boolean {
    return this.taskGoal !== "" || this.importText !== "" || [...this.parkedDrafts.values()].some(d => d.taskGoal !== "" || d.importText !== "") || [this.drafts, ...[...this.parkedDrafts.values()].map(d => d.edits)].some(d => d.referenceDirty || d.evidenceDirty || d.writingDirty);
  }
  private stop(): void {
    this.epoch++; this.listGeneration++; this.client?.dispose(); this.client = undefined; this.uploadCancel?.(); this.uploadCancel = undefined;
    this.stopPolling(); this.viewer?.remove(); this.viewer = null; this.pendingPage = null; this.busy = false;
  }
  private start(): void { if (this.binding === undefined) return; this.client = new WorkbenchClient(this.binding); this.run(async client => { await this.loadLibrary(client); this.collections = await client.request("collections.list", {}, v => list(v, collection)); }); }
  private run(action: (client: WorkbenchClient) => Promise<void>): void {
    const client = this.client; if (client === undefined || this.busy) return;
    const epoch = this.epoch; this.busy = true; this.error = ""; this.requestUpdate();
    void action(client).catch((error: unknown) => { if (epoch === this.epoch && !client.signal.aborted) this.error = error instanceof Error ? error.message : "The operation failed. Refresh and retry; unsaved text is retained."; }).finally(() => { if (epoch === this.epoch) { this.busy = false; this.requestUpdate(); } });
  }
  private change(action: () => void): void { action(); this.requestUpdate(); }
  private async loadLibrary(client: WorkbenchClient, offset = 0): Promise<void> {
    const generation = ++this.listGeneration;
    const filters = { query: this.query, ...(this.collectionFilter === "" ? {} : { collectionId: this.collectionFilter }), ...(this.tagFilter === "" ? {} : { tag: this.tagFilter }), ...(this.readingFilter === "" ? {} : { readingStatus: this.readingFilter }), ...(this.screeningFilter === "" ? {} : { screening: this.screeningFilter }), ...(this.favoriteFilter ? { favorite: true } : {}), trash: this.trash };
    const filterKey = JSON.stringify(filters);
    // A continuation offset belongs only to the filters that produced the displayed page.
    if (filterKey !== this.appliedLibraryFilters) offset = 0;
    const result = await client.request("library.list", { ...filters, offset }, page(reference));
    if (generation === this.listGeneration) {
      this.references = offset === 0 ? result : { ...result, items: [...this.references.items, ...result.items] };
      this.appliedLibraryFilters = filterKey;
    }
  }
  private async openReference(client: WorkbenchClient, id: string): Promise<void> {
    if (this.drafts.referenceDirty || this.drafts.evidenceDirty) throw new Error("Save or discard pending metadata and evidence before changing reference.");
    const result = await client.request("library.get", { id }, reference);
    this.active = result; this.drafts.reference = { id: result.id, revision: result.revision, fields: fields(result) }; this.drafts.evidence = null;
    if (this.activeDocument !== null && !result.documents.some(doc => doc.id === this.activeDocument?.id)) { this.activeDocument = null; this.viewer?.remove(); this.viewer = null; }
    await this.loadEvidence(client);
  }
  private async loadEvidence(client: WorkbenchClient, offset = 0): Promise<void> {
    if (this.evidenceQuery.length > 200) throw new Error("Evidence search must be 200 characters or fewer.");
    const filters = { ...(this.active === null ? {} : { referenceId: this.active.id }), query: this.evidenceQuery, ...(this.evidenceKind === "" ? {} : { kind: this.evidenceKind }), ...(this.evidenceStatus === "" ? {} : { status: this.evidenceStatus }), trash: this.evidenceTrash };
    const filterKey = JSON.stringify(filters);
    if (filterKey !== this.appliedEvidenceFilters) offset = 0;
    const result = await client.request("evidence.list", { ...filters, offset }, page(evidence));
    this.evidencePage = offset === 0 ? result : { ...result, items: [...this.evidencePage.items, ...result.items] };
    this.appliedEvidenceFilters = filterKey; this.updateMarkers();
  }
  private async loadTasks(client: WorkbenchClient, offset = 0): Promise<void> {
    const result = await client.request("tasks.list", { offset }, page(task)); this.tasks = offset === 0 ? result : { ...result, items: [...this.tasks.items, ...result.items] };
    if (this.currentTask !== null) this.currentTask = await client.request("tasks.get", { id: this.currentTask.id }, task);
  }
  private async loadWriting(client: WorkbenchClient, offset = 0): Promise<void> {
    const result = await client.request("writing.list", { offset }, page(manuscript)); this.manuscripts = offset === 0 ? result : { ...result, items: [...this.manuscripts.items, ...result.items] };
  }
  private selectTab(tab: Tab): void {
    if (tab !== "Reader") this.viewer?.setReadingFocus(false);
    this.tab = tab; this.requestUpdate();
    if (tab === "Reader" && this.activeDocument === null && this.active?.deletedAt === null) {
      const document = this.active.documents[0];
      if (document !== undefined) this.run(() => this.openDocument(document));
    }
    if (tab === "Research") this.run(client => this.loadTasks(client));
    if (tab === "Writing") this.run(client => this.loadWriting(client));
    if (tab === "Evidence") this.run(client => this.loadEvidence(client));
  }
  private field(label: string, current: string, update: (value: string) => void, options: { area?: boolean; required?: boolean; max?: number; type?: string } = {}): TemplateResult {
    return html`<label>${label}${options.area === true ? html`<textarea .value=${current} maxlength=${options.max ?? 32_000} ?required=${options.required} @input=${(event: Event) => { this.change(() => { update(value(event)); }); }}></textarea>` : html`<input type=${options.type ?? "text"} .value=${current} maxlength=${options.max ?? 4000} ?required=${options.required} @input=${(event: Event) => { this.change(() => { update(value(event)); }); }}>`}</label>`;
  }
  private select(label: string, current: string, values: readonly string[], update: (value: string) => void): TemplateResult {
    return html`<label>${label}<select aria-label=${label} data-selection=${current} @change=${(event: Event) => { this.change(() => { update(value(event)); }); }}>${values.map(item => html`<option value=${item}>${item === "" ? "All" : item}</option>`)}</select></label>`;
  }
  protected override updated(): void {
    this.viewer?.toggleAttribute("annotation-open", this.tab === "Reader" && this.readerEvidenceOpen());
    if (this.focusEvidenceEditor) {
      this.focusEvidenceEditor = false;
      this.renderRoot.querySelector<HTMLTextAreaElement>(".reader-annotation textarea:not([readonly])")?.focus({ preventScroll: true });
    }
    // Lit commits a select's properties before its dynamic options. Synchronize only after insertion.
    for (const select of this.renderRoot.querySelectorAll<HTMLSelectElement>("select[data-selection]")) {
      const selected = select.getAttribute("data-selection");
      if (selected !== null && select.value !== selected) select.value = selected;
    }
  }
  private button(label: string, action: () => void, disabled = false): TemplateResult { return html`<button type="button" ?disabled=${this.busy || disabled} @click=${action}>${label}</button>`; }
  override render(): TemplateResult {
    if (this.binding === undefined) return html`<p>Choose a workspace to open the native Research Library.</p>`;
    const reading = this.tab === "Reader" && this.activeDocument !== null;
    return html`<header ?hidden=${reading}><div><h1>Research Library</h1><span class="muted">A place to read, connect and write.</span></div><span class="muted">${this.binding.workspace.label}</span></header>
      <div class="status" role="status" aria-live="polite">${this.busy ? "Working… " : ""}${this.notice}</div><div class="status" role="alert">${this.error}</div>
      <div class="layout ${reading ? "reading" : ""} ${this.readerLibraryVisible ? "with-library" : ""}" aria-busy=${String(this.busy)}><aside aria-label="Catalog" ?hidden=${reading && !this.readerLibraryVisible}>${this.renderCatalog()}</aside><main>
      <nav aria-label="Library workspace">${(["Reference", "Reader", "Evidence", "Research", "Writing", "Import & export"] satisfies Tab[]).map(tab => html`<button type="button" aria-pressed=${String(this.tab === tab)} @click=${() => { this.selectTab(tab); }}>${tab}</button>`)}</nav>
      <section ?hidden=${this.tab !== "Reference"} aria-label="Reference metadata">${this.renderReference()}</section>
      <section ?hidden=${this.tab !== "Reader"} aria-label="PDF reader">
        <div class="reader-heading">
          ${reading ? html`<button type="button" class="library-toggle" aria-expanded=${String(this.readerLibraryVisible)} @click=${() => { this.change(() => { this.readerLibraryVisible = !this.readerLibraryVisible; }); }}>${this.readerLibraryVisible ? "Hide library" : "Show library"}</button>` : nothing}
          <div class="reader-title"><h2>${this.active?.title ?? "Your reading space"}</h2><span class="muted">${this.activeDocument === null ? "Choose a reference and open its PDF." : this.activeDocument.label || this.activeDocument.path}</span></div>
          ${(this.active?.documents.length ?? 0) > 1 ? html`<select aria-label="Reading document" data-selection=${this.activeDocument?.id ?? ""} ?disabled=${this.busy} @change=${(event: Event) => { const doc = this.active?.documents.find(doc => doc.id === value(event)); if (doc !== undefined) this.run(() => this.openDocument(doc)); }}><option value="" disabled>Choose PDF</option>${this.active?.documents.map(doc => html`<option value=${doc.id}>${doc.label || doc.path}</option>`)}</select>` : nothing}
        </div>
        ${reading ? this.renderReaderAnnotations() : nothing}
        <div class="reader-session ${this.readerEvidenceOpen() ? "annotating" : ""}"><div id="reader"></div>
          <aside class="reader-annotation" aria-label="Passage annotation" ?hidden=${!this.readerEvidenceOpen()}>${this.tab === "Reader" && this.readerEvidenceOpen() ? this.renderEvidenceEditor(true) : nothing}</aside>
        </div>${this.renderReader()}</section>
      <section ?hidden=${this.tab !== "Evidence"} aria-label="Evidence notebook">${this.renderEvidence()}</section>
      <section ?hidden=${this.tab !== "Research"} aria-label="Research tasks">${this.renderResearch()}</section>
      <section ?hidden=${this.tab !== "Writing"} aria-label="Manuscript writing">${this.renderWriting()}</section>
      <section ?hidden=${this.tab !== "Import & export"} aria-label="Bibliography portability">${this.renderImport()}</section>
      </main></div>`;
  }
  private renderCatalog(): TemplateResult {
    return html`<h2>Library <span class="badge">${this.references.total}</span></h2>
      <form @submit=${(event: SubmitEvent) => { event.preventDefault(); this.run(client => this.loadLibrary(client)); }}><fieldset ?disabled=${this.busy}>
      ${this.field("Search metadata", this.query, v => { this.query = v; }, { max: 1000 })}
      <details><summary>Filters</summary><label>Collection<select aria-label="Collection" data-selection=${this.collectionFilter} @change=${(e: Event) => { this.change(() => { this.collectionFilter = value(e); }); }}><option value="">All collections</option>${this.collections.map(c => html`<option value=${c.id}>${c.name}</option>`)}</select></label>
      ${this.field("Tag", this.tagFilter, v => { this.tagFilter = v; }, { max: 256 })}
      ${this.select("Reading status", this.readingFilter, ["", "inbox", "reading", "read"], v => { this.readingFilter = v; })}
      ${this.select("Screening", this.screeningFilter, ["", "unscreened", "included", "excluded"], v => { this.screeningFilter = v; })}
      <label class="check"><input type="checkbox" .checked=${this.favoriteFilter} @change=${(e: Event) => { this.change(() => { this.favoriteFilter = checked(e); }); }}>Favorites only</label>
      <label class="check"><input type="checkbox" .checked=${this.trash} @change=${(e: Event) => { this.change(() => { this.trash = checked(e); }); }}>Trash</label></details>
      <button type="submit">Search / refresh library</button></fieldset></form>
      <div class="actions">${this.button("New reference", () => { this.newReference(); })}${this.button("Clear selection", () => { this.change(() => { this.selected.clear(); this.invalidateTask(); }); }, this.selected.size === 0)}</div>
      ${this.selected.size > 0 ? html`<p class="muted">${this.selected.size} selected across filters.</p>` : nothing}
      <ul class="cards">${this.references.items.map(ref => html`<li class="card ${ref.id === this.active?.id ? "active" : ""}"><label class="check"><input type="checkbox" aria-label=${`Select ${ref.title}`} .checked=${this.selected.has(ref.id)} ?disabled=${this.busy || ref.deletedAt !== null} @change=${(e: Event) => { this.change(() => { if (checked(e)) this.selected.set(ref.id, ref); else this.selected.delete(ref.id); this.invalidateTask(); }); }}>${ref.favorite ? "★" : ""} ${ref.citekey}</label>
        <button class="title" type="button" ?disabled=${this.busy} @click=${() => { this.run(async client => { await this.openReference(client, ref.id); this.tab = "Reference"; }); }}>${ref.title}</button>
        <p class="muted">${ref.authors.join("; ")} ${ref.year ?? ""}</p><span class="badge">${ref.deletedAt === null ? ref.readingStatus : "Trash"}</span> <span class="muted">${ref.screening}</span></li>`)}</ul>
      ${this.references.items.length === 0 ? html`<p>No references match. Add a reference or import a bibliography.</p>` : nothing}
      ${this.button("Load more references", () => { this.run(client => this.loadLibrary(client, this.references.nextOffset ?? 0)); }, this.references.nextOffset === null)}
      ${this.renderCollections()}`;
  }
  private renderCollections(): TemplateResult {
    return html`<details><summary>Manage collections</summary><ul class="cards">${this.collections.map(c => html`<li>${c.name}${c.parentId === null ? "" : " (nested)"} ${this.button(`Edit ${c.name}`, () => { this.change(() => { this.collectionDraft = { id: c.id, revision: c.revision, name: c.name, parentId: c.parentId ?? "" }; }); })}</li>`)}</ul>
      <form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => { const d = this.collectionDraft; await client.request("collections.save", { id: d.id, expectedRevision: d.revision, name: d.name, parentId: d.parentId === "" ? null : d.parentId }, collection); this.collections = await client.request("collections.list", {}, v => list(v, collection)); this.collectionDraft = { id: workbenchId("col"), revision: 0, name: "", parentId: "" }; }); }}><fieldset ?disabled=${this.busy}>
      ${this.field("Collection name", this.collectionDraft.name, v => { this.collectionDraft.name = v; }, { required: true, max: 256 })}
      <label>Parent collection<select aria-label="Parent collection" data-selection=${this.collectionDraft.parentId} @change=${(e: Event) => { this.change(() => { this.collectionDraft.parentId = value(e); }); }}><option value="">None</option>${this.collections.filter(c => c.id !== this.collectionDraft.id).map(c => html`<option value=${c.id}>${c.name}</option>`)}</select></label>
      <button type="submit">Save collection</button></fieldset></form>
      ${this.button("New collection", () => { this.change(() => { this.collectionDraft = { id: workbenchId("col"), revision: 0, name: "", parentId: "" }; }); })}
      ${this.button("Delete collection", () => { this.run(async client => { const d = this.collectionDraft; await client.request("collections.delete", { id: d.id, expectedRevision: d.revision }, object); this.collections = await client.request("collections.list", {}, v => list(v, collection)); this.collectionDraft = { id: workbenchId("col"), revision: 0, name: "", parentId: "" }; await this.loadLibrary(client); }); }, this.collectionDraft.revision === 0)}<p class="muted">Deletion preserves references. Nested collections may need moving first.</p></details>`;
  }
  private newReference(): void {
    if (this.drafts.referenceDirty || this.drafts.evidenceDirty) { this.error = "Save or discard pending metadata and evidence first."; this.requestUpdate(); return; }
    this.drafts.reference = { id: workbenchId("ref"), revision: 0, fields: emptyReferenceFields() }; this.drafts.referenceDirty = true; this.tab = "Reference"; this.requestUpdate();
  }
  private renderReference(): TemplateResult {
    const d = this.drafts.reference;
    return html`<h2>${d?.revision === 0 ? "New reference" : this.active?.title ?? "Reference details"}</h2>
      ${d === null ? html`<p>Choose a reference or create a new one. Standard bibliography files can be imported without a vendor account.</p>` : this.referenceForm(d)}
      ${this.active === null ? nothing : html`<details><summary>Identity & provenance</summary><p>Citekey aliases: ${this.active.aliases.join(", ") || "None"}</p><p>${this.active.provenance.join("\n") || "Manually curated"}</p><p class="muted">${this.active.id} · revision ${this.active.revision}</p></details>`}
      <details><summary>Duplicate review</summary>${this.button("Find duplicates", () => { this.run(async client => { this.duplicates = await client.request("library.duplicates", {}, v => list(object(v)["pairs"], item => { const r = object(item); return { leftId: text(r["leftId"]), rightId: text(r["rightId"]), reason: text(r["reason"]) }; })); }); })}
      ${this.duplicates.map(pair => html`<div class="card"><p>${pair.reason}</p><p class="muted">${pair.leftId} ↔ ${pair.rightId}</p>${this.button("Review merge", () => { this.run(async client => { if (this.drafts.referenceDirty || this.drafts.evidenceDirty) throw new Error("Save or discard pending edits before merging."); const keep = await client.request("library.get", { id: pair.leftId }, reference); const remove = await client.request("library.get", { id: pair.rightId }, reference); this.mergePair = { keep, remove }; }); })}</div>`)}
      ${this.mergePair === null ? nothing : html`<div class="notice"><h3>Confirm duplicate merge</h3><p>Keep: ${this.mergePair.keep.title} (${this.mergePair.keep.citekey})</p><p>Retire: ${this.mergePair.remove.title} (${this.mergePair.remove.citekey})</p><p>Files, tags, notes, aliases and provenance must be retained. Unsafe evidence merges are rejected by the server.</p>${this.button("Swap survivor", () => { this.change(() => { if (this.mergePair !== null) this.mergePair = { keep: this.mergePair.remove, remove: this.mergePair.keep }; }); })}${this.button("Confirm merge", () => { this.run(async client => { const pair = this.mergePair; if (pair === null) return; await client.request("library.merge", { keepId: pair.keep.id, removeId: pair.remove.id, keepRevision: pair.keep.revision, removeRevision: pair.remove.revision }, reference); this.mergePair = null; this.duplicates = []; this.selected.delete(pair.remove.id); await this.openReference(client, pair.keep.id); await this.loadLibrary(client); }); })}${this.button("Cancel merge", () => { this.change(() => { this.mergePair = null; }); })}</div>`}</details>`;
  }
  private referenceForm(d: ReferenceDraft): TemplateResult {
    const update = <K extends keyof ReferenceFields>(key: K, v: ReferenceFields[K]): void => { d.fields[key] = v; this.drafts.referenceDirty = true; };
    const textField = (label: string, key: "title" | "citekey" | "containerTitle" | "volume" | "issue" | "pages" | "publisher" | "doi" | "isbn" | "url" | "abstract" | "language" | "notes" | "screeningReason", area = false): TemplateResult => this.field(label, d.fields[key], v => { update(key, v); }, { area, required: key === "title" || key === "citekey", max: key === "title" || key === "containerTitle" ? 1000 : key === "abstract" ? 16_000 : area ? 32_000 : 4000 });
    return html`<form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(client => this.saveReference(client, d)); }}><fieldset ?disabled=${this.busy || (this.active?.id === d.id && this.active.deletedAt !== null)}><div class="grid">
      ${textField("Title", "title")}${textField("Citekey", "citekey")}${this.select("Reference type", d.fields.type, referenceTypes, v => { update("type", choice(v, referenceTypes)); })}
      ${this.field("Authors (one per line)", d.fields.authors.join("\n"), v => { update("authors", v.split("\n").filter(line => line.trim() !== "")); }, { area: true })}
      ${this.field("Year", d.fields.year === null ? "" : String(d.fields.year), v => { update("year", v === "" ? null : Number(v)); }, { type: "number", max: 4 })}
      ${textField("Journal / container", "containerTitle")}${textField("Volume", "volume")}${textField("Issue", "issue")}${textField("Pages", "pages")}${textField("Publisher", "publisher")}${textField("DOI", "doi")}${textField("ISBN", "isbn")}${textField("URL", "url")}${textField("Language", "language")}
      ${this.field("Tags (comma separated)", d.fields.tags.join(", "), v => { update("tags", split(v)); })}
      ${this.select("Read state", d.fields.readingStatus, ["inbox", "reading", "read"], v => { update("readingStatus", choice(v, ["inbox", "reading", "read"])); })}
      ${this.select("Screening decision", d.fields.screening, ["unscreened", "included", "excluded"], v => { update("screening", choice(v, ["unscreened", "included", "excluded"])); })}${textField("Screening reason", "screeningReason", true)}
      <label class="check"><input type="checkbox" .checked=${d.fields.favorite} @change=${(e: Event) => { this.change(() => { update("favorite", checked(e)); }); }}>Favorite</label>
      <fieldset><legend>Collections</legend>${this.collections.map(c => html`<label class="check"><input type="checkbox" .checked=${d.fields.collectionIds.includes(c.id)} @change=${(e: Event) => { this.change(() => { update("collectionIds", checked(e) ? [...d.fields.collectionIds, c.id] : d.fields.collectionIds.filter(id => id !== c.id)); }); }}>${c.name}</label>`)}</fieldset>
      <div class="wide">${textField("Abstract", "abstract", true)}${textField("Private notes", "notes", true)}</div></div><div class="actions"><button class="primary" type="submit">Save metadata</button><span>${this.drafts.referenceDirty ? "Unsaved metadata" : `Saved revision ${String(d.revision)}`}</span></div></fieldset></form>
      <div class="actions">${this.button("Discard metadata edits", () => { this.change(() => { const active = this.active; this.drafts.reference = active === null ? null : { id: active.id, revision: active.revision, fields: fields(active) }; this.drafts.referenceDirty = false; }); })}
      ${this.button(this.active?.deletedAt === null ? "Move reference to trash" : "Restore reference", () => { this.run(async client => { if (this.drafts.referenceDirty || this.drafts.evidenceDirty) throw new Error("Save or discard pending edits first."); const ref = this.active; if (ref === null) return; const result = await client.request(ref.deletedAt === null ? "library.delete" : "library.restore", { id: ref.id, expectedRevision: ref.revision }, reference); this.active = result; this.drafts.reference = { id: result.id, revision: result.revision, fields: fields(result) }; this.selected.delete(result.id); await this.loadLibrary(client); }); }, this.active?.id !== d.id)}
      ${this.button("Read documents", () => { this.selectTab("Reader"); }, this.active?.id !== d.id)}</div>`;
  }
  private async saveReference(client: WorkbenchClient, draft: ReferenceDraft): Promise<void> {
    if (this.drafts.evidenceDirty && this.drafts.evidence?.referenceId !== draft.id) {
      throw new Error("Save or discard pending evidence before saving metadata for a different reference.");
    }
    const result = await client.request("library.save", { id: draft.id, expectedRevision: draft.revision, fields: draft.fields }, reference);
    if (this.active?.id !== result.id) {
      this.activeDocument = null; this.pendingPage = null; this.viewer?.remove(); this.viewer = null;
      this.evidencePage = emptyPage(); this.appliedEvidenceFilters = null;
      // Restored drafts can exist without an active reader. Reset the reader, not unsaved evidence.
      if (!this.drafts.evidenceDirty) this.drafts.evidence = null;
    }
    this.active = result;
    this.drafts.reference = { id: result.id, revision: result.revision, fields: fields(result) };
    this.drafts.referenceDirty = false; this.notice = "Reference saved.";
    await this.loadLibrary(client);
  }
  private renderReader(): TemplateResult {
    const ref = this.active;
    return html`<details class="reader-tools" ?open=${this.activeDocument === null}><summary>Documents & research tools</summary>${ref === null ? html`<p>Choose a saved reference to attach or read documents.</p>` : html`
      <ul class="cards">${ref.documents.map(doc => html`<li class="card"><div class="actions">${this.button(doc.label || doc.path, () => { this.run(() => this.openDocument(doc)); }, ref.deletedAt !== null)}<span>${(doc.size / 1024 / 1024).toFixed(1)} MiB</span></div><p class="muted">${doc.path}</p><details><summary>PDF identity & provenance</summary><p>Source: ${doc.sourceUrl || "Not supplied"}</p><p>Rights: ${doc.rights || "Not supplied"}</p><p>Added: ${doc.addedAt}</p><code>SHA-256 ${doc.sha256}</code></details></li>`)}</ul>
      ${ref.documents.length === 0 ? html`<p>No PDF attached yet.</p>` : nothing}
      <details><summary>Attach a PDF</summary><p class="muted">Files stay local. Uploads never overwrite; attachment identity is verified by the server. Maximum 128 MiB per PDF, 16 documents per reference.</p>
      <form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(client => this.attachDocument(client)); }}><fieldset ?disabled=${this.busy || ref.deletedAt !== null}>
      <div class="grid">${this.field("Contained workspace PDF path", this.attachment.path, v => { this.attachment.path = v; }, { required: true, max: 1024 })}${this.field("Document label", this.attachment.label, v => { this.attachment.label = v; }, { max: 256 })}${this.field("Source URL", this.attachment.sourceUrl, v => { this.attachment.sourceUrl = v; })}${this.field("Rights / license", this.attachment.rights, v => { this.attachment.rights = v; })}</div>
      <button type="submit">Attach existing PDF</button><label>Upload local PDF<input type="file" accept="application/pdf,.pdf" @change=${(e: Event) => { this.uploadPdf(e); }}></label></fieldset></form>
      <p role="status">${this.uploadProgress}</p>${this.uploadCancel === undefined ? nothing : html`<button type="button" @click=${() => this.uploadCancel?.()}>Cancel upload</button>`}</details>`}
      <details><summary>Verified full-text search</summary><p>Search the selected corpus, or the current reference. Text is extracted on the server; unreadable or image-only pages remain explicit.</p>
      <form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => { const ids = this.selected.size > 0 ? [...this.selected.keys()] : ref === null ? [] : [ref.id]; if (ids.length === 0 || ids.length > 20) throw new Error("Choose 1–20 references for text search."); this.hits = await client.request("library.text.search", { query: this.textQuery, referenceIds: ids }, v => list(v, textHit)); }); }}><fieldset ?disabled=${this.busy}>${this.field("Search document text", this.textQuery, v => { this.textQuery = v; }, { required: true, max: 300 })}<button type="submit">Search text</button></fieldset></form>
      ${this.button("Index current PDF", () => { this.indexDocument(false); }, this.activeDocument === null)}
      ${this.button("Rebuild current text index", () => { this.indexDocument(true); }, this.activeDocument === null)}
      <p class="muted">Every attached PDF in the search scope needs an index. Rebuild explicitly replaces only the derivative index after re-verifying the unchanged PDF; ordinary reads never silently repair corruption.</p>
      ${this.hits.map(hit => html`<article class="card"><p>${hit.excerpt}</p>${this.button(`Open page ${String(hit.page)}`, () => { this.run(async client => { if (this.active?.id !== hit.referenceId) await this.openReference(client, hit.referenceId); const doc = this.active?.documents.find(item => item.id === hit.documentId && item.sha256 === hit.pdfSha256); if (doc === undefined) throw new Error("Search hit no longer matches the document identity. Search again."); await this.openDocument(doc, hit.page); }); })}</article>`)}</details>
      ${this.activeDocument === null ? nothing : html`<p class="muted">Use Mark region to create anchored evidence without leaving Reader. Markers reflect loaded notebook records; clear evidence filters or load more to see additional markers. Reader Find searches this PDF directly; verified corpus search above uses server indexes.</p>`}</details>`;
  }
  private indexDocument(rebuild: boolean): void {
    this.run(async client => {
      if (this.active === null || this.activeDocument === null) return;
      const result = await client.request("library.text.index", { referenceId: this.active.id, documentId: this.activeDocument.id, ...(rebuild ? { rebuild: true } : {}) }, object);
      this.notice = `Text index ready. ${list(result["warnings"], text).join(" ")}`;
    });
  }
  private async attachDocument(client: WorkbenchClient): Promise<void> {
    if (this.active === null) throw new Error("Select a saved reference first.");
    if (this.drafts.referenceDirty) throw new Error("Save metadata before attaching a document.");
    const result = await client.request("library.attach", { referenceId: this.active.id, expectedRevision: this.active.revision, ...this.attachment }, reference);
    this.active = result; this.drafts.reference = { id: result.id, revision: result.revision, fields: fields(result) }; this.notice = "PDF attached and verified.";
  }
  private uploadPdf(event: Event): void {
    const input = event.currentTarget; if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0]; input.value = ""; if (file === undefined) return;
    this.run(async client => {
      if (this.active === null || this.drafts.referenceDirty) throw new Error("Select a saved reference and save metadata before uploading.");
      if (file.size === 0 || file.size > LIBRARY_MAX_PDF_BYTES || !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Choose a nonempty PDF no larger than 128 MiB.");
      const files = client.context.files; if (files.capabilityVersion !== 1) throw new Error("This host does not support uploads. Attach a contained workspace path instead.");
      const epoch = this.epoch;
      const upload = files.uploadFile(file, { destinationFolder: "raw/research-library", createDirs: true, overwrite: false, onProgress: progress => { if (epoch === this.epoch) { this.uploadProgress = `Uploading ${String(Math.round(progress.percent))}%`; this.requestUpdate(); } } });
      this.uploadCancel = () => { upload.cancel(); }; this.requestUpdate();
      try { await upload.completed; client.signal.throwIfAborted(); this.attachment.path = upload.path; if (this.attachment.label === "") this.attachment.label = file.name; this.uploadProgress = `Uploaded to ${upload.path}. If attachment fails, retry the existing path; the uploaded file is retained.`; await this.attachDocument(client); }
      finally { if (epoch === this.epoch) this.uploadCancel = undefined; }
    });
  }
  private async openDocument(doc: LibraryDocument, targetPage?: number): Promise<void> {
    if (this.drafts.evidenceDirty) throw new Error("Save or discard pending evidence before changing document.");
    const context = this.binding; const ref = this.active;
    if (context === undefined || ref === null) throw new Error("Select a reference first.");
    if (context.peer?.request === undefined) throw new Error("Verified PDF reading requires the paired Research Library server.");
    if (context.files.capabilityVersion !== 1) throw new Error("The host must provide the public PDF download helper.");
    const epoch = this.epoch;
    this.tab = "Reader"; this.activeDocument = doc; this.requestUpdate(); await this.updateComplete;
    if (epoch !== this.epoch || !this.isConnected) return;
    if (this.viewer === null) {
      this.viewer = new ResearchLibraryPdfViewerElement();
      this.viewer.addEventListener(researchPdfReadyEventName, (event: Event) => {
        if (!(event instanceof CustomEvent) || this.pendingPage === null) return;
        const detail: unknown = event.detail;
        if (object(detail)["sourceUrl"] !== this.pendingPage.sourceUrl) return;
        this.viewer?.showPage(this.pendingPage.page); this.pendingPage = null;
      });
      this.viewer.addEventListener(researchPdfSelectionEventName, (event: Event) => {
        if (!(event instanceof CustomEvent)) return;
        // The bundled viewer owns this event; no browser text is treated as verified full text.
        try {
          const detail: unknown = event.detail;
          const r = object(detail); const rect = object(r["rect"]);
          const number = (v: unknown): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Invalid reader selection"); return v; };
          this.markEvidence({ page: number(r["page"]), quote: text(r["quote"]), rect: { x: number(rect["x"]), y: number(rect["y"]), width: number(rect["width"]), height: number(rect["height"]) } });
        } catch (error) { this.error = error instanceof Error ? error.message : "Invalid reader selection"; this.requestUpdate(); }
      });
      this.viewer.addEventListener(researchPdfAnnotationEventName, (event: Event) => { if (event instanceof CustomEvent) { const detail: unknown = event.detail; const id = typeof detail === "string" ? detail : object(detail)["id"]; const item = this.evidencePage.items.find(item => item.id === id); if (item !== undefined) this.editEvidence(item, "Reader"); } });
      this.renderRoot.querySelector("#reader")?.append(this.viewer);
    }
    const source: PdfPeerSource = { peer: context.peer, referenceId: ref.id, documentId: doc.id, expectedSha256: doc.sha256 };
    this.viewer.pdfPeerSource = source;
    const sourceUrl = context.files.downloadUrl(doc.path, { version: doc.sha256 });
    const alreadyLoaded = this.viewer.sourceUrl === sourceUrl && this.viewer.pageCount > 0;
    this.pendingPage = targetPage === undefined ? null : { sourceUrl, page: targetPage };
    this.viewer.sourceUrl = sourceUrl;
    if (alreadyLoaded && targetPage !== undefined) { this.viewer.showPage(targetPage); this.pendingPage = null; }
    this.updateMarkers();
  }
  private updateMarkers(): void {
    if (this.viewer === null) return;
    this.viewer.annotations = this.evidencePage.items.flatMap(item => item.documentId === this.activeDocument?.id && item.pdfSha256 === this.activeDocument.sha256 && item.rect !== null && item.page !== null && item.deletedAt === null ? [{ id: item.id, page: item.page, rect: item.rect, kind: item.kind === "question" ? "question" : "note", status: item.status, label: item.body || item.quote }] : []);
  }
  private markEvidence(selection?: ResearchPdfSelectionDetail): void {
    if (selection !== undefined && selection.quote.length > 16_000) { this.error = "The captured quote exceeds 16,000 characters. Mark a smaller region; quotes are never silently truncated."; this.requestUpdate(); return; }
    if (this.busy || this.drafts.evidenceDirty) { this.error = "Save or discard pending evidence before starting another note."; this.requestUpdate(); return; }
    if (this.active === null) { this.error = "Choose a saved reference first."; this.requestUpdate(); return; }
    const doc = selection === undefined ? null : this.activeDocument;
    if (selection !== undefined && doc === null) return;
    this.drafts.evidence = { id: workbenchId("ev"), expectedRevision: 0, referenceId: this.active.id, documentId: doc?.id ?? null, pdfSha256: doc?.sha256 ?? null, page: selection?.page ?? null, rect: selection?.rect ?? null, quote: selection?.quote ?? "", body: "", kind: selection === undefined ? "note" : "quote", status: "open", tags: [] };
    this.drafts.evidenceDirty = true; this.tab = selection === undefined ? "Evidence" : "Reader"; this.focusEvidenceEditor = selection !== undefined; this.requestUpdate();
  }
  private renderReaderAnnotations(): TemplateResult {
    const doc = this.activeDocument;
    const items = this.evidencePage.items.filter(item => item.referenceId === this.active?.id && item.documentId === doc?.id && item.pdfSha256 === doc.sha256 && item.page !== null && item.deletedAt === null);
    return html`<details class="reader-annotations"><summary>Saved annotations (${items.length} loaded)</summary>
      <p class="muted">Choose a passage even when its markers overlap. This list uses the notebook's current filters and loaded records.</p>
      <div class="annotation-list">${items.map(item => this.button(`Page ${String(item.page)}: ${item.body || item.quote}`, () => { this.run(async () => {
        if (doc === null || item.page === null) return;
        await this.openDocument(doc, item.page);
        this.editEvidence(item, "Reader");
        const details = this.renderRoot.querySelector<HTMLDetailsElement>(".reader-annotations");
        if (details !== null) details.open = false;
      }); }))}</div>
      <div class="actions">${this.button("Refresh annotations", () => { this.run(client => this.loadEvidence(client)); })}${this.button("Load more annotations", () => { this.run(client => this.loadEvidence(client, this.evidencePage.nextOffset ?? 0)); }, this.evidencePage.nextOffset === null)}</div>
    </details>`;
  }
  private readerEvidenceOpen(): boolean {
    const d = this.drafts.evidence;
    return d !== null && this.active?.id === d.referenceId && this.activeDocument?.id === d.documentId && this.activeDocument.sha256 === d.pdfSha256;
  }
  private editEvidence(item: LibraryEvidence, destination: Tab = "Evidence"): void {
    if (this.drafts.evidenceDirty) { this.error = "Save or discard pending evidence first."; this.requestUpdate(); return; }
    this.drafts.evidence = { id: item.id, expectedRevision: item.revision, referenceId: item.referenceId, documentId: item.documentId, pdfSha256: item.pdfSha256, page: item.page, rect: item.rect, quote: item.quote, body: item.body, kind: item.kind, status: item.status, tags: [...item.tags] }; this.tab = destination;
    this.focusEvidenceEditor = destination === "Reader";
    if (this.viewer !== null) this.viewer.activeAnnotationId = item.id;
    this.requestUpdate();
  }
  private renderEvidence(): TemplateResult {
    return html`<h2>Evidence notebook</h2><p>${this.active?.title ?? "All references"}</p><div class="actions">${this.button("New unanchored note", () => { this.markEvidence(); }, this.active?.deletedAt !== null)}${this.button("Refresh evidence", () => { this.run(client => this.loadEvidence(client)); })}</div>
      <details><summary>Filter evidence</summary><fieldset ?disabled=${this.busy}>${this.field("Search evidence", this.evidenceQuery, v => { this.evidenceQuery = v; }, { max: 200 })}${this.select("Evidence kind", this.evidenceKind, ["", "quote", "note", "question"], v => { this.evidenceKind = v; })}${this.select("Evidence status", this.evidenceStatus, ["", "open", "resolved"], v => { this.evidenceStatus = v; })}<label class="check"><input type="checkbox" .checked=${this.evidenceTrash} @change=${(e: Event) => { this.change(() => { this.evidenceTrash = checked(e); }); }}>Deleted evidence (recovery retained)</label></fieldset></details>
      ${this.tab === "Evidence" ? this.renderEvidenceEditor(false) : nothing}
      <p>${this.evidencePage.total} evidence records</p>${this.evidencePage.items.map(item => html`<article class="card"><h3>${item.kind} <span class="badge">${item.deletedAt === null ? item.status : "Deleted"}</span></h3><blockquote>${item.quote}</blockquote><p class="prose">${item.body}</p><p class="muted">${item.tags.join(", ")} · revision ${item.revision}</p><div class="actions">
      ${this.button(item.page === null ? "Unanchored" : `Read quote on page ${String(item.page)}`, () => { this.run(async client => { if (this.active?.id !== item.referenceId) await this.openReference(client, item.referenceId); const doc = this.active?.documents.find(doc => doc.id === item.documentId && doc.sha256 === item.pdfSha256); if (doc === undefined || item.page === null) throw new Error("The evidence document is missing or its identity changed."); await this.openDocument(doc, item.page); if (this.viewer !== null) this.viewer.activeAnnotationId = item.id; }); }, item.page === null)}
      ${this.button("Edit evidence", () => { this.editEvidence(item); }, item.deletedAt !== null)}${this.button("Delete evidence", () => { this.run(async client => { if (this.drafts.evidenceDirty) throw new Error("Save or discard pending evidence first."); await client.request("evidence.delete", { id: item.id, expectedRevision: item.revision }, evidence); if (this.drafts.evidence?.id === item.id) this.drafts.evidence = null; this.notice = "Evidence deleted; .deleted recovery data is retained, not securely erased."; await this.loadEvidence(client); }); }, item.deletedAt !== null)}</div></article>`)}
      ${this.button("Load more evidence", () => { this.run(client => this.loadEvidence(client, this.evidencePage.nextOffset ?? 0)); }, this.evidencePage.nextOffset === null)}`;
  }
  private renderEvidenceEditor(inReader: boolean): TemplateResult | typeof nothing {
    const d = this.drafts.evidence;
    if (d === null) return nothing;
    return html`<form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => {
      const result = await client.request("evidence.save", d, evidence);
      this.drafts.evidenceDirty = false;
      this.editEvidence(result, inReader ? "Reader" : "Evidence");
      this.notice = "Evidence saved. Anchors retain the original PDF identity.";
      await this.loadEvidence(client);
    }); }}><fieldset ?disabled=${this.busy}>
      <h3>${d.expectedRevision === 0 ? "New evidence" : "Edit evidence"}</h3>
      <p class="muted">${d.page === null ? "Unanchored note — no PDF provenance claimed" : `Anchored to page ${String(d.page)}`}</p>
      ${this.field("Evidence note / question", d.body, v => { d.body = v; this.drafts.evidenceDirty = true; }, { area: true, required: true, max: 16_000 })}
      <div class="actions"><button class="primary" type="submit">Save evidence</button><span role="status">${this.drafts.evidenceDirty ? "Unsaved evidence" : "Saved"}</span></div>
      <details ?open=${!inReader}><summary>Quote, source & annotation details</summary>
        <label>Captured quote<textarea .value=${d.quote} readonly></textarea></label>
        <p class="muted">Original quote and anchor are immutable. Add corrections in your note.</p><code>${d.pdfSha256 ?? "No PDF identity"}</code>
        <div class="grid">${this.select("Kind", d.kind, ["quote", "note", "question"], v => { d.kind = choice(v, ["quote", "note", "question"]); this.drafts.evidenceDirty = true; })}${this.select("Status", d.status, ["open", "resolved"], v => { d.status = choice(v, ["open", "resolved"]); this.drafts.evidenceDirty = true; })}${this.field("Evidence tags", d.tags.join(", "), v => { d.tags = split(v); this.drafts.evidenceDirty = true; })}</div>
      </details>
    </fieldset></form><div class="actions">${this.button(inReader && !this.drafts.evidenceDirty ? "Close annotation" : "Discard evidence edits", () => {
      this.change(() => { this.drafts.evidence = null; this.drafts.evidenceDirty = false; });
      if (inReader) this.viewer?.focusPage();
    })}</div>`;
  }
  private invalidateTask(): void { this.taskPreview = null; this.modelConsent = false; }
  private stopPolling(): void { if (this.pollTimer !== undefined) clearTimeout(this.pollTimer); this.pollTimer = undefined; this.pollRemaining = 0; }
  private pollTasks(): void {
    this.stopPolling(); this.pollRemaining = 30;
    const deadline = Date.now() + 90_000;
    const tick = (): void => {
      if (this.pollRemaining === 0 || !this.isConnected) return;
      this.pollTimer = setTimeout(() => {
        if (Date.now() > deadline) { this.stopPolling(); this.requestUpdate(); return; }
        if (this.busy) { tick(); return; }
        this.pollRemaining--;
        this.run(async client => { await this.loadTasks(client); if (!this.tasks.items.some(item => item.status === "running" || item.status === "starting")) this.stopPolling(); });
        tick();
      }, 3000);
    };
    tick(); this.requestUpdate();
  }
  private renderResearch(): TemplateResult {
    const preview = this.taskPreview;
    return html`<h2>Research tasks</h2><p class="notice">Model outputs are proposals, not verified truth. Preview discloses the exact selected corpus and prompt. Nothing runs until you explicitly confirm. Acceptance records review; it does not resolve evidence or modify files.</p>
      <form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => {
        const ids = [...this.selected.keys()]; if (ids.length === 0 || ids.length > 20) throw new Error("Select 1–20 references for the task corpus.");
        const kind = this.taskKind; const goal = this.taskGoal;
        const result = await client.request("tasks.preview", { kind, goal, referenceIds: ids }, object);
        this.taskPreview = { id: workbenchId("task"), kind, goal, referenceIds: list(result["referenceIds"], text), corpusHash: text(result["corpusHash"]), prompt: text(result["prompt"]), warnings: list(result["warnings"], text) }; this.modelConsent = false;
      }); }}><fieldset ?disabled=${this.busy}><div class="grid">${this.select("Task recipe", this.taskKind, libraryTaskKinds, v => { this.taskKind = choice(v, libraryTaskKinds); this.invalidateTask(); })}${this.field("Research goal", this.taskGoal, v => { this.taskGoal = v; this.invalidateTask(); }, { area: true, required: true, max: 8000 })}</div>
      <h3>Selected corpus (${this.selected.size}/20)</h3><ul>${[...this.selected.values()].map(ref => html`<li>${ref.title} — ${ref.citekey}</li>`)}</ul><button type="submit">Preview model disclosure</button></fieldset></form>
      ${preview === null ? nothing : html`<div class="card"><h3>Model disclosure preview</h3><p>${preview.referenceIds.length} references; evidence and text may be sent to the configured model provider by a dedicated host session.</p><code>Corpus ${preview.corpusHash}</code>${preview.warnings.map(warning => html`<p class="notice">${warning}</p>`)}<details open><summary>Exact task prompt</summary><pre>${preview.prompt}</pre></details>
        <label class="check"><input type="checkbox" .checked=${this.modelConsent} ?disabled=${this.busy} @change=${(e: Event) => { this.change(() => { this.modelConsent = checked(e); }); }}>I consent to running this task with this disclosed corpus.</label>
        ${this.button("Confirm and start model task", () => { this.run(async client => { if (!this.modelConsent || this.taskPreview !== preview) throw new Error("Review the disclosure and consent again."); const started = await client.request("tasks.start", { id: preview.id, kind: preview.kind, goal: preview.goal, referenceIds: preview.referenceIds, expectedCorpusHash: preview.corpusHash }, task); this.currentTask = started; this.invalidateTask(); this.taskGoal = ""; this.notice = "Task admitted. Follow its session and structured result below."; await this.loadTasks(client); this.pollTasks(); }); }, !this.modelConsent)}
        ${this.button("Cancel disclosure", () => { this.change(() => { this.invalidateTask(); }); })}</div>`}
      <div class="actions">${this.button("Refresh tasks", () => { this.run(client => this.loadTasks(client)); })}${this.button("Watch progress (90 seconds)", () => { this.pollTasks(); }, this.pollRemaining > 0)}${this.pollRemaining > 0 ? html`<button type="button" @click=${() => { this.change(() => { this.stopPolling(); }); }}>Stop watching (${this.pollRemaining} checks left)</button>` : nothing}</div>
      <ul class="cards">${this.tasks.items.map(item => html`<li class="card"><button class="title" type="button" ?disabled=${this.busy} @click=${() => { this.run(async client => { this.currentTask = await client.request("tasks.get", { id: item.id }, task); }); }}>${item.kind}: ${item.goal}</button><p><span class="badge">${item.status}</span> ${item.review}</p><p>${item.message}</p><p class="muted">${item.updatedAt}</p></li>`)}</ul>
      ${this.button("Load more tasks", () => { this.run(client => this.loadTasks(client, this.tasks.nextOffset ?? 0)); }, this.tasks.nextOffset === null)}
      ${this.currentTask === null ? nothing : this.renderTask(this.currentTask)}`;
  }
  private referenceLabel(id: string): string { return this.selected.get(id)?.citekey ?? this.references.items.find(ref => ref.id === id)?.citekey ?? (this.active?.id === id ? this.active.citekey : id); }
  private renderTask(item: LibraryTask): TemplateResult {
    const result = item.result;
    return html`<article class="card"><h3>${item.kind}: ${item.goal}</h3><p><span class="badge">${item.status}</span> · ${item.review}</p><p>${item.message}</p><details><summary>Session & frozen corpus identity</summary><p>Machine: ${this.binding?.machine.id}</p><p>Project: ${this.binding?.workspace.projectId} / workspace: ${this.binding?.workspace.id}</p><p>Session: <code>${item.sessionId || "Not assigned"}</code></p><p>Task: <code>${item.id}</code> · revision ${item.revision}</p><p>Corpus: <code>${item.corpusHash}</code></p><ul>${item.corpus.map(binding => html`<li>${this.referenceLabel(binding.referenceId)} · revision ${binding.revision}<ul>${binding.documentHashes.map(hash => html`<li><code>${hash}</code></li>`)}${binding.evidence.map(e => html`<li>Evidence ${e.id} · revision ${e.revision}</li>`)}</ul></li>`)}</ul></details>
      ${result === null ? html`<p>No validated structured result yet. Failed or interrupted sessions do not count as completed evidence.</p>` : html`<h3>Proposed result</h3><pre>${result.markdown}</pre>${result.warnings.map(w => html`<p class="notice">${w}</p>`)}
      <h3>Claims & evidence</h3>${result.claims.map(claim => html`<article class="card"><span class="badge">${claim.relationship}</span><p>${claim.text}</p><div class="actions">${claim.referenceIds.map(id => this.button(`Read ${this.referenceLabel(id)}`, () => { this.run(async client => { await this.openReference(client, id); this.tab = "Reference"; }); }))}</div><p class="muted">Evidence: ${claim.evidenceIds.join(", ") || "No evidence cited — review carefully"}</p></article>`)}
      <h3>Extraction matrix</h3>${result.cells.length === 0 ? html`<p>No matrix cells submitted.</p>` : html`<div class="scroll"><table><caption>Structured extraction; check each value against its source</caption><thead><tr><th scope="col">Reference</th><th scope="col">Column</th><th scope="col">Value</th><th scope="col">Evidence</th></tr></thead><tbody>${result.cells.map(cell => html`<tr><th scope="row">${this.referenceLabel(cell.referenceId)}</th><td>${cell.column}</td><td>${cell.value}</td><td>${cell.evidenceIds.join(", ") || "None"}</td></tr>`)}</tbody></table></div>`}
      <p class="notice">Review source attribution, unsupported claims and quote accuracy before accepting. The server rechecks frozen corpus freshness.</p><div class="actions">
      ${this.button("Accept reviewed result", () => { this.reviewTask(item, "accepted"); }, item.review !== "unreviewed" || item.status !== "completed")}
      ${this.button("Reject result", () => { this.reviewTask(item, "rejected"); }, item.review !== "unreviewed" || item.status !== "completed")}
      ${this.button("Create manuscript from accepted result", () => { this.draftFromTask(item); }, item.review !== "accepted")}</div>`}</article>`;
  }
  private reviewTask(item: LibraryTask, decision: "accepted" | "rejected"): void { this.run(async client => { this.currentTask = await client.request("tasks.review", { id: item.id, expectedRevision: item.revision, decision }, task); await this.loadTasks(client); }); }
  private draftFromTask(item: LibraryTask): void {
    if (this.drafts.writingDirty) { this.error = "Save or discard your manuscript draft first."; this.requestUpdate(); return; }
    if (item.review !== "accepted" || item.result === null) return;
    this.drafts.writing = { id: workbenchId("ms"), expectedRevision: 0, title: `${item.kind}: ${item.goal}`, markdown: item.result.markdown, referenceIds: [...item.referenceIds], taskIds: [item.id], style: "apa" }; this.writingChanged(); this.tab = "Writing"; this.requestUpdate();
  }
  private writingChanged(): void { this.drafts.writingDirty = true; this.audit = null; this.applyPreview = null; this.applyConsent = false; }
  private newManuscript(): void {
    if (this.drafts.writingDirty) { this.error = "Save or discard your manuscript draft first."; this.requestUpdate(); return; }
    this.drafts.writing = { id: workbenchId("ms"), expectedRevision: 0, title: "", markdown: "", referenceIds: [], taskIds: [], style: "apa" }; this.writingChanged(); this.requestUpdate();
  }
  private editManuscript(item: LibraryManuscript): void {
    if (this.drafts.writingDirty) { this.error = "Save or discard your manuscript draft first."; this.requestUpdate(); return; }
    this.drafts.writing = { id: item.id, expectedRevision: item.revision, title: item.title, markdown: item.markdown, referenceIds: [...item.referenceIds], taskIds: [...item.taskIds], style: item.style }; this.audit = null; this.applyPreview = null; this.applyConsent = false; this.requestUpdate();
  }
  private renderWriting(): TemplateResult {
    const d = this.drafts.writing;
    const candidates = [...new Map([...this.references.items, ...this.selected.values(), ...(this.active === null ? [] : [this.active])].filter(ref => ref.deletedAt === null).map(ref => [ref.id, ref])).values()];
    const saved = d !== null && d.expectedRevision > 0 && !this.drafts.writingDirty;
    return html`<h2>Manuscripts</h2><div class="actions">${this.button("New manuscript", () => { this.newManuscript(); })}${this.button("Refresh manuscripts", () => { this.run(client => this.loadWriting(client)); })}</div>
      <ul class="cards">${this.manuscripts.items.map(item => html`<li><button class="title" type="button" ?disabled=${this.busy} @click=${() => { this.editManuscript(item); }}>${item.title}</button> <span class="muted">revision ${item.revision} · ${item.style}</span></li>`)}</ul>${this.button("Load more manuscripts", () => { this.run(client => this.loadWriting(client, this.manuscripts.nextOffset ?? 0)); }, this.manuscripts.nextOffset === null)}
      ${d === null ? html`<p>Create a manuscript, or start from an accepted research result. Draft text is never automatically applied to workspace files.</p>` : html`<form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => { const result = await client.request("writing.save", d, manuscript); this.drafts.writingDirty = false; this.editManuscript(result); this.notice = "Manuscript saved in the native library, not applied to a workspace file."; await this.loadWriting(client); }); }}><fieldset ?disabled=${this.busy}>
      <div class="grid">${this.field("Manuscript title", d.title, v => { d.title = v; this.writingChanged(); }, { required: true, max: 1000 })}${this.select("Citation style", d.style, ["apa", "vancouver", "harvard1"], v => { d.style = choice(v, ["apa", "vancouver", "harvard1"]); this.writingChanged(); })}</div>
      <label>Markdown manuscript<textarea class="editor" .value=${d.markdown} maxlength="128000" @input=${(e: Event) => { this.change(() => { d.markdown = value(e); this.writingChanged(); }); }}></textarea></label><p class="muted">Pandoc citations: [@citekey]. Markdown remains plain text here; embedded markup never executes.</p>
      <label>Citation picker<select aria-label="Citation picker" data-selection=${this.citationId} @change=${(e: Event) => { this.change(() => { this.citationId = value(e); }); }}><option value="">Choose a reference from the catalog / selection</option>${candidates.map(ref => html`<option value=${ref.id}>${ref.citekey} — ${ref.title}</option>`)}</select></label>
      ${this.button("Insert citation", () => { this.change(() => { const ref = candidates.find(ref => ref.id === this.citationId); if (ref === undefined) return; const editor = this.renderRoot.querySelector<HTMLTextAreaElement>(".editor"); const start = editor?.selectionStart ?? d.markdown.length; const end = editor?.selectionEnd ?? start; const token = `[@${ref.citekey}]`; if (d.markdown.length - (end - start) + token.length > 128_000) { this.error = "Manuscript exceeds the text limit."; return; } d.markdown = d.markdown.slice(0, start) + token + d.markdown.slice(end); if (!d.referenceIds.includes(ref.id)) d.referenceIds.push(ref.id); this.writingChanged(); }); }, this.citationId === "")}
      <details><summary>Draft source bindings</summary><ul>${d.referenceIds.map(id => html`<li>${this.referenceLabel(id)} ${this.button("Remove reference binding", () => { this.change(() => { d.referenceIds = d.referenceIds.filter(item => item !== id); this.writingChanged(); }); })}</li>`)}</ul><p>Accepted tasks: ${d.taskIds.length === 0 ? "None" : ""}</p><ul>${d.taskIds.map(id => html`<li>${id} ${this.button("Remove task binding", () => { this.change(() => { d.taskIds = d.taskIds.filter(item => item !== id); this.writingChanged(); }); })}</li>`)}</ul><p class="muted">Removing a task binding preserves draft text, but its old acceptance no longer applies to this draft. Review the sources again.</p><p class="muted">Removing a binding does not edit citation text. Run audit before exporting.</p></details>
      <div class="actions"><button class="primary" type="submit">Save manuscript</button><span>${this.drafts.writingDirty ? "Unsaved manuscript" : `Saved revision ${String(d.expectedRevision)}`}</span></div></fieldset></form>
      <div class="actions">${this.button("Discard manuscript edits", () => { this.change(() => { this.drafts.writing = null; this.drafts.writingDirty = false; this.audit = null; this.applyPreview = null; }); })}${this.button("Delete manuscript", () => { this.run(async client => { await client.request("writing.delete", { id: d.id, expectedRevision: d.expectedRevision }, object); this.drafts.writing = null; this.drafts.writingDirty = false; this.applyPreview = null; await this.loadWriting(client); }); }, !saved)}
      ${this.button("Audit citations & evidence", () => { this.run(async client => { this.audit = await client.request("writing.audit", { id: d.id }, v => { const r = object(v); return { issues: list(r["issues"], item => { const issue = object(item); return { kind: text(issue["kind"]), message: text(issue["message"]), ...(issue["key"] === undefined ? {} : { key: text(issue["key"]) }) }; }), citationKeys: list(r["citationKeys"], text), bibliography: text(r["bibliography"]) }; }); }); }, !saved)}</div>
      ${this.audit === null ? nothing : html`<article class="card"><h3>Citation & evidence audit</h3><p class="notice">Deterministic checks are not a guarantee of scientific correctness. Quote interpretation and claim support require human judgment.</p>${this.audit.issues.length === 0 ? html`<p>No audit issues reported.</p>` : html`<ul>${this.audit.issues.map(issue => html`<li><strong>${issue.kind}</strong>: ${issue.message} ${issue.key ?? ""}</li>`)}</ul>`}<p>Keys: ${this.audit.citationKeys.join(", ")}</p><h3>Formatted bibliography</h3><pre>${this.audit.bibliography}</pre></article>`}
      <h3>Portable export</h3><p class="muted">Save edits before export. Bundles include bibliography and evidence mapping; drafts are not accepted truth.</p><div class="actions">${(["markdown", "latex", "html", "bundle"] as const).map(format => this.button(`Export ${format}`, () => { this.run(async client => { this.saveDownload(await client.request("writing.export", { id: d.id, format }, download)); }); }, !saved))}</div>
      <h3>Apply to workspace file</h3><p class="notice">Explicit Markdown/text targets only. The server checks revision, existing hash and path safety, and backs up replaced content. PDFs, library storage, source, config and executable paths are never valid targets.</p>
      <form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => { this.applyConsent = false; const path = this.applyPath; const result = await client.request("writing.apply.preview", { id: d.id, path }, object); this.applyPreview = { id: d.id, revision: d.expectedRevision, path, expectedHash: result["expectedHash"] === null ? null : text(result["expectedHash"]), previewToken: text(result["previewToken"]), text: text(result["text"]), diff: text(result["diff"]) }; this.applyConsent = false; }); }}><fieldset ?disabled=${this.busy || !saved}>${this.field("Workspace target path", this.applyPath, v => { this.applyPath = v; this.applyPreview = null; this.applyConsent = false; }, { required: true, max: 1024 })}<button type="submit">Preview file changes</button></fieldset></form>
      ${this.applyPreview === null ? nothing : this.renderApply(this.applyPreview)}`}`;
  }
  private renderApply(preview: ApplyPreview): TemplateResult {
    return html`<article class="card"><h3>Proposed changes: ${preview.path}</h3><p>${preview.expectedHash === null ? "Create new file" : `Replace existing file with hash ${preview.expectedHash}`}</p><p class="notice">This confirmation is bound to the exact previewed output and expires after 15 minutes. If stale or the server restarts, use “Preview file changes” again and review the new diff before confirming.</p><pre>${preview.diff}</pre><details><summary>Full proposed text</summary><pre>${preview.text}</pre></details>
      <label class="check"><input type="checkbox" .checked=${this.applyConsent} ?disabled=${this.busy} @change=${(e: Event) => { this.change(() => { this.applyConsent = checked(e); }); }}>I reviewed the target and diff and consent to this file write.</label>
      ${this.button("Confirm apply to file", () => { this.run(async client => { if (!this.applyConsent || this.applyPreview !== preview || this.drafts.writingDirty) throw new Error("Preview the current saved draft and confirm again."); const result = await client.request("writing.apply", { id: preview.id, expectedRevision: preview.revision, path: preview.path, expectedHash: preview.expectedHash, previewToken: preview.previewToken }, object); this.notice = `Applied to ${text(result["path"])}. ${result["backupPath"] === null ? "No prior file required backup." : `Backup retained: ${text(result["backupPath"])}`} SHA-256 ${text(result["sha256"])}`; this.applyPreview = null; this.applyConsent = false; }); }, !this.applyConsent)}
      ${this.button("Cancel file apply", () => { this.change(() => { this.applyPreview = null; this.applyConsent = false; }); })}</article>`;
  }
  private saveDownload(file: { text: string; filename: string; mime: string }): void {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename.replaceAll(/[\\/]/gu, "_"); anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
  }
  private renderImport(): TemplateResult {
    const preview = this.importPreview;
    const reset = (): void => { this.importPreview = null; this.importSelection = new Set(); };
    return html`<h2>Import & export</h2><p>Portable standard files only. No vendor connection or cloud sync. Imports are staged and never silently overwrite native references.</p>
      <form @submit=${(e: SubmitEvent) => { e.preventDefault(); this.run(async client => { if (new TextEncoder().encode(this.importText).byteLength > 1024 * 1024) throw new Error("Import text must be at most 1 MiB in UTF-8."); this.importPreview = await client.request("library.import.preview", { format: this.importFormat, text: this.importText }, v => { const r = object(v); return { references: list(r["references"], fields), warnings: list(r["warnings"], text), fingerprint: text(r["fingerprint"]), duplicateCandidates: list(r["duplicateCandidates"], item => { const pair = object(item); const index = pair["index"]; if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) throw new Error("Invalid import index"); return { index, referenceId: text(pair["referenceId"]), reason: text(pair["reason"]) }; }) }; }); this.importSelection = new Set(); }); }}><fieldset ?disabled=${this.busy}>
      ${this.select("Import format", this.importFormat, ["bibtex", "ris", "csl-json"], v => { this.importFormat = choice(v, ["bibtex", "ris", "csl-json"]); reset(); })}
      <label>Bibliography file<input type="file" accept=".bib,.ris,.json,application/json,text/plain" @change=${(e: Event) => { const input = e.currentTarget; if (!(input instanceof HTMLInputElement)) return; const file = input.files?.[0]; input.value = ""; if (file === undefined) return; this.run(async client => { if (file.size > 1024 * 1024) throw new Error("Import file must be at most 1 MiB."); const contents = await file.text(); client.signal.throwIfAborted(); this.importText = contents; reset(); }); }}></label>
      ${this.field("Paste bibliography", this.importText, v => { this.importText = v; reset(); }, { area: true, required: true, max: 1024 * 1024 })}<button type="submit">Preview import</button></fieldset></form>
      ${preview === null ? nothing : html`<h3>Staged references (${preview.references.length})</h3><p class="muted">Snapshot ${preview.fingerprint}. Select only the rows you intend to import.</p>${preview.warnings.map(warning => html`<p class="notice">${warning}</p>`)}<div class="actions">${this.button("Select all staged rows", () => { this.change(() => { this.importSelection = new Set(preview.references.map((_, index) => index)); }); })}${this.button("Clear staged selection", () => { this.change(() => { this.importSelection.clear(); }); })}</div>
      <ul class="cards">${preview.references.map((ref, index) => html`<li class="card"><label class="check"><input type="checkbox" .checked=${this.importSelection.has(index)} ?disabled=${this.busy} @change=${(e: Event) => { this.change(() => { if (checked(e)) this.importSelection.add(index); else this.importSelection.delete(index); }); }}>${ref.title}</label><p>${ref.authors.join("; ")} ${ref.year ?? ""} · ${ref.citekey}</p>${preview.duplicateCandidates.filter(pair => pair.index === index).map(pair => html`<p class="notice">Potential duplicate: ${this.referenceLabel(pair.referenceId)} — ${pair.reason}</p>`)}</li>`)}</ul>
      ${this.button(`Import ${String(this.importSelection.size)} selected rows`, () => { this.run(async client => { const result = await client.request("library.import.commit", { format: this.importFormat, text: this.importText, indices: [...this.importSelection].sort((a, b) => a - b) }, object); const added = list(result["added"], text); this.notice = `Imported ${String(added.length)} references. Skipped: ${String(result["skipped"])}. ${list(result["warnings"], text).join(" ")}`; reset(); this.importText = ""; await this.loadLibrary(client); }); }, this.importSelection.size === 0)}`}
      <h3>Export selected references</h3><p>${this.selected.size} references selected in the catalog.</p>${this.select("Export format", this.exportFormat, ["bibtex", "ris", "csl-json"], v => { this.exportFormat = choice(v, ["bibtex", "ris", "csl-json"]); })}
      ${this.button("Download bibliography", () => { this.run(async client => { this.saveDownload(await client.request("library.export", { referenceIds: [...this.selected.keys()], format: this.exportFormat }, download)); }); }, this.selected.size === 0)}`;
  }
}
