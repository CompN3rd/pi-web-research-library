// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineLibraryWorkbenchElement, LibraryWorkbenchElement } from "./workbenchElement.js";
import { ResearchLibraryPdfViewerElement, researchPdfSelectionEventName, researchPdfAnnotationEventName } from "./pdfViewerElement.js";
import { docId, evId, msId, now, refId, secondRefId, sha, syntheticEvidence, syntheticManuscript, syntheticReference, syntheticTask, taskId, workbenchHost } from "./workbench.testSupport.js";
import { evidence, fields, manuscript, reference } from "./workbenchClient.js";

beforeEach(() => {
  defineLibraryWorkbenchElement();
  // Canvas/PDF geometry is outside happy-dom; retain the real viewer event and marker boundary.
  vi.spyOn(ResearchLibraryPdfViewerElement.prototype, "sourceUrl", "set").mockImplementation(() => undefined);
  vi.spyOn(ResearchLibraryPdfViewerElement.prototype, "showPage").mockImplementation(() => undefined);
});
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function root(element: LibraryWorkbenchElement): ShadowRoot { if (element.shadowRoot === null) throw new Error("Missing shadow root"); return element.shadowRoot; }
function button(element: LibraryWorkbenchElement, label: string): HTMLButtonElement {
  const found = [...root(element).querySelectorAll("button")].find(item => item.textContent.trim() === label);
  if (found === undefined) throw new Error(`Button missing: ${label}`); return found;
}
function control(element: LibraryWorkbenchElement, label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const found = [...root(element).querySelectorAll("label")].find(item => [...item.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim() === label)?.querySelector("input,textarea,select");
  if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement || found instanceof HTMLSelectElement)) throw new Error(`Control missing: ${label}`);
  return found;
}
async function settle(element: LibraryWorkbenchElement): Promise<void> {
  await element.updateComplete;
  await vi.waitFor(() => { expect(root(element).querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe("false"); }, { timeout: 1000, interval: 1 });
  await element.updateComplete;
}
async function click(element: LibraryWorkbenchElement, label: string): Promise<void> { button(element, label).click(); await settle(element); }
async function input(element: LibraryWorkbenchElement, label: string, value: string): Promise<void> {
  const field = control(element, label); field.value = value; field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); await element.updateComplete;
}
async function check(element: LibraryWorkbenchElement, label: string): Promise<void> {
  const field = control(element, label); if (!(field instanceof HTMLInputElement)) throw new Error("Not checkbox"); field.click(); await element.updateComplete;
}
async function mount(host = workbenchHost()): Promise<LibraryWorkbenchElement> { const element = new LibraryWorkbenchElement(); element.context = host.context; document.body.append(element); await settle(element); return element; }
function viewer(element: LibraryWorkbenchElement): ResearchLibraryPdfViewerElement { const found = root(element).querySelector("pi-web-research-library-pdf-viewer"); if (!(found instanceof ResearchLibraryPdfViewerElement)) throw new Error("No viewer"); return found; }
async function selectReference(element: LibraryWorkbenchElement): Promise<void> { const field = root(element).querySelector<HTMLInputElement>(`input[aria-label="Select Synthetic paper"]`); if (field === null) throw new Error("No reference selection"); field.click(); await element.updateComplete; }

describe("native workbench catalog and reader", () => {
  it("mounts a rich accessible catalog without invoking models or mutating files", async () => {
    const host = workbenchHost(); const element = await mount(host);
    expect(root(element).textContent).toContain("Synthetic paper");
    expect(root(element).querySelector("nav[aria-label='Library workspace']")).not.toBeNull();
    expect(root(element).querySelector("[role=alert]")).not.toBeNull();
    expect(host.request.mock.calls.map(call => call[0])).toEqual(["library.list", "collections.list"]);
    expect(host.files.writeFile).not.toHaveBeenCalled();
    expect(host.files.uploadFile).not.toHaveBeenCalled();
  });
  it("keeps the reader mounted and pending metadata intact across filtering and refresh", async () => {
    const host = workbenchHost(); const element = await mount(host);
    await click(element, "Synthetic paper"); await click(element, "Reader"); await click(element, "Synthetic PDF");
    const reader = viewer(element);
    expect(Object.getOwnPropertyDescriptor(ResearchLibraryPdfViewerElement.prototype, "sourceUrl")?.set).toHaveBeenCalledWith("http://localhost:3000/raw/research-library/synthetic.pdf");
    await click(element, "Reference"); await input(element, "Title", "Unsaved synthetic title");
    host.overrides.set("library.list", () => ({ items: [], total: 0, nextOffset: null }));
    await input(element, "Search metadata", "no results"); await click(element, "Search / refresh library");
    expect(viewer(element)).toBe(reader);
    expect(control(element, "Title").value).toBe("Unsaved synthetic title");
    expect(root(element).textContent).toContain("Unsaved metadata");
    expect(host.payloads("library.list").at(-1)).toMatchObject({ query: "no results", offset: 0 });
    expect(host.payloads("tasks.start")).toHaveLength(0);
  });
  it("opens reading directly, puts document tools below the page, and toggles the catalog without remounting", async () => {
    const element = await mount(); await click(element, "Synthetic paper"); await click(element, "Reader");
    const reader = viewer(element);
    expect(root(element).querySelector("aside")?.hidden).toBe(true);
    expect(root(element).querySelector<HTMLDetailsElement>(".reader-tools")?.open).toBe(false);
    await click(element, "Show library"); expect(root(element).querySelector("aside")?.hidden).toBe(false);
    expect(viewer(element)).toBe(reader);
    await click(element, "Hide library"); await click(element, "Reference");
    expect(root(element).querySelector("aside")?.hidden).toBe(false);
    await click(element, "Reader"); expect(viewer(element)).toBe(reader);
  });
  it("recovers when a peer becomes available without discarding draft text", async () => {
    const host = workbenchHost(); const absent = { ...host.context }; delete absent.peer;
    const element = await mount({ ...host, context: absent });
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("server is unavailable");
    await click(element, "New reference"); await input(element, "Title", "Pending offline metadata");
    element.context = host.context; await settle(element);
    expect(host.payloads("library.list")).toHaveLength(1);
    expect(root(element).textContent).toContain("Synthetic paper");
    expect(control(element, "Title").value).toBe("Pending offline metadata");
    expect(root(element).querySelector("[role=alert]")?.textContent).toBe("");
  });
  it("uses a same-authority replacement peer for refresh without resetting drafts", async () => {
    const first = workbenchHost(); const next = workbenchHost();
    next.refs.splice(0, 2, syntheticReference(secondRefId, "Replacement peer paper"));
    const element = await mount(first); await click(element, "Synthetic paper"); await input(element, "Title", "Keep pending metadata");
    element.context = next.context; await settle(element);
    expect(next.request).not.toHaveBeenCalled();
    await click(element, "Search / refresh library");
    expect(next.payloads("library.list")).toHaveLength(1);
    expect(root(element).textContent).toContain("Replacement peer paper");
    expect(control(element, "Title").value).toBe("Keep pending metadata");
  });
  it("indexes and explicitly rebuilds only the selected verified document", async () => {
    const host = workbenchHost(); host.overrides.set("library.text.index", () => ({ pages: 3, warnings: [] }));
    const element = await mount(host); await click(element, "Synthetic paper");
    expect(button(element, "Rebuild current text index").disabled).toBe(true);
    await click(element, "Reader"); // Opens the first attachment, but does not index it.
    expect(button(element, "Rebuild current text index").disabled).toBe(false);
    expect(control(element, "Search document text").getAttribute("maxlength")).toBe("300");
    expect(host.payloads("library.text.index")).toHaveLength(0);
    await click(element, "Index current PDF"); await click(element, "Rebuild current text index");
    expect(host.payloads("library.text.index")).toEqual([{ referenceId: refId, documentId: docId }, { referenceId: refId, documentId: docId, rebuild: true }]);
    expect(root(element).textContent).toContain("Text index ready");
  });
  it("blocks reference switching until pending metadata is saved or explicitly discarded", async () => {
    const host = workbenchHost(); const element = await mount(host);
    await click(element, "Synthetic paper"); await input(element, "Title", "Pending text");
    await click(element, "Other synthetic paper");
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("Save or discard");
    expect(control(element, "Title").value).toBe("Pending text");
    await click(element, "Discard metadata edits"); await click(element, "Other synthetic paper");
    expect(control(element, "Title").value).toBe("Other synthetic paper");
  });
  it("saves complete metadata using entity revision and supports trash/restore", async () => {
    const host = workbenchHost(); const element = await mount(host); await click(element, "Synthetic paper");
    host.overrides.set("library.save", payload => ({ ...syntheticReference(), ...fields(payload["fields"]), revision: 2 }));
    await input(element, "Read state", "read"); await input(element, "Screening decision", "excluded"); await input(element, "Screening reason", "Synthetic mismatch"); await check(element, "Favorite"); await click(element, "Save metadata");
    expect(host.payloads("library.save")[0]).toMatchObject({ id: refId, expectedRevision: 1, fields: { readingStatus: "read", screening: "excluded", screeningReason: "Synthetic mismatch", favorite: true } });
    host.overrides.set("library.delete", () => ({ ...syntheticReference(), revision: 3, deletedAt: now }));
    await click(element, "Move reference to trash"); expect(host.payloads("library.delete")[0]).toEqual({ id: refId, expectedRevision: 2 });
    host.overrides.set("library.restore", () => ({ ...syntheticReference(), revision: 4 }));
    await click(element, "Restore reference"); expect(host.payloads("library.restore")[0]).toEqual({ id: refId, expectedRevision: 3 });
  });
  it("reviews both duplicate identities and requires a separate merge confirmation", async () => {
    const host = workbenchHost(); const element = await mount(host);
    host.overrides.set("library.duplicates", () => ({ pairs: [{ leftId: refId, rightId: secondRefId, reason: "Similar title" }] }));
    host.overrides.set("library.merge", () => ({ ...syntheticReference(), revision: 2 }));
    await click(element, "Find duplicates"); await click(element, "Review merge");
    expect(host.payloads("library.merge")).toHaveLength(0); expect(root(element).textContent).toContain("Retire: Other synthetic paper");
    await click(element, "Confirm merge");
    expect(host.payloads("library.merge")[0]).toEqual({ keepId: refId, removeId: secondRefId, keepRevision: 1, removeRevision: 1 });
  });
  it("uploads through public host files without overwriting and attaches server-verified paths", async () => {
    const host = workbenchHost(); host.overrides.set("library.attach", () => ({ ...syntheticReference(), revision: 2 }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Reader");
    const upload = control(element, "Upload local PDF");
    Object.defineProperty(upload, "files", { value: [new File(["synthetic PDF"], "sample.pdf", { type: "application/pdf" })] });
    upload.dispatchEvent(new Event("change", { bubbles: true })); await settle(element);
    expect(host.files.uploadFile).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ destinationFolder: "raw/research-library", createDirs: true, overwrite: false }));
    expect(host.payloads("library.attach")[0]).toEqual({ referenceId: refId, expectedRevision: 1, path: "raw/research-library/sample.pdf", label: "sample.pdf", sourceUrl: "", rights: "" });
    expect(host.files.writeFile).not.toHaveBeenCalled();
  });
});

describe("evidence and lifecycle safety", () => {
  it("rejects oversized UTF-8 imports before transport, not just oversized character counts", async () => {
    const host = workbenchHost(); const element = await mount(host); await click(element, "Import & export");
    await input(element, "Paste bibliography", "語".repeat(350_000)); await click(element, "Preview import");
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("at most 1 MiB in UTF-8");
    expect(host.payloads("library.import.preview")).toHaveLength(0);
  });
  it("turns a real reader region event into anchored evidence and retains identity on retry", async () => {
    const host = workbenchHost(); const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Reader"); await click(element, "Synthetic PDF");
    const markerSpy = vi.spyOn(ResearchLibraryPdfViewerElement.prototype, "annotations", "set");
    const selection = { page: 3, rect: { x: .1, y: .2, width: .3, height: .1 }, quote: "Synthetic passage" };
    viewer(element).dispatchEvent(new CustomEvent(researchPdfSelectionEventName, { detail: selection, bubbles: true, composed: true })); await element.updateComplete;
    expect(control(element, "Captured quote").value).toBe("Synthetic passage");
    await input(element, "Evidence note / question", "Check this claim");
    host.overrides.set("evidence.save", () => { throw new Error("Connection lost; retry safely"); });
    await click(element, "Save evidence"); expect(control(element, "Evidence note / question").value).toBe("Check this claim");
    host.overrides.set("evidence.save", payload => { const saved = evidence({ ...payload, revision: 1, createdAt: now, updatedAt: now, deletedAt: null }); host.notes.push(saved); return saved; });
    await click(element, "Save evidence");
    const [first, retry] = host.payloads("evidence.save"); expect(retry).toEqual(first);
    expect(retry?.["id"]).toMatch(/^ev-[a-f0-9]{32}$/u);
    expect(retry).toMatchObject({ expectedRevision: 0, referenceId: refId, documentId: docId, pdfSha256: sha, ...selection, body: "Check this claim" });
    expect(markerSpy).toHaveBeenLastCalledWith([expect.objectContaining({ page: 3, label: "Check this claim", rect: selection.rect })]);
    viewer(element).dispatchEvent(new CustomEvent(researchPdfAnnotationEventName, { detail: { id: retry?.["id"] } })); await element.updateComplete;
    expect(control(element, "Evidence note / question").value).toBe("Check this claim");
  });
  it("defers quote backlinks until the matching source is ready", async () => {
    const host = workbenchHost(); host.notes.push(syntheticEvidence()); const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Evidence");
    await click(element, "Read quote on page 3");
    expect(viewer(element).showPage).not.toHaveBeenCalled();
    viewer(element).dispatchEvent(new CustomEvent("research-pdf-ready", { detail: { sourceUrl: "http://localhost:3000/wrong.pdf", pageCount: 10 } }));
    expect(viewer(element).showPage).not.toHaveBeenCalled();
    viewer(element).dispatchEvent(new CustomEvent("research-pdf-ready", { detail: { sourceUrl: "http://localhost:3000/raw/research-library/synthetic.pdf", pageCount: 10 } }));
    expect(viewer(element).showPage).toHaveBeenCalledWith(3);
  });
  it("retains tombstone recovery messaging after evidence deletion", async () => {
    const host = workbenchHost(); host.notes.push(syntheticEvidence()); host.overrides.set("evidence.delete", () => ({ ...syntheticEvidence(), revision: 2, deletedAt: now }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Evidence"); await click(element, "Delete evidence");
    expect(host.payloads("evidence.delete")[0]).toEqual({ id: evId, expectedRevision: 1 });
    expect(root(element).textContent).toContain(".deleted recovery data is retained, not securely erased");
  });
  it.each(["workspace ID", "workspace path"])("aborts obsolete %s requests, suppresses late replies, and restores authority-owned drafts", async changed => {
    const oldHost = workbenchHost("old"); const newHost = workbenchHost(changed === "workspace path" ? "old" : "new");
    newHost.context = { ...newHost.context, workspace: { ...newHost.context.workspace, path: "/different-workspace" } };
    newHost.refs.splice(0, 2, syntheticReference(secondRefId, "New workspace reference"));
    const element = await mount(oldHost); await click(element, "Synthetic paper"); await input(element, "Title", "Old workspace unsaved text");
    let finish: (value: unknown) => void = () => { throw new Error("Not started"); };
    oldHost.overrides.set("library.list", () => new Promise(resolve => { finish = resolve; }));
    button(element, "Search / refresh library").click(); await element.updateComplete;
    element.context = newHost.context; await settle(element);
    finish({ items: [syntheticReference(refId, "STALE REPLY")], total: 1, nextOffset: null }); await settle(element);
    expect(root(element).textContent).not.toContain("STALE REPLY");
    expect(root(element).textContent).not.toContain("Old workspace unsaved text");
    expect(oldHost.request.mock.calls.at(-1)?.[2]?.signal?.aborted).toBe(true);
    oldHost.overrides.delete("library.list"); element.context = oldHost.context; await settle(element);
    expect(control(element, "Title").value).toBe("Old workspace unsaved text");
  });
});

describe("independent review regressions", () => {
  it("preserves pending evidence when restored metadata is saved after a workspace round trip", async () => {
    const host = workbenchHost("workspace-A"); host.notes.push(syntheticEvidence());
    host.overrides.set("library.save", payload => ({ ...syntheticReference(), ...fields(payload["fields"]), revision: 2 }));
    host.overrides.set("evidence.save", payload => evidence({ ...payload, revision: 2, createdAt: now, updatedAt: now, deletedAt: null }));
    const element = await mount(host); await click(element, "Synthetic paper"); await input(element, "Title", "Pending metadata title");
    await click(element, "Evidence"); await click(element, "Edit evidence"); await input(element, "Evidence note / question", "Pending evidence survives metadata save");
    element.context = workbenchHost("workspace-B").context; await settle(element);
    element.context = host.context; await settle(element);
    await click(element, "Reference"); await click(element, "Save metadata");
    expect(host.payloads("library.save")[0]).toMatchObject({ id: refId, expectedRevision: 1, fields: { title: "Pending metadata title" } });
    await click(element, "Evidence");
    expect(control(element, "Evidence note / question").value).toBe("Pending evidence survives metadata save");
    expect(button(element, "Discard evidence edits").disabled).toBe(false);
    await click(element, "Other synthetic paper");
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("Save or discard");
    await click(element, "Save evidence");
    expect(host.payloads("evidence.save")[0]).toMatchObject({ id: evId, expectedRevision: 1, referenceId: refId, documentId: docId, body: "Pending evidence survives metadata save" });
    await click(element, "New unanchored note");
    expect(control(element, "Evidence note / question").value).toBe("");
    await click(element, "Discard evidence edits"); await click(element, "Other synthetic paper");
    expect(control(element, "Title").value).toBe("Other synthetic paper");
  });
  it("requires explicit evidence save or discard before saving metadata for a different reference", async () => {
    const host = workbenchHost();
    host.overrides.set("library.save", payload => reference({ ...syntheticReference(), ...fields(payload["fields"]), id: payload["id"], documents: [] }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "New reference");
    await input(element, "Title", "Different reference draft"); await input(element, "Citekey", "Different2026");
    await click(element, "Evidence"); await click(element, "New unanchored note"); await input(element, "Evidence note / question", "Evidence for the original reference");
    await click(element, "Reference"); await click(element, "Save metadata");
    expect(host.payloads("library.save")).toHaveLength(0);
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("different reference");
    await click(element, "Evidence"); expect(control(element, "Evidence note / question").value).toBe("Evidence for the original reference");
    await click(element, "Discard evidence edits"); await click(element, "Reference"); await click(element, "Save metadata");
    expect(host.payloads("library.save")).toHaveLength(1);
    expect(control(element, "Title").value).toBe("Different reference draft");
  });
  it("initially displays saved non-default reference selections and submits those same values", async () => {
    const host = workbenchHost();
    host.refs.splice(0, 1, { ...syntheticReference(), type: "book", readingStatus: "read", screening: "excluded", screeningReason: "Synthetic exclusion" });
    host.overrides.set("library.save", payload => ({ ...syntheticReference(), ...fields(payload["fields"]), revision: 2 }));
    const element = await mount(host); await click(element, "Synthetic paper");
    expect(control(element, "Reference type").value).toBe("book");
    expect(control(element, "Read state").value).toBe("read");
    expect(control(element, "Screening decision").value).toBe("excluded");
    await click(element, "Save metadata");
    expect(host.payloads("library.save")[0]).toMatchObject({ fields: { type: "book", readingStatus: "read", screening: "excluded" } });
  });
  it("initially displays saved and new evidence selections matching their submitted kind and status", async () => {
    const host = workbenchHost(); host.notes.push({ ...syntheticEvidence(), kind: "note", status: "resolved" });
    host.overrides.set("evidence.save", payload => evidence({ ...payload, revision: 2, createdAt: now, updatedAt: now, deletedAt: null }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Evidence"); await click(element, "Edit evidence");
    expect(control(element, "Kind").value).toBe("note"); expect(control(element, "Status").value).toBe("resolved");
    await click(element, "Save evidence"); expect(host.payloads("evidence.save")[0]).toMatchObject({ id: evId, kind: "note", status: "resolved" });
    await click(element, "New unanchored note");
    expect(control(element, "Kind").value).toBe("note"); expect(control(element, "Status").value).toBe("open");
    await input(element, "Evidence note / question", "New note with initially displayed kind"); await click(element, "Save evidence");
    expect(host.payloads("evidence.save")[1]).toMatchObject({ expectedRevision: 0, documentId: null, kind: "note", status: "open" });
  });
  it("initially displays a saved non-default manuscript citation style and submits it unchanged", async () => {
    const host = workbenchHost(); host.manuscripts.push({ ...syntheticManuscript(), style: "harvard1" });
    host.overrides.set("writing.save", payload => manuscript({ ...payload, revision: 2, createdAt: now, updatedAt: now, deletedAt: null }));
    const element = await mount(host); await click(element, "Writing"); await click(element, "Synthetic draft");
    expect(control(element, "Citation style").value).toBe("harvard1");
    await click(element, "Save manuscript"); expect(host.payloads("writing.save")[0]).toMatchObject({ id: msId, style: "harvard1" });
  });
  it("restarts catalog pagination when editable filters differ from the displayed page", async () => {
    const host = workbenchHost();
    host.overrides.set("library.list", payload => ({ items: [syntheticReference(payload["offset"] === 0 ? refId : secondRefId, payload["tag"] === undefined ? "Unfiltered catalog row" : payload["offset"] === 0 ? "First tagged row" : "Second tagged row")], total: 2, nextOffset: payload["offset"] === 0 ? 1 : null }));
    const element = await mount(host); expect(root(element).textContent).toContain("Unfiltered catalog row");
    await input(element, "Tag", "new-tag"); await click(element, "Load more references");
    expect(host.payloads("library.list").at(-1)).toMatchObject({ tag: "new-tag", offset: 0 });
    expect(root(element).textContent).not.toContain("Unfiltered catalog row"); expect(root(element).textContent).toContain("First tagged row");
    await click(element, "Load more references");
    expect(host.payloads("library.list").at(-1)).toMatchObject({ tag: "new-tag", offset: 1 });
    expect(root(element).textContent).toContain("First tagged row"); expect(root(element).textContent).toContain("Second tagged row");
  });
  it("restarts evidence pagination on changed filters instead of appending a different search", async () => {
    const host = workbenchHost();
    host.overrides.set("evidence.list", payload => ({ items: [{ ...syntheticEvidence(), id: payload["offset"] === 0 ? evId : `ev-${"8".repeat(32)}`, body: payload["kind"] === undefined ? "Unfiltered evidence row" : payload["offset"] === 0 ? "First filtered note" : "Second filtered note", kind: payload["kind"] ?? "question" }], total: 2, nextOffset: payload["offset"] === 0 ? 1 : null }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Evidence");
    expect(root(element).textContent).toContain("Unfiltered evidence row");
    await input(element, "Evidence kind", "note"); await click(element, "Load more evidence");
    expect(host.payloads("evidence.list").at(-1)).toMatchObject({ referenceId: refId, kind: "note", offset: 0 });
    expect(root(element).textContent).not.toContain("Unfiltered evidence row"); expect(root(element).textContent).toContain("First filtered note");
    await click(element, "Load more evidence");
    expect(host.payloads("evidence.list").at(-1)).toMatchObject({ referenceId: refId, kind: "note", offset: 1 });
    expect(root(element).textContent).toContain("First filtered note"); expect(root(element).textContent).toContain("Second filtered note");
  });
});

describe("explicit task and writing consent", () => {
  it("previews exact disclosure, starts only with consent, and exposes reviewed structured claims and matrix", async () => {
    const host = workbenchHost(); const result = syntheticTask(); host.tasks.push(result);
    host.overrides.set("tasks.preview", payload => ({ corpusHash: sha, prompt: "Exact synthetic prompt; untrusted evidence follows", referenceIds: payload["referenceIds"], warnings: ["Model provider disclosure"] }));
    host.overrides.set("tasks.start", () => result);
    host.overrides.set("tasks.review", () => { const accepted = syntheticTask("accepted"); host.tasks.splice(0, 1, accepted); return accepted; });
    const element = await mount(host); await selectReference(element); await click(element, "Research"); await input(element, "Research goal", "Summarize the synthetic paper");
    await click(element, "Preview model disclosure");
    expect(host.payloads("tasks.start")).toHaveLength(0); expect(button(element, "Confirm and start model task").disabled).toBe(true);
    expect(root(element).textContent).toContain("Exact synthetic prompt");
    await check(element, "I consent to running this task with this disclosed corpus."); await click(element, "Confirm and start model task");
    expect(host.payloads("tasks.start")[0]?.["id"]).toMatch(/^task-[a-f0-9]{32}$/u);
    expect(host.payloads("tasks.start")[0]).toMatchObject({ kind: "summary", goal: "Summarize the synthetic paper", referenceIds: [refId], expectedCorpusHash: sha });
    expect(root(element).textContent).toContain("synthetic-host-session"); expect(root(element).textContent).toContain("Synthetic claim"); expect(root(element).querySelector("table")?.textContent).toContain("Synthetic method");
    expect(button(element, "Create manuscript from accepted result").disabled).toBe(true);
    await click(element, "Accept reviewed result"); expect(host.payloads("tasks.review")[0]).toEqual({ id: taskId, expectedRevision: 1, decision: "accepted" });
    await click(element, "Create manuscript from accepted result"); expect(control(element, "Markdown manuscript").value).toBe("Synthetic result [@Synthetic2026]");
    expect(host.payloads("writing.save")).toHaveLength(0);
  });
  it("invalidates model disclosure when its recipe or goal changes", async () => {
    const host = workbenchHost(); host.overrides.set("tasks.preview", () => ({ corpusHash: sha, prompt: "Synthetic prompt", referenceIds: [refId], warnings: [] }));
    const element = await mount(host); await selectReference(element); await click(element, "Research"); await input(element, "Research goal", "First goal"); await click(element, "Preview model disclosure"); await check(element, "I consent to running this task with this disclosed corpus.");
    await input(element, "Research goal", "Different goal"); expect(root(element).textContent).not.toContain("Confirm and start model task"); expect(host.payloads("tasks.start")).toHaveLength(0);
  });
  it("marks an otherwise unchanged manuscript dirty when removing a task binding", async () => {
    const host = workbenchHost(); host.manuscripts.push({ ...syntheticManuscript(), taskIds: [taskId] });
    const element = await mount(host); await click(element, "Writing"); await click(element, "Synthetic draft");
    expect(button(element, "Audit citations & evidence").disabled).toBe(false);
    await click(element, "Remove task binding");
    expect(control(element, "Markdown manuscript").value).toBe(syntheticManuscript().markdown);
    expect(button(element, "Audit citations & evidence").disabled).toBe(true);
    expect(root(element).textContent).toContain("Unsaved manuscript");
    expect(host.payloads("writing.save")).toHaveLength(0);
  });
  it("explicitly removes stale task bindings without discarding manuscript edits", async () => {
    const host = workbenchHost(); host.manuscripts.push({ ...syntheticManuscript(), taskIds: [taskId] });
    host.overrides.set("writing.save", payload => {
      if (Array.isArray(payload["taskIds"]) && payload["taskIds"].length > 0) throw new Error("Task must have an accepted current result");
      return manuscript({ ...payload, revision: 2, createdAt: now, updatedAt: now, deletedAt: null });
    });
    const element = await mount(host); await click(element, "Writing"); await click(element, "Synthetic draft");
    await input(element, "Markdown manuscript", "Preserved edited discussion [@Synthetic2026]");
    await click(element, "Save manuscript"); expect(root(element).textContent).toContain("accepted current result");
    await click(element, "Remove task binding");
    expect(control(element, "Markdown manuscript").value).toBe("Preserved edited discussion [@Synthetic2026]");
    expect(button(element, "Audit citations & evidence").disabled).toBe(true);
    expect(root(element).textContent).toContain("old acceptance no longer applies");
    await click(element, "Save manuscript");
    expect(host.payloads("writing.save").at(-1)).toMatchObject({ id: msId, expectedRevision: 1, taskIds: [], markdown: "Preserved edited discussion [@Synthetic2026]" });
    expect(button(element, "Audit citations & evidence").disabled).toBe(false);
  });
  it("sends a 200-character evidence query and rejects a 201-character value before transport", async () => {
    const host = workbenchHost(); const element = await mount(host); await click(element, "Evidence");
    expect(control(element, "Search evidence").getAttribute("maxlength")).toBe("200");
    await input(element, "Search evidence", "q".repeat(200)); await click(element, "Refresh evidence");
    expect(host.payloads("evidence.list").at(-1)).toMatchObject({ query: "q".repeat(200) });
    const count = host.payloads("evidence.list").length;
    await input(element, "Search evidence", "q".repeat(201)); await click(element, "Refresh evidence");
    expect(host.payloads("evidence.list")).toHaveLength(count);
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("200 characters or fewer");
  });
  it("saves a revision-bound manuscript, inserts citations, audits, then separately confirms file apply", async () => {
    const host = workbenchHost(); host.manuscripts.push(syntheticManuscript());
    host.overrides.set("writing.save", payload => manuscript({ ...payload, revision: 2, createdAt: now, updatedAt: now, deletedAt: null }));
    host.overrides.set("writing.audit", () => ({ issues: [{ kind: "human-review", message: "Check support manually" }], citationKeys: ["Synthetic2026"], bibliography: "Example (2026). Synthetic paper." }));
    host.overrides.set("writing.apply.preview", () => ({ expectedHash: sha, previewToken: "synthetic-preview-token", text: "New synthetic draft", diff: "-old\n+New synthetic draft" }));
    host.overrides.set("writing.apply", () => ({ path: "drafts/synthetic.md", backupPath: "drafts/synthetic.md.backup", sha256: sha }));
    const element = await mount(host); await click(element, "Writing"); await click(element, "Synthetic draft"); await input(element, "Markdown manuscript", "Revised synthetic claim "); await input(element, "Citation picker", refId); await click(element, "Insert citation");
    expect(control(element, "Markdown manuscript").value).toContain("[@Synthetic2026]"); expect(button(element, "Audit citations & evidence").disabled).toBe(true);
    await click(element, "Save manuscript"); expect(host.payloads("writing.save")[0]).toMatchObject({ id: msId, expectedRevision: 1, referenceIds: [refId] });
    await click(element, "Audit citations & evidence"); expect(root(element).textContent).toContain("Check support manually");
    await input(element, "Workspace target path", "drafts/synthetic.md"); await click(element, "Preview file changes");
    expect(host.payloads("writing.apply")).toHaveLength(0); expect(button(element, "Confirm apply to file").disabled).toBe(true);
    await check(element, "I reviewed the target and diff and consent to this file write."); await click(element, "Confirm apply to file");
    expect(host.payloads("writing.apply")[0]).toEqual({ id: msId, expectedRevision: 2, path: "drafts/synthetic.md", expectedHash: sha, previewToken: "synthetic-preview-token" });
    expect(root(element).textContent).toContain("Backup retained: drafts/synthetic.md.backup"); expect(host.files.writeFile).not.toHaveBeenCalled();
  });
  it("retains a rejected apply preview until an explicit re-preview and requires fresh consent for its new token", async () => {
    const host = workbenchHost(); host.manuscripts.push(syntheticManuscript());
    host.overrides.set("writing.apply.preview", () => ({ expectedHash: sha, previewToken: "old-preview-token", text: "Old synthetic output", diff: "+Old output" }));
    host.overrides.set("writing.apply", () => { throw new Error("Preview token expired; preview again"); });
    const element = await mount(host); await click(element, "Writing"); await click(element, "Synthetic draft"); await input(element, "Workspace target path", "drafts/synthetic.md"); await click(element, "Preview file changes");
    await check(element, "I reviewed the target and diff and consent to this file write."); await click(element, "Confirm apply to file");
    expect(host.payloads("writing.apply")[0]?.["previewToken"]).toBe("old-preview-token"); expect(root(element).textContent).toContain("Old synthetic output"); expect(root(element).querySelector("[role=alert]")?.textContent).toContain("Preview token expired");
    host.overrides.set("writing.apply.preview", () => ({ expectedHash: sha, previewToken: "fresh-preview-token", text: "Updated synthetic bibliography", diff: "+Updated bibliography" }));
    await click(element, "Preview file changes"); expect(button(element, "Confirm apply to file").disabled).toBe(true); expect(root(element).textContent).toContain("Updated synthetic bibliography"); expect(host.payloads("writing.apply")).toHaveLength(1);
    await check(element, "I reviewed the target and diff and consent to this file write."); await click(element, "Confirm apply to file"); expect(host.payloads("writing.apply")[1]?.["previewToken"]).toBe("fresh-preview-token");
  });
  it("invalidates file consent on edits and renders hostile text without execution", async () => {
    const host = workbenchHost(); host.manuscripts.push({ ...syntheticManuscript(), markdown: "<script>window.bad=true</script>" });
    host.overrides.set("writing.apply.preview", () => ({ expectedHash: null, previewToken: "synthetic-preview-token", text: "<img src=x onerror=alert(1)>", diff: "+<script>evil</script>" }));
    const element = await mount(host); await click(element, "Writing"); await click(element, "Synthetic draft"); await input(element, "Workspace target path", "drafts/synthetic.md"); await click(element, "Preview file changes");
    expect(root(element).querySelector("script,img")).toBeNull();
    await check(element, "I reviewed the target and diff and consent to this file write."); await input(element, "Markdown manuscript", "Changed after preview");
    expect(root(element).textContent).not.toContain("Confirm apply to file"); expect(host.payloads("writing.apply")).toHaveLength(0);
  });
});

describe("bounds, revisions and recovery", () => {
  it("creates a native reference with a stable browser identity and clears the previous reader", async () => {
    const host = workbenchHost(); const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Reader"); await click(element, "Synthetic PDF");
    await click(element, "New reference"); await input(element, "Title", "New synthetic reference"); await input(element, "Citekey", "New2026");
    host.overrides.set("library.save", payload => reference({ ...syntheticReference(), ...fields(payload["fields"]), id: payload["id"], documents: [] }));
    await click(element, "Save metadata");
    expect(host.payloads("library.save")[0]?.["id"]).toMatch(/^ref-[a-f0-9]{32}$/u); expect(host.payloads("library.save")[0]?.["expectedRevision"]).toBe(0);
    expect(root(element).querySelector("pi-web-research-library-pdf-viewer")).toBeNull(); expect(control(element, "Title").value).toBe("New synthetic reference");
  });
  it("preserves edited text and revision when the server rejects a stale save", async () => {
    const host = workbenchHost(); host.overrides.set("library.save", () => { throw new Error("Revision conflict: reload the reference"); });
    const element = await mount(host); await click(element, "Synthetic paper"); await input(element, "Private notes", "Unsent synthetic notes"); await click(element, "Save metadata");
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("Revision conflict"); expect(control(element, "Private notes").value).toBe("Unsent synthetic notes"); expect(host.payloads("library.save")[0]?.["expectedRevision"]).toBe(1);
  });
  it("paginates with explicit offsets and carries bounded filters", async () => {
    const host = workbenchHost(); host.overrides.set("library.list", payload => ({ items: [syntheticReference(payload["offset"] === 0 ? refId : secondRefId, payload["offset"] === 0 ? "First page" : "Next page")], total: 2, nextOffset: payload["offset"] === 0 ? 1 : null }));
    const element = await mount(host); await input(element, "Tag", "synthetic"); await input(element, "Reading status", "read"); await input(element, "Screening", "included"); await check(element, "Favorites only"); await click(element, "Search / refresh library"); await click(element, "Load more references");
    expect(host.payloads("library.list").at(-1)).toMatchObject({ offset: 1, tag: "synthetic", readingStatus: "read", screening: "included", favorite: true, trash: false }); expect(root(element).textContent).toContain("First page"); expect(root(element).textContent).toContain("Next page"); expect(button(element, "Load more references").disabled).toBe(true);
  });
  it("creates and edits collection hierarchy using collection revisions", async () => {
    const host = workbenchHost(); const colId = `col-${"7".repeat(32)}`; const parent = { id: colId, name: "Synthetic parent", parentId: null, revision: 4 };
    host.overrides.set("collections.list", () => [parent]); host.overrides.set("collections.save", payload => ({ id: payload["id"], name: payload["name"], parentId: payload["parentId"], revision: Number(payload["expectedRevision"]) + 1 }));
    const element = await mount(host); await input(element, "Collection name", "Synthetic child"); await input(element, "Parent collection", colId); await click(element, "Save collection"); expect(host.payloads("collections.save")[0]).toMatchObject({ expectedRevision: 0, name: "Synthetic child", parentId: colId });
    await click(element, "Edit Synthetic parent"); await input(element, "Collection name", "Renamed parent"); await click(element, "Save collection"); expect(host.payloads("collections.save")[1]).toEqual({ id: colId, expectedRevision: 4, name: "Renamed parent", parentId: null });
    await click(element, "Edit Synthetic parent"); host.overrides.set("collections.delete", () => { throw new Error("Move nested collections before deleting"); }); await click(element, "Delete collection"); expect(root(element).querySelector("[role=alert]")?.textContent).toContain("Move nested collections"); expect(host.payloads("collections.delete")[0]).toEqual({ id: colId, expectedRevision: 4 });
  });
  it("matches cross-lane editor limits and refuses oversized captured quotes without truncating", async () => {
    const host = workbenchHost(); const element = await mount(host); await click(element, "Synthetic paper");
    expect(control(element, "Title").getAttribute("maxlength")).toBe("1000");
    expect(control(element, "Journal / container").getAttribute("maxlength")).toBe("1000");
    expect(control(element, "Abstract").getAttribute("maxlength")).toBe("16000");
    expect(control(element, "Private notes").getAttribute("maxlength")).toBe("32000");
    await click(element, "Reader"); await click(element, "Synthetic PDF");
    viewer(element).dispatchEvent(new CustomEvent(researchPdfSelectionEventName, { detail: { page: 1, rect: { x: .1, y: .1, width: .5, height: .5 }, quote: "x".repeat(16_001) } })); await element.updateComplete;
    expect(root(element).querySelector("[role=alert]")?.textContent).toContain("Mark a smaller region"); expect(host.payloads("evidence.save")).toHaveLength(0);
    await click(element, "Evidence"); await click(element, "New unanchored note"); expect(control(element, "Evidence note / question").getAttribute("maxlength")).toBe("16000");
    await click(element, "Writing"); await click(element, "New manuscript"); expect(control(element, "Markdown manuscript").getAttribute("maxlength")).toBe("128000");
  });
  it("creates honest unanchored notes without manufacturing PDF provenance", async () => {
    const host = workbenchHost(); host.overrides.set("evidence.save", payload => evidence({ ...payload, revision: 1, createdAt: now, updatedAt: now, deletedAt: null }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Evidence"); await click(element, "New unanchored note"); await input(element, "Evidence note / question", "Unanchored synthetic thought"); await click(element, "Save evidence");
    expect(host.payloads("evidence.save")[0]).toMatchObject({ referenceId: refId, documentId: null, pdfSha256: null, page: null, rect: null, quote: "", kind: "note", expectedRevision: 0 });
  });
  it("cancels in-flight uploads when workspace authority changes", async () => {
    const host = workbenchHost(); const cancel = vi.fn(); let complete: () => void = () => { throw new Error("Upload not started"); };
    vi.mocked(host.files.uploadFile).mockImplementation(() => ({ path: "raw/research-library/pending.pdf", completed: new Promise(resolve => { complete = () => { resolve({ path: "raw/research-library/pending.pdf", size: 10, modifiedAt: now, created: true }); }; }), cancel }));
    const element = await mount(host); await click(element, "Synthetic paper"); await click(element, "Reader"); const upload = control(element, "Upload local PDF"); Object.defineProperty(upload, "files", { value: [new File(["synthetic"], "pending.pdf")] }); upload.dispatchEvent(new Event("change", { bubbles: true })); await element.updateComplete;
    element.context = workbenchHost("different").context; await settle(element); expect(cancel).toHaveBeenCalledOnce(); complete(); await settle(element); expect(host.payloads("library.attach")).toHaveLength(0); expect(root(element).textContent).not.toContain("Uploaded to");
  });
  it("shows failed companion sessions explicitly and never offers result acceptance", async () => {
    const host = workbenchHost(); host.tasks.push({ ...syntheticTask(), status: "failed", result: null, message: "Companion result bridge is unavailable" });
    const element = await mount(host); await click(element, "Research"); await click(element, "summary: Summarize synthetic evidence"); expect(root(element).textContent).toContain("Companion result bridge is unavailable"); expect(root(element).textContent).not.toContain("Accept reviewed result"); expect(host.payloads("tasks.start")).toHaveLength(0);
  });
});

describe("bibliography staging and portability", () => {
  it("requires explicit row selection and commits only selected staged rows", async () => {
    const host = workbenchHost(); host.overrides.set("library.import.preview", () => ({ references: host.refs.map(fields), warnings: ["Synthetic warning"], duplicateCandidates: [{ index: 0, referenceId: refId, reason: "DOI match" }], fingerprint: sha }));
    host.overrides.set("library.import.commit", () => ({ added: [secondRefId], skipped: 0, warnings: [] }));
    const element = await mount(host); await click(element, "Import & export"); await input(element, "Paste bibliography", "synthetic bibliography"); await click(element, "Preview import");
    expect(button(element, "Import 0 selected rows").disabled).toBe(true); expect(root(element).textContent).toContain("DOI match");
    await check(element, "Other synthetic paper"); await click(element, "Import 1 selected rows");
    expect(host.payloads("library.import.commit")[0]).toEqual({ format: "bibtex", text: "synthetic bibliography", indices: [1] });
  });
  it("downloads selected standard bibliography only after an explicit export action", async () => {
    const host = workbenchHost(); host.overrides.set("library.export", () => ({ text: "@article{Synthetic2026}", filename: "synthetic.bib", mime: "text/plain" }));
    const create = vi.fn(() => "blob:synthetic"); const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL { static override createObjectURL = create; static override revokeObjectURL = revoke; });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const element = await mount(host); await selectReference(element); await click(element, "Import & export"); expect(create).not.toHaveBeenCalled(); await click(element, "Download bibliography");
    expect(host.payloads("library.export")[0]).toEqual({ referenceIds: [refId], format: "bibtex" }); expect(create).toHaveBeenCalledOnce(); expect(anchorClick).toHaveBeenCalledOnce();
  });
});
