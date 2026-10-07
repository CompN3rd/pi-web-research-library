import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { emptyReferenceFields, libraryId, libraryInteger, libraryObject, libraryStrings, libraryText, type LibraryRepository, type LibraryReference, type SavedLibrarySearch } from "../domain/workbench.js";
import type { DiscoveryCandidate, DiscoveryProvider, DiscoveryResults, LibraryGraph } from "../domain/discovery.js";

const PAGE_SIZE = 25;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RECEIPT_MS = 15 * 60_000;
interface SearchReceipt { root: string; expires: number; results: DiscoveryResults }
export type DiscoveryFetch = (url: URL, init: RequestInit) => Promise<Response>;

/** Native discovery from public scholarly metadata, never a reference-manager connector. */
export class LibraryDiscovery {
  private readonly receipts = new Map<string, SearchReceipt>();
  private pending = 0;
  constructor(private readonly repository: LibraryRepository, private readonly fetcher: DiscoveryFetch = (url, init) => fetch(url, init), private readonly now: () => number = Date.now) {}

  async handle(root: string, operation: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (operation === "library.graph") return localGraph(await this.repository.read(root, signal), input);
    if (operation === "discovery.import") return this.import(root, input, signal);
    if (operation.startsWith("discovery.saved.")) return this.saved(root, operation, input, signal);
    if (operation !== "discovery.search" && operation !== "discovery.related") throw new Error("Unknown native discovery operation");
    if (this.pending >= 4) throw new Error("Discovery request limit reached; wait for a current search to finish");
    this.pending += 1;
    try {
      const results = operation === "discovery.search" ? await this.search(root, input, signal) : await this.related(input, signal);
      for (const [id, receipt] of this.receipts) if (receipt.expires <= this.now()) this.receipts.delete(id);
      while (this.receipts.size >= 16) {
        const first = this.receipts.keys().next().value;
        if (first !== undefined) this.receipts.delete(first);
      }
      this.receipts.set(results.searchId, { root: await realpath(root), expires: this.now() + RECEIPT_MS, results });
      return results;
    } finally { this.pending -= 1; }
  }

  private async search(root: string, input: unknown, signal: AbortSignal): Promise<DiscoveryResults> {
    const value = libraryObject(input, ["provider", "query"], ["page", "disclose"]);
    const provider = parseProvider(value["provider"]);
    const query = libraryText(value["query"], 300, false).trim();
    const page = libraryInteger(value["page"] ?? 1, 1, 20);
    if (provider === "local") {
      const references = (await this.repository.read(root, signal)).references.filter(reference => reference.deletedAt === null && [reference.title, reference.citekey, reference.doi, reference.abstract, ...reference.authors, ...reference.tags].join(" ").toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US")));
      const candidates = references.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(reference => ({ externalId: reference.id, fields: fieldsOf(reference), sourceUrl: reference.url, openAccessUrl: "", citationCount: null }));
      return result(provider, query, page, references.length, candidates, []);
    }
    consent(value["disclose"]);
    const url = new URL(provider === "crossref" ? "https://api.crossref.org/works" : "https://api.openalex.org/works");
    if (provider === "crossref") {
      url.searchParams.set("query.bibliographic", query);
      url.searchParams.set("rows", String(PAGE_SIZE));
      url.searchParams.set("offset", String((page - 1) * PAGE_SIZE));
      // Small allowlisted projection: no article/PDF content is requested.
      url.searchParams.set("select", "DOI,title,author,published,container-title,type,volume,issue,page,publisher,URL,is-referenced-by-count");
    } else {
      url.searchParams.set("search", query);
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
      url.searchParams.set("select", "id,doi,title,authorships,publication_year,primary_location,type,cited_by_count,open_access");
    }
    const response = await this.request(url, signal);
    return parseResults(provider, query, page, response);
  }

  private async related(input: unknown, signal: AbortSignal): Promise<DiscoveryResults> {
    const value = libraryObject(input, ["externalId", "direction", "disclose"], ["page"]);
    consent(value["disclose"]);
    const id = libraryText(value["externalId"], 30, false);
    if (!/^W\d{1,20}$/u.test(id)) throw new Error("Citation discovery requires an OpenAlex work identity");
    const page = libraryInteger(value["page"] ?? 1, 1, 20);
    const direction = value["direction"];
    if (direction !== "references" && direction !== "cited-by") throw new Error("Unknown citation direction");
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("per_page", String(PAGE_SIZE));
    const query = `${direction}: ${id}`;
    let referenceTotal: number | undefined;
    if (direction === "cited-by") {
      url.searchParams.set("filter", `cites:${id}`);
      url.searchParams.set("page", String(page));
    } else {
      const work = object(await this.request(new URL(`https://api.openalex.org/works/${id}?select=referenced_works`), signal));
      const referenced = array(work["referenced_works"]).map(item => string(item, 100).replace("https://openalex.org/", "")).filter(item => /^W\d{1,20}$/u.test(item));
      referenceTotal = referenced.length;
      const selected = referenced.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      if (selected.length === 0) return result("openalex", query, page, referenceTotal, [], []);
      url.searchParams.set("filter", `openalex:${selected.join("|")}`);
    }
    url.searchParams.set("select", "id,doi,title,authorships,publication_year,primary_location,type,cited_by_count,open_access");
    const results = parseResults("openalex", query, page, await this.request(url, signal));
    if (referenceTotal !== undefined) {
      results.total = referenceTotal;
      results.nextPage = page * PAGE_SIZE < referenceTotal && page < 20 ? page + 1 : null;
    }
    return results;
  }

  private async request(url: URL, signal: AbortSignal): Promise<unknown> {
    // URLs are built above from fixed HTTPS hosts. No imported URL can reach fetch.
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const response = await this.fetcher(url, { headers: { Accept: "application/json", "User-Agent": "pi-web-research-library/0.1 (native user-requested metadata discovery)" }, redirect: "error", credentials: "omit", signal: bounded });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Scholarly metadata service returned HTTP ${String(response.status)}. No import was performed. Rate limits or authentication policy may require trying later or importing a standard bibliography file.`);
    }
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error("Scholarly metadata response exceeds 2 MiB"); }
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Empty scholarly metadata response");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      let item = await reader.read();
      while (!item.done) {
        bounded.throwIfAborted();
        bytes += item.value.length;
        if (bytes > MAX_RESPONSE_BYTES) throw new Error("Scholarly metadata response exceeds 2 MiB");
        chunks.push(item.value);
        item = await reader.read();
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private async import(root: string, input: unknown, signal: AbortSignal) {
    const value = libraryObject(input, ["searchId", "indices"]);
    const receipt = this.receipts.get(libraryText(value["searchId"], 36, false));
    if (receipt === undefined || receipt.expires <= this.now() || receipt.root !== await realpath(root)) throw new Error("Discovery preview expired or belongs to another workspace; search again");
    const rows = value["indices"];
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > PAGE_SIZE) throw new Error("Select 1–25 discovered references");
    const indices = rows.map(item => libraryInteger(item, 0, receipt.results.candidates.length - 1));
    if (new Set(indices).size !== indices.length) throw new Error("Duplicate discovery selection");
    return this.repository.update(root, state => {
      const added: string[] = [];
      const skipped: string[] = [];
      for (const index of indices) {
        const candidate = receipt.results.candidates[index];
        if (candidate === undefined) throw new Error("Discovery selection is no longer available");
        const doi = candidate.fields.doi.toLocaleLowerCase("en-US");
        const identity = doi === "" ? `${receipt.results.provider}:${candidate.externalId}` : `doi:${doi}`;
        const id = `ref-${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
        const duplicate = state.references.find(reference => reference.id === id || reference.id === candidate.externalId || (doi !== "" && reference.doi.toLocaleLowerCase("en-US") === doi));
        if (duplicate !== undefined) { skipped.push(duplicate.id); continue; }
        const fields = structuredClone(candidate.fields);
        const key = fields.citekey;
        if (state.references.some(reference => reference.deletedAt === null && [reference.citekey, ...reference.aliases].includes(fields.citekey))) fields.citekey = `${key}-${id.slice(-8)}`;
        const at = new Date(this.now()).toISOString();
        state.references.push({ ...fields, id, revision: 1, createdAt: at, updatedAt: at, deletedAt: null, documents: [], aliases: [], provenance: [`discovery:${receipt.results.provider}:${candidate.externalId}`, `retrieved:${at}`, `metadata-source:${candidate.sourceUrl}`] });
        added.push(id);
      }
      return { added, skipped, warnings: ["Metadata imported only. PDFs, claims, citation relationships and access rights have not been verified."] };
    }, signal);
  }

  private async saved(root: string, operation: string, input: unknown, signal: AbortSignal) {
    if (operation === "discovery.saved.list") {
      libraryObject(input, []);
      const state = await this.repository.read(root, signal);
      return { items: state.savedSearches, revision: state.revision };
    }
    const value = operation === "discovery.saved.save" ? libraryObject(input, ["id", "expectedRevision", "name", "query", "provider"]) : libraryObject(input, ["id", "expectedRevision"]);
    if (operation !== "discovery.saved.save" && operation !== "discovery.saved.delete") throw new Error("Unknown saved-search operation");
    const id = libraryId(value["id"], "search");
    const revision = libraryInteger(value["expectedRevision"]);
    return this.repository.update(root, state => {
      if (state.revision !== revision) throw new Error("Library changed; refresh saved searches before editing");
      const index = state.savedSearches.findIndex(search => search.id === id);
      if (operation === "discovery.saved.delete") {
        if (index < 0) throw new Error("Saved search not found");
        state.savedSearches.splice(index, 1);
        return { deleted: true };
      }
      const search: SavedLibrarySearch = { id, name: libraryText(value["name"], 256, false), query: libraryText(value["query"], 300, false), provider: parseProvider(value["provider"]), checkedAt: null };
      if (index >= 0) state.savedSearches[index] = search;
      else { if (state.savedSearches.length >= 100) throw new Error("Saved-search limit reached"); state.savedSearches.push(search); }
      return search;
    }, signal);
  }
}

function parseResults(provider: "crossref" | "openalex", query: string, page: number, raw: unknown): DiscoveryResults {
  const value = object(raw);
  const message = provider === "crossref" ? object(value["message"]) : value;
  const rows = array(message[provider === "crossref" ? "items" : "results"]);
  const warnings = ["Public metadata is incomplete and can be wrong. Citation counts are not evidence of research quality."];
  const candidates: DiscoveryCandidate[] = [];
  for (const row of rows.slice(0, PAGE_SIZE)) {
    const candidate = provider === "crossref" ? crossref(object(row)) : openalex(object(row));
    if (candidate === null) warnings.push("A result without a usable title/identity was omitted.");
    else candidates.push(candidate);
  }
  const total = number(provider === "crossref" ? message["total-results"] : object(message["meta"])["count"]) ?? candidates.length;
  return result(provider, query, page, total, candidates, [...new Set(warnings)]);
}
function result(provider: DiscoveryProvider, query: string, page: number, total: number, candidates: DiscoveryCandidate[], warnings: string[]): DiscoveryResults {
  const results: DiscoveryResults = { searchId: randomUUID(), provider, query, page, nextPage: page * PAGE_SIZE < total && page < 20 ? page + 1 : null, total, candidates, warnings };
  if (Buffer.byteLength(JSON.stringify(results)) > 192 * 1024) throw new Error("Discovery preview exceeds its response budget; narrow the query");
  return results;
}
function crossref(row: Record<string, unknown>): DiscoveryCandidate | null {
  const doi = string(row["DOI"], 256).toLocaleLowerCase("en-US");
  const title = string(array(row["title"])[0], 1_000);
  if (doi === "" || title === "") return null;
  const fields = emptyReferenceFields();
  fields.title = title;
  fields.doi = doi;
  fields.type = referenceType(row["type"]);
  fields.authors = array(row["author"]).slice(0, 100).map(author => { const value = object(author); return string(value["name"], 256) || [string(value["given"], 100), string(value["family"], 150)].filter(Boolean).join(" "); }).filter(Boolean);
  fields.year = year(array(array(object(row["published"])["date-parts"])[0])[0]);
  fields.containerTitle = string(array(row["container-title"])[0], 1_000);
  fields.volume = string(row["volume"], 256); fields.issue = string(row["issue"], 256); fields.pages = string(row["page"], 256); fields.publisher = string(row["publisher"], 1_000);
  fields.url = safeUrl(row["URL"]) || `https://doi.org/${encodeURI(doi)}`;
  fields.citekey = citekey(fields.authors, fields.year, doi);
  return { externalId: doi, fields, sourceUrl: `https://api.crossref.org/works/${encodeURIComponent(doi)}`, openAccessUrl: "", citationCount: number(row["is-referenced-by-count"]) };
}
function openalex(row: Record<string, unknown>): DiscoveryCandidate | null {
  const id = string(row["id"], 100).replace("https://openalex.org/", "");
  const title = string(row["title"], 1_000);
  if (!/^W\d{1,20}$/u.test(id) || title === "") return null;
  const fields = emptyReferenceFields();
  fields.title = title;
  fields.doi = string(row["doi"], 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "").toLocaleLowerCase("en-US").slice(0, 256);
  fields.type = referenceType(row["type"]);
  fields.authors = array(row["authorships"]).slice(0, 100).map(author => string(object(object(author)["author"])["display_name"], 256)).filter(Boolean);
  fields.year = year(row["publication_year"]);
  const location = object(row["primary_location"]);
  fields.containerTitle = string(object(location["source"])["display_name"], 1_000);
  fields.url = safeUrl(location["landing_page_url"]) || `https://openalex.org/${id}`;
  fields.citekey = citekey(fields.authors, fields.year, fields.doi || id);
  return { externalId: id, fields, sourceUrl: `https://openalex.org/${id}`, openAccessUrl: safeUrl(object(row["open_access"])["oa_url"]), citationCount: number(row["cited_by_count"]) };
}
function fieldsOf(reference: LibraryReference) {
  const fields = emptyReferenceFields();
  // Deliberate field projection prevents passing native identity/revisions as new fields.
  return Object.assign(fields, Object.fromEntries(Object.keys(fields).map(key => [key, Reflect.get(reference, key)])));
}
function referenceType(input: unknown) {
  if (input === "book" || input === "chapter" || input === "thesis" || input === "report" || input === "dataset" || input === "software") return input;
  if (input === "book-chapter") return "chapter";
  if (input === "proceedings-article") return "paper-conference";
  return "article-journal";
}
function citekey(authors: string[], date: number | null, identity: string): string { return `${(authors[0]?.split(/\s+/u).at(-1) ?? "Source").replace(/[^A-Za-z0-9]/gu, "").slice(0, 40) || "Source"}${date === null ? "Undated" : String(date)}-${createHash("sha256").update(identity).digest("hex").slice(0, 8)}`; }
function parseProvider(value: unknown): DiscoveryProvider { if (value === "local" || value === "crossref" || value === "openalex") return value; throw new Error("Unknown discovery provider"); }
function consent(value: unknown): void { if (value !== true) throw new Error("Explicit consent is required to disclose the search query or work identity to the selected scholarly metadata service"); }
function object(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown, max: number): string { return typeof value === "string" ? Array.from(value).map(character => { const code = character.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159) ? " " : character; }).join("").trim().slice(0, max) : ""; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function year(value: unknown): number | null { const parsed = number(value); return parsed !== null && parsed >= 1 && parsed <= 9999 ? parsed : null; }
function safeUrl(value: unknown): string { const text = string(value, 2_048); try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) && url.username === "" && url.password === "" ? url.href : ""; } catch { return ""; } }

function localGraph(state: Awaited<ReturnType<LibraryRepository["read"]>>, input: unknown): LibraryGraph {
  const value = libraryObject(input, [], ["referenceIds"]);
  const ids = libraryStrings(value["referenceIds"] ?? [], 100, 80).map(id => libraryId(id, "ref"));
  const references = state.references.filter(reference => reference.deletedAt === null && (ids.length === 0 || ids.includes(reference.id))).slice(0, 100);
  const nodes = references.map(reference => ({ id: reference.id, title: reference.title, citekey: reference.citekey }));
  const edges: LibraryGraph["edges"] = [];
  for (let left = 0; left < references.length; left += 1) {
    for (const right of references.slice(left + 1)) {
      const reference = references[left];
      if (reference === undefined) continue;
      const author = reference.authors.find(item => right.authors.includes(item));
      const tag = reference.tags.find(item => right.tags.includes(item));
      if (author !== undefined) edges.push({ from: reference.id, to: right.id, kind: "shared-author", label: author });
      else if (tag !== undefined) edges.push({ from: reference.id, to: right.id, kind: "shared-tag", label: tag });
      if (edges.length >= 500) break;
    }
    if (edges.length >= 500) break;
  }
  for (const task of state.tasks) for (const claim of task.result?.claims ?? []) {
    const matches = claim.referenceIds.filter(id => nodes.some(node => node.id === id));
    const first = matches[0];
    if (first === undefined) continue;
    for (const other of matches.slice(1)) if (edges.length < 500) edges.push({ from: first, to: other, kind: "model-claim", label: `${task.review}: ${claim.relationship} — ${claim.text.slice(0, 200)}` });
  }
  return { nodes, edges, warnings: ["Connections show shared metadata or model claim co-occurrence, not verified paper-to-paper citations.", "View limited to 100 references and 500 connections; use a selected subset for a larger library."] };
}
