import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, type LibraryRepository } from "../domain/workbench.js";
import { LibraryDiscovery, type DiscoveryFetch } from "./discovery.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const signal = () => new AbortController().signal;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "research-discovery-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let state = emptyLibrary();
  let now = Date.parse("2026-09-26T00:00:00.000Z");
  const repository: LibraryRepository = { read: () => Promise.resolve(structuredClone(state)), update: async (_root, change) => { const next = structuredClone(state); const result = await change(next); next.revision += 1; state = next; return result; } };
  const fetcher = vi.fn<DiscoveryFetch>(() => Promise.resolve(Response.json({ message: { "total-results": 1, items: [{ DOI: "10.1234/Synthetic", title: ["Synthetic discovery study"], author: [{ given: "Test", family: "Author" }], published: { "date-parts": [[2026]] }, type: "journal-article", URL: "https://example.test/study", "is-referenced-by-count": 3 }] } })));
  const service = new LibraryDiscovery(repository, fetcher, () => now);
  return { root, fetcher, service, state: () => state, advance: () => { now += 16 * 60_000; } };
}
function record(input: unknown): Record<string, unknown> { if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Expected test response"); return Object.fromEntries(Object.entries(input)); }

describe("native scholarly discovery", () => {
  it("requires explicit disclosure before fetching fixed public endpoints", async () => {
    const f = await fixture();
    await expect(f.service.handle(f.root, "discovery.search", { provider: "crossref", query: "synthetic study" }, signal())).rejects.toThrow("consent");
    expect(f.fetcher).not.toHaveBeenCalled();
    const results = record(await f.service.handle(f.root, "discovery.search", { provider: "crossref", query: "synthetic study", disclose: true }, signal()));
    expect(results).toMatchObject({ provider: "crossref", total: 1, page: 1, nextPage: null, candidates: [{ fields: { title: "Synthetic discovery study", doi: "10.1234/synthetic", authors: ["Test Author"], year: 2026 }, citationCount: 3 }] });
    const call = f.fetcher.mock.calls[0];
    expect(call?.[0].origin).toBe("https://api.crossref.org");
    expect(call?.[0].searchParams.get("query.bibliographic")).toBe("synthetic study");
    expect(call?.[1]).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(f.state().references).toEqual([]);
    await expect(f.service.handle(f.root, "discovery.search", { provider: "https://evil.test", query: "secret", disclose: true }, signal())).rejects.toThrow("provider");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("imports only selected cached metadata, preserves edits on replay and records provenance", async () => {
    const f = await fixture();
    const result = record(await f.service.handle(f.root, "discovery.search", { provider: "crossref", query: "test", disclose: true }, signal()));
    await expect(f.service.handle(f.root, "discovery.import", { searchId: result["searchId"], indices: [0] }, signal())).resolves.toMatchObject({ added: [expect.stringMatching(/^ref-/u)], skipped: [] });
    const reference = f.state().references[0]; if (reference === undefined) throw new Error("Missing import");
    expect(reference.documents).toEqual([]);
    expect(reference.provenance).toContain("discovery:crossref:10.1234/synthetic");
    reference.notes = "Human edit retained";
    reference.deletedAt = "2026-09-26T01:00:00.000Z";
    await expect(f.service.handle(f.root, "discovery.import", { searchId: result["searchId"], indices: [0] }, signal())).resolves.toMatchObject({ added: [], skipped: [reference.id] });
    expect(f.state().references[0]?.notes).toBe("Human edit retained");
    expect(f.state().references[0]?.deletedAt).not.toBeNull();
    await expect(f.service.handle(f.root, "discovery.import", { searchId: result["searchId"], indices: [0, 0] }, signal())).rejects.toThrow("Duplicate");
    f.advance();
    await expect(f.service.handle(f.root, "discovery.import", { searchId: result["searchId"], indices: [0] }, signal())).rejects.toThrow("expired");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not transfer a preview to another workspace and reports provider failures honestly", async () => {
    const f = await fixture(); const other = await fixture();
    const result = record(await f.service.handle(f.root, "discovery.search", { provider: "crossref", query: "test", disclose: true }, signal()));
    await expect(f.service.handle(other.root, "discovery.import", { searchId: result["searchId"], indices: [0] }, signal())).rejects.toThrow("another workspace");
    f.fetcher.mockResolvedValueOnce(new Response("", { status: 429 }));
    await expect(f.service.handle(f.root, "discovery.search", { provider: "openalex", query: "test", disclose: true }, signal())).rejects.toThrow("HTTP 429");
    f.fetcher.mockResolvedValueOnce(new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } }));
    await expect(f.service.handle(f.root, "discovery.search", { provider: "openalex", query: "test", disclose: true }, signal())).rejects.toThrow("2 MiB");
    expect(f.state().references).toEqual([]);
  });

  it("queries citation neighborhoods with validated work IDs and no PDF acquisition", async () => {
    const f = await fixture();
    f.fetcher.mockResolvedValueOnce(Response.json({ referenced_works: ["https://openalex.org/W2", "https://openalex.org/W3"] }));
    f.fetcher.mockResolvedValueOnce(Response.json({ meta: { count: 2 }, results: [{ id: "https://openalex.org/W2", title: "Related study", doi: "https://doi.org/10.1234/related", publication_year: 2024, authorships: [{ author: { display_name: "Other Author" } }], primary_location: { landing_page_url: "javascript:alert(1)" }, open_access: { oa_url: "https://example.test/oa.pdf" }, cited_by_count: 0 }] }));
    const result = await f.service.handle(f.root, "discovery.related", { externalId: "W1", direction: "references", disclose: true }, signal());
    expect(result).toMatchObject({ total: 2, candidates: [{ externalId: "W2", fields: { url: "https://openalex.org/W2", doi: "10.1234/related" }, openAccessUrl: "https://example.test/oa.pdf" }] });
    expect(f.fetcher.mock.calls[1]?.[0].searchParams.get("filter")).toBe("openalex:W2|W3");
    await expect(f.service.handle(f.root, "discovery.related", { externalId: "W1/../../secret", direction: "references", disclose: true }, signal())).rejects.toThrow("identity");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("stores local search recipes with revision checks, without running them", async () => {
    const f = await fixture(); const id = `search-${"a".repeat(32)}`;
    const list = await f.service.handle(f.root, "discovery.saved.list", {}, signal());
    expect(list).toEqual({ items: [], revision: 0 });
    await f.service.handle(f.root, "discovery.saved.save", { id, expectedRevision: 0, name: "Synthetic query", query: "test", provider: "openalex" }, signal());
    expect(f.state().savedSearches).toMatchObject([{ id, query: "test", checkedAt: null }]);
    await expect(f.service.handle(f.root, "discovery.saved.delete", { id, expectedRevision: 0 }, signal())).rejects.toThrow("changed");
    await f.service.handle(f.root, "discovery.saved.delete", { id, expectedRevision: 1 }, signal());
    expect(f.state().savedSearches).toEqual([]);
    expect(f.fetcher).not.toHaveBeenCalled();
    await expect(f.service.handle(f.root, "library.graph", {}, signal())).resolves.toMatchObject({ nodes: [], edges: [], warnings: [expect.stringContaining("not verified"), expect.any(String)] });
    await expect(f.service.handle(f.root, "discovery.search", { provider: "local", query: "test" }, signal())).resolves.toMatchObject({ candidates: [] });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
