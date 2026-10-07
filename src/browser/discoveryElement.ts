import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { libraryInteger, libraryObject, libraryStrings, libraryText } from "../domain/workbench.js";
import type { DiscoveryProvider, LibraryGraph } from "../domain/discovery.js";
import { researchRequest } from "./peerClient.js";
import { workbenchId } from "./workbenchClient.js";

export const discoveryElementTag = "pi-web-library-discovery";
interface CandidateView { externalId: string; title: string; authors: string[]; year: number | null; doi: string; sourceUrl: string; openAccessUrl: string; citationCount: number | null }
interface ResultsView { searchId: string; provider: DiscoveryProvider; query: string; page: number; nextPage: number | null; total: number; candidates: CandidateView[]; warnings: string[] }
interface SavedView { id: string; name: string; query: string; provider: DiscoveryProvider }
export function defineLibraryDiscoveryElement(): void { if (customElements.get(discoveryElementTag) === undefined) customElements.define(discoveryElementTag, LibraryDiscoveryElement); }

/** Explicit, selected-workspace discovery. Mounting and saved-query selection are local only. */
export class LibraryDiscoveryElement extends HTMLElement {
  private readonly root = this.attachShadow({ mode: "open" });
  private current: WorkspacePanelContext | undefined;
  private identity = "";
  private generation = 0;
  private controller = new AbortController();
  private busy = false;
  private tab: "search" | "graph" | "saved" = "search";
  private query = "";
  private provider: DiscoveryProvider = "local";
  private disclose = false;
  private results: ResultsView | undefined;
  private relation: { externalId: string; direction: "references" | "cited-by" } | undefined;
  private graph: LibraryGraph | undefined;
  private readonly selected = new Set<number>();
  private saved: SavedView[] = [];
  private savedRevision: number | undefined;
  private savedName = "";
  private message = "";
  private error = false;

  set context(context: WorkspacePanelContext) {
    const identity = JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id, context.workspace.path]);
    // Public peer wrappers can be recreated on each host render. Authority,
    // not object identity, determines whether form state and replies are stale.
    if (identity !== this.identity) {
      this.controller.abort(); this.controller = new AbortController(); this.generation += 1;
      this.identity = identity; this.current = context; this.busy = false; this.results = undefined; this.relation = undefined; this.graph = undefined; this.selected.clear(); this.saved = []; this.savedRevision = undefined;
      this.query = ""; this.savedName = ""; this.disclose = false; this.message = "";
      this.render();
    } else this.current = context;
  }
  connectedCallback(): void { if (this.controller.signal.aborted) this.controller = new AbortController(); this.render(); }
  disconnectedCallback(): void { this.controller.abort(); this.generation += 1; this.busy = false; }

  private render(): void {
    this.root.innerHTML = `<style>
      :host{display:block;color:var(--pi-text,#222);font:14px system-ui}*{box-sizing:border-box}h2,h3{margin:.5rem 0}p{line-height:1.5}nav,.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}button,input,select{font:inherit;border:1px solid var(--pi-border,#bbb);border-radius:5px;padding:.5rem;color:inherit;background:var(--pi-surface,#fafafa)}button{cursor:pointer}button:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--pi-accent,#2673d0);outline-offset:2px}button[aria-pressed=true]{border-color:var(--pi-accent,#2673d0)}label{display:block;margin:.6rem 0}input[type=text]{width:min(100%,45rem)}article,.notice{padding:.8rem;margin:.6rem 0;border:1px solid var(--pi-border,#bbb);border-radius:6px}.muted{color:var(--pi-text-secondary,#666)}a{color:var(--pi-accent,#2673d0);overflow-wrap:anywhere}.error{color:var(--pi-danger,#b22)}ul{padding-left:1.4rem}svg{width:min(100%,700px);height:auto}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.4rem;border-bottom:1px solid var(--pi-border,#ccc)}.scroll{overflow:auto}input[type=checkbox]{margin-right:.4rem}
      </style><h2>Literature discovery & connections</h2>
      <p>Native catalog and workflows; no reference-manager accounts, vendor MCP, or cloud synchronization. Public scholarly metadata lookup is optional.</p>
      <nav aria-label="Discovery views"><button data-tab="search">Find literature</button><button data-tab="graph">Local connections</button><button data-tab="saved">Saved searches</button></nav>
      <p data-message role="status" aria-live="polite"></p><main></main>`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      button.setAttribute("aria-pressed", String(button.dataset["tab"] === this.tab));
      button.disabled = this.busy;
      button.addEventListener("click", () => { const tab = button.dataset["tab"]; if (tab === "search" || tab === "graph" || tab === "saved") { this.tab = tab; this.render(); } });
    }
    const message = this.element("[data-message]", HTMLElement);
    message.textContent = this.busy ? "Working…" : this.message; message.classList.toggle("error", this.error);
    const main = this.element("main", HTMLElement);
    if (this.tab === "search") this.renderSearch(main);
    else if (this.tab === "graph") this.renderGraph(main);
    else this.renderSaved(main);
  }

  private renderSearch(main: HTMLElement): void {
    main.innerHTML = `<label>Search source <select aria-label="Search source"><option value="local">Local library — no network</option><option value="crossref">Crossref public metadata</option><option value="openalex">OpenAlex public metadata & citations</option></select></label>
      <label>Literature query <input type="text" aria-label="Literature query" maxlength="300"></label>
      <label><input type="checkbox" data-disclose>For this search, send the query or selected work identity to the chosen public metadata service.</label>
      <p class="muted">No PDFs, annotations, manuscripts, credentials or reference-manager data are uploaded. External services receive your IP address and query/work identity and apply their own privacy policies and rate limits. No background alerts or automatic searches.</p>
      <div class="row"><button data-search>Search literature</button><button data-import>Import selected metadata</button></div><div data-results></div>`;
    const provider = this.element("select", HTMLSelectElement); provider.value = this.provider; provider.disabled = this.busy;
    provider.addEventListener("change", () => { this.provider = parseProvider(provider.value); this.disclose = false; this.results = undefined; this.relation = undefined; this.selected.clear(); this.render(); });
    const query = this.element('[aria-label="Literature query"]', HTMLInputElement); query.value = this.query; query.disabled = this.busy; query.addEventListener("input", () => { this.query = query.value; });
    query.addEventListener("keydown", event => { if (event.key === "Enter" && !this.busy) void this.search(1); });
    const disclose = this.element("[data-disclose]", HTMLInputElement); disclose.checked = this.disclose; disclose.disabled = this.busy || this.provider === "local"; disclose.addEventListener("change", () => { this.disclose = disclose.checked; });
    this.button("[data-search]", () => this.search(1));
    this.button("[data-import]", () => this.importSelected(), this.selected.size === 0);
    const target = this.element("[data-results]", HTMLElement);
    const results = this.results;
    if (results === undefined) return;
    target.append(text("p", `${String(results.total)} metadata matches · page ${String(results.page)} · ${results.provider}. Import stores metadata only; PDFs are attached separately in Library.`));
    for (const warning of results.warnings) target.append(text("p", warning, "muted"));
    results.candidates.forEach((candidate, index) => {
      const card = document.createElement("article");
      const label = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = this.selected.has(index); checkbox.disabled = this.busy;
      checkbox.setAttribute("aria-label", `Select ${candidate.title}`);
      checkbox.addEventListener("change", () => { if (checkbox.checked) this.selected.add(index); else this.selected.delete(index); this.element("[data-import]", HTMLButtonElement).disabled = this.busy || this.selected.size === 0; });
      label.append(checkbox, document.createTextNode(candidate.title)); card.append(label);
      card.append(text("p", `${candidate.authors.join("; ")} (${candidate.year === null ? "undated" : String(candidate.year)})${candidate.doi === "" ? "" : ` · DOI ${candidate.doi}`}`, "muted"));
      if (candidate.citationCount !== null) card.append(text("p", `${String(candidate.citationCount)} reported citations (provider metadata, not quality or support verification)`));
      const links = document.createElement("div"); links.className = "row";
      if (candidate.sourceUrl !== "") links.append(link("Metadata source", candidate.sourceUrl));
      if (candidate.openAccessUrl !== "") links.append(link("Reported open-access location (external)", candidate.openAccessUrl));
      if (results.provider === "openalex") {
        for (const [direction, caption] of [["references", "Find references"], ["cited-by", "Find citing works"]] as const) {
          const button = text("button", `${caption} — sends work ID`); button.disabled = this.busy;
          button.addEventListener("click", () => { void this.related(candidate.externalId, direction, 1); }); links.append(button);
        }
      }
      card.append(links); target.append(card);
    });
    const paging = document.createElement("div"); paging.className = "row";
    if (results.page > 1) { const previous = text("button", "Previous results"); previous.disabled = this.busy; previous.addEventListener("click", () => { void this.pageResults(results.page - 1); }); paging.append(previous); }
    if (results.nextPage !== null) { const next = text("button", "Next results"); next.disabled = this.busy; next.addEventListener("click", () => { if (results.nextPage !== null) void this.pageResults(results.nextPage); }); paging.append(next); }
    target.append(paging);
  }

  private search(page: number): Promise<void> {
    return this.perform(async signal => {
      if (this.provider !== "local" && !this.disclose) throw new Error("Confirm disclosure before searching an external metadata service.");
      const response = await this.request("discovery.search", { provider: this.provider, query: this.query, page, disclose: this.disclose }, signal);
      this.results = decodeResults(response); this.relation = undefined; this.selected.clear(); this.message = "Search completed. Select references to import; no metadata was changed automatically.";
    });
  }
  private pageResults(page: number): Promise<void> {
    return this.relation === undefined ? this.search(page) : this.related(this.relation.externalId, this.relation.direction, page);
  }
  private related(externalId: string, direction: "references" | "cited-by", page: number): Promise<void> {
    return this.perform(async signal => {
      const response = await this.request("discovery.related", { externalId, direction, page, disclose: this.disclose }, signal);
      this.results = decodeResults(response); this.relation = { externalId, direction }; this.selected.clear(); this.message = "Citation neighborhood loaded; relationships are provider-reported.";
    });
  }
  private importSelected(): Promise<void> {
    return this.perform(async signal => {
      if (this.results === undefined) throw new Error("Search before importing");
      const value = libraryObject(await this.request("discovery.import", { searchId: this.results.searchId, indices: [...this.selected] }, signal), ["added", "skipped", "warnings"]);
      const added = libraryStrings(value["added"], 25, 80); const skipped = libraryStrings(value["skipped"], 25, 80);
      this.message = `Imported ${String(added.length)} reference(s); ${String(skipped.length)} existing/trashed matches kept unchanged. Open Library and refresh to review metadata and attach PDFs. ${libraryStrings(value["warnings"], 20, 1_000).join(" ")}`;
      this.selected.clear();
    });
  }

  private renderSaved(main: HTMLElement): void {
    main.innerHTML = `<p>Saved searches are local recipes, not scheduled provider calls. “Use query” fills the search form; a separate Search action and disclosure consent are still required.</p><button data-load>Refresh saved searches</button>
      <label>Saved search name <input type="text" aria-label="Saved search name" maxlength="256"></label><button data-save>Save current query</button><div data-saved></div>`;
    const name = this.element('[aria-label="Saved search name"]', HTMLInputElement); name.value = this.savedName; name.disabled = this.busy; name.addEventListener("input", () => { this.savedName = name.value; });
    this.button("[data-load]", () => this.perform(signal => this.loadSaved(signal)));
    this.button("[data-save]", () => this.perform(async signal => {
      if (this.savedRevision === undefined) throw new Error("Refresh saved searches first");
      await this.request("discovery.saved.save", { id: workbenchId("search"), expectedRevision: this.savedRevision, name: this.savedName, query: this.query, provider: this.provider }, signal);
      await this.loadSaved(signal); this.message = "Search recipe saved locally. It will not run automatically.";
    }), this.savedRevision === undefined || this.query.trim() === "");
    const list = this.element("[data-saved]", HTMLElement);
    for (const search of this.saved) {
      const card = document.createElement("article"); card.append(text("h3", search.name), text("p", `${search.provider}: ${search.query}`));
      const use = text("button", "Use query"); use.disabled = this.busy; use.addEventListener("click", () => { this.query = search.query; this.provider = search.provider; this.disclose = false; this.results = undefined; this.relation = undefined; this.selected.clear(); this.tab = "search"; this.render(); });
      const remove = text("button", "Delete saved search"); remove.disabled = this.busy; remove.addEventListener("click", () => { void this.perform(async signal => { await this.request("discovery.saved.delete", { id: search.id, expectedRevision: this.savedRevision }, signal); await this.loadSaved(signal); this.message = "Saved query deleted; references were not changed."; }); });
      card.append(use, document.createTextNode(" "), remove); list.append(card);
    }
  }
  private async loadSaved(signal: AbortSignal): Promise<void> {
    const value = libraryObject(await this.request("discovery.saved.list", {}, signal), ["items", "revision"]);
    this.savedRevision = libraryInteger(value["revision"]);
    this.saved = rows(value["items"], 100).map(item => { const row = libraryObject(item, ["id", "name", "query", "provider", "checkedAt"]); return { id: libraryText(row["id"], 80, false), name: libraryText(row["name"], 256), query: libraryText(row["query"], 300), provider: parseProvider(row["provider"]) }; });
  }

  private renderGraph(main: HTMLElement): void {
    main.append(text("p", "Explore local shared authors, tags and claim co-occurrence. This is not a verified citation network. No network or model call is made."));
    const refresh = text("button", "Refresh local connections"); refresh.disabled = this.busy; refresh.addEventListener("click", () => { void this.perform(async signal => { this.graph = decodeGraph(await this.request("library.graph", { referenceIds: [] }, signal)); this.message = "Local connections loaded."; }); }); main.append(refresh);
    if (this.graph === undefined) return;
    for (const warning of this.graph.warnings) main.append(text("p", warning, "muted"));
    const graph = this.graph;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 640 640"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Local metadata and claim connections. Equivalent labeled connection table follows.");
    const positions = new Map(graph.nodes.slice(0, 40).map((node, index, visible) => { const angle = 2 * Math.PI * index / visible.length; return [node.id, { x: 320 + 240 * Math.cos(angle), y: 320 + 240 * Math.sin(angle) }]; }));
    for (const edge of graph.edges) {
      const from = positions.get(edge.from); const to = positions.get(edge.to); if (from === undefined || to === undefined) continue;
      const line = document.createElementNS(svg.namespaceURI, "line"); line.setAttribute("x1", String(from.x)); line.setAttribute("y1", String(from.y)); line.setAttribute("x2", String(to.x)); line.setAttribute("y2", String(to.y)); line.setAttribute("stroke", "var(--pi-border,#aaa)"); svg.append(line);
    }
    graph.nodes.slice(0, 40).forEach((node, index) => { const position = positions.get(node.id); if (position === undefined) return; const circle = document.createElementNS(svg.namespaceURI, "circle"); circle.setAttribute("cx", String(position.x)); circle.setAttribute("cy", String(position.y)); circle.setAttribute("r", "12"); circle.setAttribute("fill", "var(--pi-accent,#2673d0)"); const label = document.createElementNS(svg.namespaceURI, "text"); label.setAttribute("x", String(position.x + 14)); label.setAttribute("y", String(position.y + 4)); label.setAttribute("fill", "currentColor"); label.setAttribute("font-size", "11"); label.textContent = String(index + 1); svg.append(circle, label); });
    main.append(text("p", "Diagram: first 40 references. The numbered legend and connection table cover the complete bounded result.", "muted"), svg);
    const legend = document.createElement("ol"); graph.nodes.forEach(node => { legend.append(text("li", `${node.citekey}: ${node.title}`)); }); main.append(legend);
    const table = document.createElement("table"); table.innerHTML = "<thead><tr><th>Source</th><th>Connected source</th><th>Kind / label</th></tr></thead><tbody></tbody>";
    const body = table.querySelector("tbody"); if (body !== null) for (const edge of graph.edges) { const row = document.createElement("tr"); row.append(text("td", graph.nodes.find(node => node.id === edge.from)?.citekey ?? edge.from), text("td", graph.nodes.find(node => node.id === edge.to)?.citekey ?? edge.to), text("td", `${edge.kind}: ${edge.label}`)); body.append(row); }
    const scroll = document.createElement("div"); scroll.className = "scroll"; scroll.append(table); main.append(scroll);
  }

  private async perform(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.busy) return;
    const generation = this.generation;
    this.busy = true; this.error = false; this.message = ""; this.render();
    try { await action(this.controller.signal); }
    catch (error) { if (generation === this.generation && !this.controller.signal.aborted) { this.message = error instanceof Error ? error.message : "Discovery failed"; this.error = true; } }
    finally { if (generation === this.generation) { this.busy = false; this.render(); } }
  }
  private async request(operation: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const generation = this.generation;
    const response = await researchRequest(this.current?.peer, operation, input, signal);
    if (generation !== this.generation) throw new Error("Workspace changed during discovery request");
    signal.throwIfAborted();
    return response;
  }
  private button(selector: string, action: () => Promise<void>, disabled = false): void { const button = this.element(selector, HTMLButtonElement); button.disabled = this.busy || disabled; button.addEventListener("click", () => { void action(); }); }
  private element<T extends Element>(selector: string, constructor: new(...args: never[]) => T): T { const element = this.root.querySelector(selector); if (!(element instanceof constructor)) throw new Error(`Missing discovery element: ${selector}`); return element; }
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ""): HTMLElementTagNameMap[K] { const element = document.createElement(tag); element.textContent = value; element.className = className; return element; }
function link(label: string, value: string): HTMLAnchorElement { const anchor = text("a", label); const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") throw new Error("Unsafe metadata URL"); anchor.href = url.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; return anchor; }
function checkedUrl(value: unknown): string { const text = libraryText(value, 2_048); if (text === "") return text; const url = new URL(text); if (!["https:", "http:"].includes(url.protocol) || url.username !== "" || url.password !== "") throw new Error("Unsafe metadata URL"); return url.href; }
function parseProvider(value: unknown): DiscoveryProvider { if (value === "local" || value === "crossref" || value === "openalex") return value; throw new Error("Invalid discovery provider"); }
function rows(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error("Invalid discovery response list"); return value; }
function optionalInteger(value: unknown): number | null { return value === null ? null : libraryInteger(value, 0, Number.MAX_SAFE_INTEGER); }
function decodeResults(input: unknown): ResultsView {
  const value = libraryObject(input, ["searchId", "provider", "query", "page", "nextPage", "total", "candidates", "warnings"]);
  return { searchId: libraryText(value["searchId"], 36, false), provider: parseProvider(value["provider"]), query: libraryText(value["query"], 300), page: libraryInteger(value["page"], 1, 20), nextPage: optionalInteger(value["nextPage"]), total: libraryInteger(value["total"], 0, Number.MAX_SAFE_INTEGER), warnings: libraryStrings(value["warnings"], 20, 1_000), candidates: rows(value["candidates"], 25).map(item => {
    const row = libraryObject(item, ["externalId", "fields", "sourceUrl", "openAccessUrl", "citationCount"]);
    const fieldsValue = row["fields"]; if (typeof fieldsValue !== "object" || fieldsValue === null || Array.isArray(fieldsValue)) throw new Error("Invalid discovered reference fields"); const fields = Object.fromEntries(Object.entries(fieldsValue));
    return { externalId: libraryText(row["externalId"], 300, false), title: libraryText(fields["title"], 1_000, false), authors: libraryStrings(fields["authors"], 100, 256), year: optionalInteger(fields["year"]), doi: libraryText(fields["doi"], 256), sourceUrl: checkedUrl(row["sourceUrl"]), openAccessUrl: checkedUrl(row["openAccessUrl"]), citationCount: optionalInteger(row["citationCount"]) };
  }) };
}
function decodeGraph(input: unknown): LibraryGraph {
  const value = libraryObject(input, ["nodes", "edges", "warnings"]);
  return { nodes: rows(value["nodes"], 100).map(item => { const node = libraryObject(item, ["id", "title", "citekey"]); return { id: libraryText(node["id"], 80), title: libraryText(node["title"], 1_000), citekey: libraryText(node["citekey"], 256) }; }), edges: rows(value["edges"], 500).map(item => { const edge = libraryObject(item, ["from", "to", "kind", "label"]); const kind = edge["kind"]; if (kind !== "shared-author" && kind !== "shared-tag" && kind !== "model-claim") throw new Error("Unknown connection type"); return { from: libraryText(edge["from"], 80), to: libraryText(edge["to"], 80), kind, label: libraryText(edge["label"], 1_000) }; }), warnings: libraryStrings(value["warnings"], 20, 1_000) };
}
