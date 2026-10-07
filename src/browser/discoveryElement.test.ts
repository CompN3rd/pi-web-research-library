// @vitest-environment happy-dom
import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyReferenceFields } from "../domain/workbench.js";
import { defineLibraryDiscoveryElement, discoveryElementTag, LibraryDiscoveryElement } from "./discoveryElement.js";
import { previewFiles } from "./peer.testSupport.js";
import { toJson, type ResearchPeer } from "./peerClient.js";

beforeAll(defineLibraryDiscoveryElement);
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const response = () => toJson({ searchId: "12345678-1234-1234-1234-123456789012", provider: "crossref", query: "synthetic", page: 1, nextPage: null, total: 1, warnings: ["Metadata needs review"], candidates: [{ externalId: "10.1234/test", fields: { ...emptyReferenceFields(), title: "Study <script>not markup</script>", authors: ["Test Author"], year: 2026, doi: "10.1234/test" }, sourceUrl: "https://example.test/source", openAccessUrl: "", citationCount: 1 }] });
function mount() {
  const request = vi.fn<ResearchPeer["request"]>(() => Promise.resolve(response()));
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Local", kind: "local" }, workspace: { id: "w", projectId: "p", path: "/synthetic", label: "W", isMain: true }, peer: { request }, host: { requestRender: vi.fn() },
    files: { ...previewFiles(), readFile: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn(), listFiles: vi.fn() },
    prompt: { getText: () => "", getSelection: () => null, insertText: vi.fn() }, terminal: { open: vi.fn(), runCommand: vi.fn() },
  };
  const element = document.createElement(discoveryElementTag);
  if (!(element instanceof LibraryDiscoveryElement)) throw new Error("Discovery element missing");
  element.context = context; document.body.append(element);
  const root = element.shadowRoot; if (root === null) throw new Error("Shadow root missing");
  const click = (selector: string) => { const button = root.querySelector<HTMLButtonElement>(selector); if (button === null) throw new Error(`Missing ${selector}`); button.click(); };
  const prepare = () => {
    const provider = root.querySelector("select"); if (provider === null) throw new Error("Missing source"); provider.value = "crossref"; provider.dispatchEvent(new Event("change"));
    const query = root.querySelector<HTMLInputElement>('[aria-label="Literature query"]'); if (query === null) throw new Error("Missing query"); query.value = "synthetic"; query.dispatchEvent(new Event("input"));
  };
  const disclose = () => { const checkbox = root.querySelector<HTMLInputElement>("[data-disclose]"); if (checkbox === null) throw new Error("Missing disclosure"); checkbox.click(); };
  return { element, root, context, request, click, prepare, disclose };
}
async function complete(): Promise<void> { await new Promise<void>(resolve => setTimeout(resolve, 0)); }

describe("native discovery component", () => {
  it("never searches on mount and requires user disclosure before an external request", async () => {
    const f = mount(); expect(f.request).not.toHaveBeenCalled();
    f.prepare(); f.click("[data-search]"); await complete();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.root.textContent).toContain("Confirm disclosure");
    f.disclose(); f.click("[data-search]"); await complete();
    expect(f.request).toHaveBeenCalledWith("discovery.search", { version: 1, payload: { provider: "crossref", query: "synthetic", page: 1, disclose: true } }, expect.any(Object));
    expect(f.root.textContent).toContain("Study <script>not markup</script>");
    expect(f.root.querySelector("script")).toBeNull();
    expect(f.root.querySelector<HTMLInputElement>('[aria-label="Literature query"]')?.value).toBe("synthetic");
    expect(f.context.prompt.insertText).not.toHaveBeenCalled();
    expect(f.context.files.writeFile).not.toHaveBeenCalled();
  });

  it("preserves an explicit query across same-authority peer wrappers and uses the newest binding", async () => {
    const f = mount(); f.prepare(); f.disclose();
    const replacement = vi.fn<ResearchPeer["request"]>(() => Promise.resolve(response()));
    f.element.context = { ...f.context, peer: { request: replacement } };
    expect(f.root.querySelector<HTMLInputElement>('[aria-label="Literature query"]')?.value).toBe("synthetic");
    expect(f.root.querySelector<HTMLInputElement>("[data-disclose]")?.checked).toBe(true);
    expect(replacement).not.toHaveBeenCalled();
    f.click("[data-search]"); await complete();
    expect(replacement).toHaveBeenCalledTimes(1); expect(f.request).not.toHaveBeenCalled();
    f.element.context = { ...f.context, workspace: { ...f.context.workspace, path: "/other-root" } };
    expect(f.root.querySelector<HTMLInputElement>('[aria-label="Literature query"]')?.value).toBe("");
    expect(f.root.querySelector<HTMLInputElement>("[data-disclose]")?.checked).toBe(false);
  });

  it("clears the old OpenAlex neighborhood when applying a saved Crossref query", async () => {
    const f = mount();
    const provider = f.root.querySelector("select"); if (provider === null) throw new Error("Missing provider");
    provider.value = "openalex"; provider.dispatchEvent(new Event("change")); f.disclose();
    const neighborhood = { searchId: "12345678-1234-1234-1234-123456789012", provider: "openalex", query: "synthetic", page: 1, nextPage: 2, total: 2, warnings: [], candidates: [{ externalId: "W123", fields: { ...emptyReferenceFields(), title: "Old neighborhood" }, sourceUrl: "", openAccessUrl: "", citationCount: 1 }] };
    f.request.mockResolvedValue(toJson(neighborhood)); f.click("[data-search]"); await complete();
    const related = [...f.root.querySelectorAll("button")].find(button => button.textContent.startsWith("Find references"));
    if (related === undefined) throw new Error("Missing related action"); related.click(); await complete();
    expect(f.request.mock.lastCall?.[0]).toBe("discovery.related");
    f.root.querySelector<HTMLInputElement>('article input[type="checkbox"]')?.click();
    expect(f.root.querySelector<HTMLButtonElement>("[data-import]")?.disabled).toBe(false);
    f.click('[data-tab="saved"]');
    f.request.mockResolvedValueOnce(toJson({ revision: 1, items: [{ id: `search-${"a".repeat(32)}`, name: "Crossref recipe", query: "new query", provider: "crossref", checkedAt: null }] }));
    f.click("[data-load]"); await complete();
    const use = [...f.root.querySelectorAll("button")].find(button => button.textContent === "Use query");
    if (use === undefined) throw new Error("Missing saved query"); use.click();
    expect(f.root.querySelector("select")?.value).toBe("crossref");
    expect(f.root.querySelector<HTMLInputElement>("[data-disclose]")?.checked).toBe(false);
    expect(f.root.textContent).not.toContain("Old neighborhood");
    expect(f.root.textContent).not.toMatch(/Next results|Previous results|Find references|Find citing works/u);
    expect(f.root.querySelector<HTMLButtonElement>("[data-import]")?.disabled).toBe(true);
    const calls = f.request.mock.calls.length; f.disclose();
    expect(f.request).toHaveBeenCalledTimes(calls);
    f.click("[data-search]"); await complete();
    expect(f.request.mock.lastCall?.[0]).toBe("discovery.search");
    expect(f.request.mock.lastCall?.[1]).toMatchObject({ payload: { provider: "crossref", query: "new query", page: 1 } });
  });
  it("imports only checked preview rows after an explicit action", async () => {
    const f = mount(); f.prepare(); f.disclose(); f.click("[data-search]"); await complete();
    const checkbox = f.root.querySelector<HTMLInputElement>('article input[type="checkbox"]'); if (checkbox === null) throw new Error("Missing result checkbox"); checkbox.click();
    f.request.mockResolvedValueOnce(toJson({ added: [`ref-${"a".repeat(32)}`], skipped: [], warnings: [] }));
    f.click("[data-import]"); await complete();
    expect(f.request.mock.lastCall?.[0]).toBe("discovery.import");
    expect(f.request.mock.lastCall?.[1]).toEqual({ version: 1, payload: { searchId: "12345678-1234-1234-1234-123456789012", indices: [0] } });
    expect(f.root.textContent).toContain("Imported 1 reference(s)");
    expect(f.request.mock.calls.every(([operation]) => operation.startsWith("discovery."))).toBe(true);
  });

  it("suppresses late results across workspace changes and rejects executable source links", async () => {
    const f = mount(); let finish: ((value: ReturnType<typeof toJson>) => void) | undefined;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.prepare(); f.disclose(); f.click("[data-search]");
    f.element.context = { ...f.context, workspace: { ...f.context.workspace, id: "other" } };
    finish?.(response()); await complete();
    expect(f.root.textContent).not.toContain("Study <script>");
    f.prepare(); f.disclose();
    const invalid = { searchId: "test", provider: "crossref", query: "synthetic", page: 1, nextPage: null, total: 1, warnings: [], candidates: [{ externalId: "test", fields: { ...emptyReferenceFields(), title: "Unsafe" }, sourceUrl: "javascript:alert(1)", openAccessUrl: "", citationCount: null }] };
    f.request.mockResolvedValueOnce(toJson(invalid)); f.click("[data-search]"); await complete();
    expect(f.root.textContent).toContain("Unsafe metadata URL");
    expect(f.root.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("saves local search recipes when randomUUID is unavailable on LAN HTTP", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) });
    const f = mount();
    const query = f.root.querySelector<HTMLInputElement>('[aria-label="Literature query"]');
    if (query === null) throw new Error("Missing query"); query.value = "synthetic"; query.dispatchEvent(new Event("input"));
    f.click('[data-tab="saved"]');
    f.request.mockResolvedValue(toJson({ revision: 0, items: [] }));
    f.click("[data-load]"); await complete();
    const name = f.root.querySelector<HTMLInputElement>('[aria-label="Saved search name"]');
    if (name === null) throw new Error("Missing name"); name.value = "LAN recipe"; name.dispatchEvent(new Event("input"));
    f.click("[data-save]"); await complete();
    expect(f.request).toHaveBeenCalledWith("discovery.saved.save", { version: 1, payload: { id: `search-${"ab".repeat(16)}`, expectedRevision: 0, name: "LAN recipe", query: "synthetic", provider: "local" } }, expect.any(Object));
    expect(f.root.textContent).toContain("Search recipe saved locally");
    expect(f.request.mock.calls.map(([operation]) => operation)).toEqual(["discovery.saved.list", "discovery.saved.save", "discovery.saved.list"]);
  });

  it("loading or selecting a saved query never runs it or carries forward disclosure consent", async () => {
    const f = mount();
    f.request.mockResolvedValueOnce(toJson({ revision: 1, items: [{ id: `search-${"a".repeat(32)}`, name: "Saved test", query: "private research query", provider: "openalex", checkedAt: null }] }));
    f.click('[data-tab="saved"]'); f.click("[data-load]"); await complete();
    expect(f.request.mock.calls.map(([operation]) => operation)).toEqual(["discovery.saved.list"]);
    const use = Array.from(f.root.querySelectorAll("button")).find(button => button.textContent === "Use query"); if (use === undefined) throw new Error("Missing saved query action"); use.click();
    expect(f.root.querySelector<HTMLInputElement>('[aria-label="Literature query"]')?.value).toBe("private research query");
    expect(f.root.querySelector<HTMLInputElement>("[data-disclose]")?.checked).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});
