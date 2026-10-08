// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundedOutputScale,
  defineResearchLibraryPdfViewerElement,
  researchPdfAnnotationEventName,
  researchPdfSelectionEventName,
  researchPdfReadyEventName,
  type ResearchPdfSelectionDetail,
  MAX_PDF_RENDER_DIMENSION,
  MAX_PDF_RENDER_PIXELS,
  isPdfJsModule,
  ResearchLibraryPdfViewerElement,
  researchLibraryPdfViewerTagName,
  type PdfJsModule,
} from "./pdfViewerElement.js";

beforeEach(() => {
  defineResearchLibraryPdfViewerElement();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ResearchLibraryPdfViewerElement", () => {
  it("loads with hardened options, preloads a neighbor, and bounds page/zoom controls", async () => {
    const harness = fakePdfJs(2);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 2");

    const loadInput = harness.getDocument.mock.calls[0]?.[0];
    expect(loadInput?.url).toContain("paper.pdf");
    expect(loadInput).toMatchObject({ isEvalSupported: false, enableXfa: false, disableAutoFetch: false, disableStream: false, maxImageSize: MAX_PDF_RENDER_PIXELS });
    expect(harness.workerOptions.workerSrc).toContain("/pdfjs/pdf.worker.min.mjs");
    expect(pageAt(harness.pages, 0).render).toHaveBeenCalledTimes(1);
    harness.loadingTask.onProgress({ loaded: 10, total: 100 });
    expect(shadow(element, "[data-status]", HTMLElement).dataset["state"]).toBe("ready");
    expect(shadowButton(element, "[data-mark]").disabled).toBe(false);

    shadowButton(element, "[data-previous]").click();
    expect(harness.document.getPage).toHaveBeenCalledTimes(2);
    shadowButton(element, "[data-next]").click();
    await statusIncludes(element, "Page 2 of 2");
    shadowButton(element, "[data-next]").click();
    expect(harness.document.getPage).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 20; index += 1) {
      shadowButton(element, "[data-zoom-in]").click();
      await settle();
    }
    await statusIncludes(element, "300%");
    expect(shadowButton(element, "[data-zoom-in]").disabled).toBe(true);

    const fallback = shadow(element, "[data-open-pdf]", HTMLAnchorElement);
    expect(fallback.href).toContain("paper.pdf");
    expect(fallback.hidden).toBe(false);
    expect(fallback.target).toBe("_blank");
    expect(fallback.rel).toContain("noopener");
    expect(shadow(element, "[data-active-page=true] canvas", HTMLCanvasElement).getAttribute("aria-label")).toContain("page 2 of 2");
  });

  it("connects page previews to continuous navigation and resets them on source teardown", async () => {
    const harness = fakePdfJs(8);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 8");
    shadowButton(element, "[data-thumbnails-toggle]").click(); await settle();
    expect(element.shadowRoot?.querySelectorAll("[data-thumbnail-page]")).toHaveLength(6);
    shadowButton(element, '[data-thumbnail-page="4"]').click();
    await statusIncludes(element, "Page 4 of 8");
    expect(element.currentPage).toBe(4);
    expect(shadowButton(element, '[data-thumbnail-page="4"]').getAttribute("aria-current")).toBe("page");
    element.showPage(8); await statusIncludes(element, "Page 8 of 8");
    expect(shadowButton(element, '[data-thumbnail-page="8"]').getAttribute("aria-current")).toBe("page");
    element.sourceUrl = undefined; await statusIncludes(element, "No PDF selected");
    expect(shadow(element, "[data-thumbnails]", HTMLElement).hidden).toBe(true);
    expect(shadowButton(element, "[data-thumbnails-toggle]").disabled).toBe(true);
    expect(element.shadowRoot?.querySelectorAll("[data-thumbnail-page]")).toHaveLength(0);
  });

  it("connects internal outline destinations to continuous pages and thumbnail state without another document", async () => {
    const harness = fakePdfJs(8);
    const getOutline = vi.fn().mockResolvedValue([{ title: "Methods", dest: "methods", items: [] }]);
    Object.assign(harness.document, { getOutline, getDestination: vi.fn().mockResolvedValue([{ num: 12, gen: 0 }, { name: "Fit" }]), getPageIndex: vi.fn().mockResolvedValue(3) });
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 8");
    expect(getOutline).not.toHaveBeenCalled();
    shadowButton(element, "[data-thumbnails-toggle]").click();
    shadowButton(element, "[data-outline-toggle]").click(); await settle();
    shadowButton(element, "[data-outline] li button").click();
    await statusIncludes(element, "Page 4 of 8");
    expect(shadowButton(element, '[data-thumbnail-page="4"]').getAttribute("aria-current")).toBe("page");
    expect(harness.getDocument).toHaveBeenCalledOnce();
    element.remove(); await settle();
    expect(shadow(element, "[data-outline]", HTMLElement).hidden).toBe(true);
    expect(element.shadowRoot?.querySelectorAll("[data-outline] li")).toHaveLength(0);
  });

  it("applies a pending fitted viewport change with an explicit page jump", async () => {
    const harness = fakePdfJs(3), element = createViewer(); element.pdfJsLoader = harness.loader;
    const viewport = shadow(element, ".viewport", HTMLElement);
    // Inject dimensions at the DOM boundary; assert render input, not happy-dom geometry.
    let width = 640;
    Object.defineProperty(viewport, "clientWidth", { get: () => width });
    Object.defineProperty(viewport, "clientHeight", { get: () => 800 });
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 3");
    width = 340; element.showPage(3);
    await statusIncludes(element, "Page 3 of 3");
    const calls = pageAt(harness.pages, 2).getViewport.mock.calls;
    expect(calls.at(-1)?.[0].scale).toBe(.5);
    expect(element.currentPage).toBe(3);
  });

  it("announces a rendered source so a pending evidence backlink can select its page", async () => {
    const harness = fakePdfJs(3);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    const ready = vi.fn((event: Event) => {
      expect(event).toBeInstanceOf(CustomEvent);
      if (event instanceof CustomEvent) expect(event.detail).toEqual({ sourceUrl: "paper.pdf", pageCount: 3 });
      element.showPage(3);
    });
    element.addEventListener(researchPdfReadyEventName, ready);
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 3 of 3");
    expect(ready).toHaveBeenCalledTimes(1);
    element.showPage(2); await statusIncludes(element, "Page 2 of 3");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("lets a zoom supersede the first render without destroying the document or losing its ready event", async () => {
    const harness = fakePdfJs(1);
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((_, fail) => { reject = fail; });
    pageAt(harness.pages, 0).render.mockImplementationOnce(() => ({ promise, cancel: vi.fn(() => { const error = new Error("Superseded"); error.name = "RenderingCancelledException"; reject(error); }) }));
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    const ready = vi.fn(); element.addEventListener(researchPdfReadyEventName, ready);
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await waitFor(() => pageAt(harness.pages, 0).render.mock.calls.length === 1);
    shadowButton(element, "[data-zoom-in]").click();
    await statusIncludes(element, "Page 1 of 1 · 125%"); await settle();
    expect(harness.loadingTask.destroy).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
    expect(pageAt(harness.pages, 0).cleanup).not.toHaveBeenCalled();
  });

  it("jumps by page number, rejects invalid input, and reloads without losing page or zoom", async () => {
    const harness = fakePdfJs(3);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 3");
    const input = shadow(element, "[data-page-number]", HTMLInputElement);
    input.value = "3"; input.dispatchEvent(new Event("change"));
    await statusIncludes(element, "Page 3 of 3");
    input.value = "1.5"; input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("3");
    element.showPage(NaN); await settle(); expect(element.currentPage).toBe(3);
    shadowButton(element, "[data-zoom-in]").click(); await statusIncludes(element, "125%");
    shadowButton(element, "[data-reload]").click();
    await waitFor(() => harness.getDocument.mock.calls.length === 2);
    await statusIncludes(element, "Page 3 of 3 · 125%");
    expect(harness.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("does not load while detached and reloads a retained source after reconnect", async () => {
    const harness = fakePdfJs(1);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    element.sourceUrl = "paper.pdf";
    await settle();
    expect(harness.loader).not.toHaveBeenCalled();
    expect(shadow(element, "[data-open-pdf]", HTMLAnchorElement).hidden).toBe(true);

    document.body.append(element);
    await statusIncludes(element, "Page 1 of 1");
    expect(harness.loader).toHaveBeenCalledTimes(1);
    element.remove();
    await waitFor(() => harness.loadingTask.destroy.mock.calls.length === 1);
    document.body.append(element);
    await statusIncludes(element, "Page 1 of 1");
    expect(harness.loader).toHaveBeenCalledTimes(2);
  });

  it("cancels and destroys work on source replacement and disconnect", async () => {
    const first = fakePdfJs(1);
    const second = fakePdfJs(1);
    const loaders = [first.loader, second.loader];
    const element = createViewer();
    element.pdfJsLoader = async () => await (loaders.shift() ?? second.loader)();
    document.body.append(element);
    element.sourceUrl = "first.pdf";
    await statusIncludes(element, "Page 1 of 1");

    element.sourceUrl = "second.pdf";
    await statusIncludes(element, "Page 1 of 1");
    expect(first.loadingTask.destroy).toHaveBeenCalled();
    expect(pageAt(first.pages, 0).cleanup).toHaveBeenCalled();

    element.remove();
    await settle();
    expect(second.loadingTask.destroy).toHaveBeenCalled();
  });

  it("cancels an in-flight render when the source is cleared", async () => {
    let finishRender: (() => void) | undefined;
    const renderPromise = new Promise<void>((resolve) => { finishRender = resolve; });
    const harness = fakePdfJs(1, renderPromise);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await waitFor(() => pageAt(harness.pages, 0).render.mock.calls.length === 1);

    element.sourceUrl = undefined;
    await waitFor(() => pageAt(harness.renderTasks, 0).cancel.mock.calls.length === 1);
    expect(pageAt(harness.pages, 0).cleanup).toHaveBeenCalled();
    finishRender?.();
  });

  it("destroys an in-flight loading task when the source is cleared", async () => {
    const loadingTask = { promise: new Promise<never>(() => undefined), destroy: vi.fn(() => Promise.resolve()) };
    const getDocument = vi.fn<PdfJsModule["getDocument"]>(() => loadingTask);
    const module: PdfJsModule = { GlobalWorkerOptions: { workerSrc: "" }, getDocument };
    const element = createViewer();
    element.pdfJsLoader = vi.fn(() => Promise.resolve(module));
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await waitFor(() => getDocument.mock.calls.length === 1);
    element.sourceUrl = undefined;
    await waitFor(() => loadingTask.destroy.mock.calls.length === 1);
  });

  it("surfaces page and render failures through the handled status path", async () => {
    const pageFailure = fakePdfJs(2);
    pageFailure.document.getPage.mockImplementation((number: number) => number === 2 ? Promise.reject(new Error("page failed")) : Promise.resolve(pageAt(pageFailure.pages, number - 1)));
    const element = createViewer();
    element.pdfJsLoader = pageFailure.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 2");
    shadowButton(element, "[data-next]").click();
    await statusIncludes(element, "page failed");

    pageFailure.document.getPage.mockImplementation((page: number) => Promise.resolve(pageAt(pageFailure.pages, page - 1)));
    pageAt(pageFailure.pages, 1).render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error("render failed")), cancel: vi.fn() }));
    shadowButton(element, "[data-zoom-in]").click();
    await statusIncludes(element, "render failed");
  });

  it("rejects absurd CSS viewport dimensions", async () => {
    const harness = fakePdfJs(1);
    pageAt(harness.pages, 0).getViewport.mockReturnValue({ width: MAX_PDF_RENDER_DIMENSION + 1, height: 10 });
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "safe render limit");
  });

  it("shows a safe error state and refuses a cross-origin fallback", async () => {
    const element = createViewer();
    element.pdfJsLoader = vi.fn(() => Promise.reject(new Error("should not load")));
    document.body.append(element);
    element.sourceUrl = "https://elsewhere.example/paper.pdf";
    await statusIncludes(element, "same-origin");

    const fallback = shadow(element, "[data-open-pdf]", HTMLAnchorElement);
    expect(fallback.hasAttribute("href")).toBe(false);
    expect(fallback.hidden).toBe(true);
    expect(fallback.getAttribute("aria-disabled")).toBe("true");
    expect(shadow(element, "[data-status]", HTMLElement).dataset["state"]).toBe("error");
  });

  it("surfaces loader failures without unsafe URL interpolation", async () => {
    const element = createViewer();
    element.pdfJsLoader = vi.fn(() => Promise.reject(new Error("broken <module>")));
    document.body.append(element);
    element.sourceUrl = "paper.pdf?x=%3Cscript%3E";
    await statusIncludes(element, "broken <module>");

    expect(shadowRoot(element).querySelector("script")).toBeNull();
    expect(shadow(element, "[data-status]", HTMLElement).textContent).toContain("broken <module>");
  });
});

describe("reading controls", () => {
  it("keeps secondary actions in a disclosure and supports fit, tone and marker visibility", async () => {
    const harness = fakePdfJs(2); const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf"; await statusIncludes(element, "Page 1 of 2");
    expect(shadow(element, "[data-more]", HTMLDetailsElement).open).toBe(false);
    expect(shadow(element, "[data-fit]", HTMLSelectElement).value).toBe("width");
    const fit = shadow(element, "[data-fit]", HTMLSelectElement);
    fit.value = "page"; fit.dispatchEvent(new Event("change")); await settle();
    expect(fit.value).toBe("page");
    fit.value = "1.5"; fit.dispatchEvent(new Event("change")); await statusIncludes(element, "150%");
    const tone = shadow(element, "[data-page-tone]", HTMLSelectElement);
    tone.value = "warm"; tone.dispatchEvent(new Event("change"));
    expect(shadow(element, "dialog", HTMLDialogElement).dataset["tone"]).toBe("warm");
    element.annotations = [{ id: "ann", page: 1, rect: { x: .1, y: .1, width: .2, height: .2 }, kind: "note", status: "open", label: "Note" }];
    shadow(element, "[data-markers]", HTMLInputElement).click();
    expect(shadowRoot(element).querySelector("[data-annotation-id]")).toBeNull();
    shadow(element, "[data-markers]", HTMLInputElement).click();
    expect(shadowRoot(element).querySelector("[data-annotation-id]")).not.toBeNull();
  });

  it("navigates from the page keyboard, leaves editable controls alone and focuses page/find inputs", async () => {
    const harness = fakePdfJs(3); const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf"; await statusIncludes(element, "Page 1 of 3");
    const viewport = shadow(element, ".viewport", HTMLElement);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await statusIncludes(element, "Page 2 of 3");
    const input = shadow(element, "[data-page-number]", HTMLInputElement);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await settle();
    expect(element.currentPage).toBe(2);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(shadowRoot(element).activeElement).toBe(input);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(shadowRoot(element).activeElement).toBe(shadow(element, "[data-find-input]", HTMLInputElement));
    expect(shadowButton(element, "[data-find-toggle]").getAttribute("aria-expanded")).toBe("true");
    shadow(element, "[data-find-input]", HTMLInputElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shadow(element, "[data-find-bar]", HTMLElement).hidden).toBe(true);
    expect(shadowRoot(element).activeElement).toBe(shadowButton(element, "[data-find-toggle]"));
  });

  it("searches without an index, highlights selectable spans and wraps results across pages", async () => {
    const harness = fakePdfJs(2); const element = createViewer(); element.pdfJsLoader = harness.loader;
    addTextLayer(harness.module);
    document.body.append(element); element.sourceUrl = "paper.pdf"; await statusIncludes(element, "Page 1 of 2"); await settle();
    shadowButton(element, "[data-find-toggle]").click();
    const input = shadow(element, "[data-find-input]", HTMLInputElement); input.value = "INSIDE the";
    shadow(element, "[data-find-bar]", HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor(() => shadow(element, "[data-find-status]", HTMLElement).textContent.includes("1 of 2 matches")); await settle();
    expect(shadow(element, "mark[data-current]", HTMLElement).textContent).toBe("Inside the");
    shadowButton(element, "[data-find-next]").click(); await statusIncludes(element, "Page 2 of 2"); await settle();
    expect(shadow(element, "[data-find-status]", HTMLElement).textContent).toContain("2 of 2 matches");
    shadowButton(element, "[data-find-next]").click(); await statusIncludes(element, "Page 1 of 2");
    shadowButton(element, "[data-find-previous]").click(); await statusIncludes(element, "Page 2 of 2");
    input.value = "missing"; input.dispatchEvent(new Event("input"));
    expect(shadowRoot(element).querySelector("mark")).toBeNull();
    expect(shadowButton(element, "[data-find-next]").disabled).toBe(true);
  });

  it("cancels an obsolete search and does not publish its delayed results", async () => {
    const harness = fakePdfJs(1); const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf"; await statusIncludes(element, "Page 1 of 1");
    let resolve!: (content: { items: [] }) => void;
    pageAt(harness.pages, 0).getTextContent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    shadowButton(element, "[data-find-toggle]").click();
    shadow(element, "[data-find-input]", HTMLInputElement).value = "Inside";
    shadow(element, "[data-find-bar]", HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await settle(); shadowButton(element, "[data-find-close]").click(); resolve({ items: [] }); await settle();
    expect(shadow(element, "[data-find-status]", HTMLElement).textContent).toBe("Search this PDF without creating an index.");
    expect(shadowButton(element, "[data-find-next]").disabled).toBe(true);
  });

  it("discloses capped matches and stops before scanning the next page", async () => {
    const harness = fakePdfJs(2); const element = createViewer(); element.pdfJsLoader = harness.loader;
    pageAt(harness.pages, 0).getTextContent.mockResolvedValue({ items: [{ str: "match ".repeat(1001), transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 }] });
    document.body.append(element); element.sourceUrl = "paper.pdf"; await statusIncludes(element, "Page 1 of 2");
    shadow(element, "[data-find-input]", HTMLInputElement).value = "match";
    shadow(element, "[data-find-bar]", HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor(() => shadow(element, "[data-find-status]", HTMLElement).textContent.includes("1000 matches"));
    expect(shadow(element, "[data-find-status]", HTMLElement).textContent).toContain("Limited to 1 / 2 pages");
    expect(pageAt(harness.pages, 1).getTextContent).not.toHaveBeenCalled();
  });

  it("does not publish an old text layer after source replacement", async () => {
    const first = fakePdfJs(1); const second = fakePdfJs(1);
    addTextLayer(first.module); addTextLayer(second.module);
    let resolve!: (content: { items: [] }) => void;
    pageAt(first.pages, 0).getTextContent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const element = createViewer(); element.pdfJsLoader = first.loader;
    document.body.append(element); element.sourceUrl = "first.pdf"; await statusIncludes(element, "Page 1 of 1");
    element.pdfJsLoader = second.loader; element.sourceUrl = "second.pdf";
    await waitFor(() => second.getDocument.mock.calls.length === 1);
    await statusIncludes(element, "Page 1 of 1"); await settle();
    resolve({ items: [] }); await settle();
    expect(shadow(element, "[data-text-layer]", HTMLElement).textContent).toContain("Inside the region");
    expect(shadow(element, "[data-text-status]", HTMLElement).textContent).toBe("");
  });

  it("reports text/search failures without losing the rendered page", async () => {
    const harness = fakePdfJs(1); const element = createViewer(); element.pdfJsLoader = harness.loader; addTextLayer(harness.module);
    pageAt(harness.pages, 0).getTextContent.mockRejectedValue(new Error("Synthetic text failure"));
    document.body.append(element); element.sourceUrl = "paper.pdf"; await statusIncludes(element, "Page 1 of 1"); await settle();
    expect(shadow(element, "[data-text-status]", HTMLElement).textContent).toContain("Text selection unavailable");
    shadow(element, "[data-find-input]", HTMLInputElement).value = "query";
    shadow(element, "[data-find-bar]", HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await settle(); expect(shadow(element, "[data-find-status]", HTMLElement).textContent).toContain("Results are incomplete");
    expect(shadow(element, "[data-status]", HTMLElement).dataset["state"]).toBe("ready");
  });
});

// Text-layer geometry is covered in Chromium; this fake proves selection/search DOM wiring.
function addTextLayer(module: PdfJsModule): void {
  module.TextLayer = class {
    textDivs: HTMLElement[] = [];
    textContentItemsStr: string[] = [];
    constructor(private readonly input: { textContentSource: { items: { str?: unknown }[] }; container: HTMLElement }) {}
    render(): Promise<void> {
      this.textContentItemsStr = this.input.textContentSource.items.flatMap(item => typeof item.str === "string" ? [item.str] : []);
      this.textDivs = this.textContentItemsStr.map(text => { const span = document.createElement("span"); span.textContent = text; this.input.container.append(span); return span; });
      return Promise.resolve();
    }
    cancel(): void { /* Synchronous fake has no pending rendering work. */ }
  };
}

describe("text comments", () => {
  it("refreshes tools opened before text finishes rendering and invalidates them on source replacement", async () => {
    const harness = fakePdfJs(1); addTextLayer(harness.module);
    const content = await pageAt(harness.pages, 0).getTextContent();
    let resolve!: (value: typeof content) => void;
    pageAt(harness.pages, 0).getTextContent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "first.pdf"; await statusIncludes(element, "Page 1 of 1");
    shadowButton(element, "[data-text-toggle]").click();
    expect(shadow(element, "[data-selection-status]", HTMLElement).textContent).toContain("No selectable text is ready");
    resolve(content); await settle();
    expect(shadow(element, "[data-text-start]", HTMLSelectElement).disabled).toBe(false);
    expect(shadow(element, "[data-text-preview]", HTMLElement).textContent).toBe("Inside the region");
    expect(shadow(element, "[data-overlay]", HTMLElement).dataset["textSelecting"]).toBe("true");
    element.sourceUrl = "second.pdf"; await settle();
    expect(shadow(element, "[data-text-tools]", HTMLElement).hidden).toBe(true);
    expect(shadow(element, "[data-overlay]", HTMLElement).dataset["textSelecting"]).toBe("false");
  });

  it("connects the passage picker to the same page/quote selection boundary and clears it on navigation", async () => {
    const harness = fakePdfJs(2); addTextLayer(harness.module);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    const selections: ResearchPdfSelectionDetail[] = [];
    element.addEventListener(researchPdfSelectionEventName, event => { selections.push(selectionDetail(event)); });
    document.body.append(element); element.sourceUrl = "paper.pdf"; await settle();
    shadowButton(element, "[data-text-toggle]").click();
    expect(shadow(element, "[data-text-preview]", HTMLElement).textContent).toBe("Inside the region");
    const end = shadow(element, "[data-text-end]", HTMLSelectElement);
    end.value = "1"; end.dispatchEvent(new Event("change"));
    expect(shadow(element, "[data-text-preview]", HTMLElement).textContent).toBe("Inside the region\nOutside the region");
    // DOM tests supply geometry at the browser boundary; actual PDF geometry is
    // separately exercised by the real-browser workbench smoke.
    vi.spyOn(shadow(element, "canvas", HTMLCanvasElement), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 800));
    for (const span of element.shadowRoot?.querySelectorAll<HTMLElement>("[data-text-layer] span") ?? []) vi.spyOn(span, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 80, 400, 80));
    shadowButton(element, "[data-passage-comment]").click();
    expect(selections).toEqual([{ page: 1, quote: "Inside the region\nOutside the region", rect: { x: .1, y: .1, width: .4, height: .1 } }]);
    expect(shadow(element, "[data-text-tools]", HTMLElement).hidden).toBe(true);
    shadowButton(element, "[data-text-toggle]").click();
    element.showPage(2); await settle();
    expect(shadow(element, "[data-text-tools]", HTMLElement).hidden).toBe(true);
    shadowButton(element, "[data-passage-comment]").click();
    expect(selections).toHaveLength(1);
  });

  it("reports missing selection and invalid picker order without emitting evidence", async () => {
    const harness = fakePdfJs(1); addTextLayer(harness.module);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    const selected = vi.fn(); element.addEventListener(researchPdfSelectionEventName, selected);
    document.body.append(element); element.sourceUrl = "paper.pdf"; await settle();
    shadowButton(element, "[data-text-toggle]").click();
    shadowButton(element, "[data-text-comment]").click();
    expect(shadow(element, "[data-selection-status]", HTMLElement).textContent).toContain("Select text on this PDF page");
    const start = shadow(element, "[data-text-start]", HTMLSelectElement), end = shadow(element, "[data-text-end]", HTMLSelectElement);
    start.value = "1"; start.dispatchEvent(new Event("change")); expect(end.value).toBe("1");
    end.value = "0"; end.dispatchEvent(new Event("change"));
    shadowButton(element, "[data-passage-comment]").click();
    expect(shadow(element, "[data-selection-status]", HTMLElement).textContent).toContain("at or after");
    expect(selected).not.toHaveBeenCalled();
    shadowButton(element, "[data-mark]").click();
    expect(shadow(element, "[data-text-tools]", HTMLElement).hidden).toBe(true);
  });
});

describe("region marking", () => {
  it("offers primary keyboard marking with move, resize, commit and cancel", async () => {
    const harness = fakePdfJs(2);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 2");
    const selections: ResearchPdfSelectionDetail[] = [];
    element.addEventListener(researchPdfSelectionEventName, event => { selections.push(selectionDetail(event)); });
    const mark = shadowButton(element, "[data-mark]");
    expect(mark.closest("[data-more]")).toBeNull();
    mark.click();
    const viewport = shadow(element, ".viewport", HTMLElement);
    expect(shadowRoot(element).activeElement).toBe(viewport);
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    expect(element.currentPage).toBe(1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => selections.length === 1);
    expect(selections[0]?.rect.x).toBeCloseTo(.11);
    expect(selections[0]?.rect.height).toBeCloseTo(.11);
    expect(selections[0]?.rect.width).toBe(.4);
    expect(mark.getAttribute("aria-pressed")).toBe("false");
    mark.click();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mark.getAttribute("aria-pressed")).toBe("false");
    expect(selections).toHaveLength(1);
  });
  it("reports a dragged region with the page text it covers", async () => {
    const harness = fakePdfJs(1);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 1");
    const selections: ResearchPdfSelectionDetail[] = [];
    element.addEventListener(researchPdfSelectionEventName, (event) => { selections.push(selectionDetail(event)); });

    shadowButton(element, "[data-mark]").click();
    expect(shadowButton(element, "[data-mark]").getAttribute("aria-pressed")).toBe("true");
    dragRegion(element, { fromX: 60, fromY: 80, toX: 300, toY: 160 });
    await waitFor(() => selections.length === 1);

    expect(selections[0]).toEqual({ page: 1, rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 }, quote: "Inside the region" });
    expect(shadowButton(element, "[data-mark]").getAttribute("aria-pressed")).toBe("false");
  });

  it("discards delayed quote extraction after page navigation and supports Escape to cancel marking", async () => {
    const harness = fakePdfJs(2);
    let finish!: (value: { items: [] }) => void;
    pageAt(harness.pages, 0).getTextContent.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 2");
    const selected = vi.fn(); element.addEventListener(researchPdfSelectionEventName, selected);
    shadowButton(element, "[data-mark]").click();
    dragRegion(element, { fromX: 60, fromY: 80, toX: 300, toY: 160 });
    shadowButton(element, "[data-next]").click(); await statusIncludes(element, "Page 2 of 2");
    finish({ items: [] }); await settle();
    expect(selected).not.toHaveBeenCalled();
    shadowButton(element, "[data-mark]").click();
    shadowButton(element, "[data-mark]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shadowButton(element, "[data-mark]").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps a too-small drag out of the annotation flow", async () => {
    const harness = fakePdfJs(1);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 1");
    const selections: Event[] = [];
    element.addEventListener(researchPdfSelectionEventName, (event) => { selections.push(event); });

    shadowButton(element, "[data-mark]").click();
    dragRegion(element, { fromX: 60, fromY: 80, toX: 61, toY: 81 });
    await settle();

    expect(selections).toEqual([]);
    await statusIncludes(element, "too small to mark");
  });

  it("ignores drags while marking is disarmed", async () => {
    const harness = fakePdfJs(1);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 1");
    const selections: Event[] = [];
    element.addEventListener(researchPdfSelectionEventName, (event) => { selections.push(event); });

    dragRegion(element, { fromX: 60, fromY: 80, toX: 300, toY: 160 });
    await settle();

    expect(selections).toEqual([]);
  });

  it("paints stored annotations on their own resident pages and reports taps on them", async () => {
    const harness = fakePdfJs(2);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 2");

    element.annotations = [
      { id: "ann-1", page: 1, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 }, kind: "question", status: "open", label: "Why?" },
      { id: "ann-2", page: 2, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 }, kind: "highlight", status: "resolved", label: "Later" },
    ];
    element.activeAnnotationId = "ann-1";

    const markers = shadowRoot(element).querySelectorAll("[data-annotation-id]");
    expect([...markers].map((marker) => marker.getAttribute("data-annotation-id"))).toEqual(["ann-1", "ann-2"]);
    const marker = markers[0];
    if (!(marker instanceof HTMLElement)) throw new Error("Expected a rendered marker");
    expect(marker.dataset["active"]).toBe("true");
    expect(marker.style.left).toBe("10%");
    expect(marker.getAttribute("aria-label")).toContain("Question on page 1: Why?");

    const activated: string[] = [];
    element.addEventListener(researchPdfAnnotationEventName, (event) => { activated.push(activatedAnnotationId(event)); });
    marker.click();
    expect(activated).toEqual(["ann-1"]);

    shadowButton(element, "[data-next]").click();
    await statusIncludes(element, "Page 2 of 2");
    expect([...shadowRoot(element).querySelectorAll("[data-active-page=true] [data-annotation-id]")].map((entry) => entry.getAttribute("data-annotation-id"))).toEqual(["ann-2"]);
    expect(shadowRoot(element).querySelector("[data-page=\"2\"] [data-annotation-id]")?.getAttribute("aria-label")).toBe("Highlight on page 2: Later");
  });

  it("jumps to a page on request and clamps out-of-range requests", async () => {
    const harness = fakePdfJs(3);
    const element = createViewer();
    element.pdfJsLoader = harness.loader;
    document.body.append(element);
    element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 3");

    element.showPage(3);
    await statusIncludes(element, "Page 3 of 3");
    element.showPage(99);
    await settle();
    expect(element.currentPage).toBe(3);
    expect(element.pageCount).toBe(3);
  });
});

describe("continuous page surfaces", () => {
  it("does not overwrite a page number being typed when delayed text finishes", async () => {
    const harness = fakePdfJs(3); addTextLayer(harness.module);
    const content = await pageAt(harness.pages, 0).getTextContent();
    let finish!: (value: typeof content) => void;
    pageAt(harness.pages, 0).getTextContent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf";
    await statusIncludes(element, "Page 1 of 3");
    const input = shadow(element, "[data-page-number]", HTMLInputElement);
    input.focus(); input.value = "3"; input.dispatchEvent(new Event("input"));
    finish(content); await settle();
    expect(input.value).toBe("3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await statusIncludes(element, "Page 3 of 3");
    expect(element.currentPage).toBe(3);
  });

  it("retains adjacent text/canvases across navigation and evicts distant page resources", async () => {
    const harness = fakePdfJs(8); addTextLayer(harness.module);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf"; await settle();
    const firstCanvas = shadow(element, '[data-page="1"] canvas', HTMLCanvasElement);
    const secondCanvas = shadow(element, '[data-page="2"] canvas', HTMLCanvasElement);
    element.showPage(2); await settle();
    expect(shadow(element, '[data-page="2"] canvas', HTMLCanvasElement)).toBe(secondCanvas);
    expect(element.shadowRoot?.querySelectorAll("canvas")).toHaveLength(3);
    expect(pageAt(harness.pages, 1).render).toHaveBeenCalledOnce();
    element.showPage(6); await settle();
    expect([...shadowRoot(element).querySelectorAll<HTMLElement>("[data-page]")].map(page => page.dataset["page"]).sort()).toEqual(["5", "6", "7"]);
    expect(firstCanvas.width).toBe(0);
    expect(secondCanvas.width).toBe(0);
    expect(pageAt(harness.pages, 0).cleanup).toHaveBeenCalled();
    expect(pageAt(harness.pages, 1).cleanup).toHaveBeenCalled();
    element.showPage(1); await settle();
    expect(shadow(element, '[data-page="1"] [data-text-layer]', HTMLElement).textContent).toContain("Inside the region");
    expect(pageAt(harness.pages, 0).render).toHaveBeenCalledTimes(2);
    element.remove(); await settle();
    expect(harness.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("activates a touched neighboring text page without replacing its selection layer", async () => {
    const harness = fakePdfJs(3); addTextLayer(harness.module);
    const element = createViewer(); element.pdfJsLoader = harness.loader;
    document.body.append(element); element.sourceUrl = "paper.pdf"; await settle();
    shadowButton(element, "[data-text-toggle]").click();
    const text = shadow(element, '[data-page="2"] [data-text-layer]', HTMLElement);
    text.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    await settle();
    expect(element.currentPage).toBe(2);
    expect(shadow(element, '[data-active-page=true] [data-text-layer]', HTMLElement)).toBe(text);
    expect(shadow(element, "[data-text-tools]", HTMLElement).hidden).toBe(false);
    const selected = vi.fn(); element.addEventListener(researchPdfSelectionEventName, selected);
    vi.spyOn(shadow(element, '[data-page="2"] canvas', HTMLCanvasElement), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 800));
    for (const span of text.querySelectorAll<HTMLElement>("span")) vi.spyOn(span, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 80, 400, 80));
    shadowButton(element, "[data-passage-comment]").click();
    expect(selected).toHaveBeenCalledOnce();
    const event: unknown = selected.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(CustomEvent);
    if (event instanceof CustomEvent) expect(event.detail).toMatchObject({ page: 2, quote: "Inside the region", rect: { x: .1, y: .1, width: .4, height: .1 } });
  });
});

describe("PDF.js module validation", () => {
  it("accepts PDF.js 6's function-shaped GlobalWorkerOptions export", () => {
    const GlobalWorkerOptions = Object.assign(() => undefined, { workerSrc: "" });
    expect(isPdfJsModule({ GlobalWorkerOptions, getDocument: () => ({}) })).toBe(true);
  });
});

describe("boundedOutputScale", () => {
  it("caps render pixels and DPR", () => {
    const scale = boundedOutputScale(10_000, 10_000, 2);
    expect(scale).toBeCloseTo(Math.sqrt(MAX_PDF_RENDER_PIXELS / 100_000_000));
    expect(10_000 * 10_000 * scale * scale).toBeLessThanOrEqual(MAX_PDF_RENDER_PIXELS + 1);
    expect(boundedOutputScale(100, 100, 2)).toBe(2);
  });
});

function fakePdfJs(numPages: number, renderPromise: Promise<unknown> = Promise.resolve()) {
  const renderTasks: { promise: Promise<unknown>; cancel: ReturnType<typeof vi.fn> }[] = [];
  const pages = Array.from({ length: numPages }, () => ({
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    getTextContent: vi.fn(() => Promise.resolve({
      items: [
        { str: "Inside the region", transform: [10, 0, 0, 10, 100, 700], width: 100, height: 10 },
        { str: "Outside the region", transform: [10, 0, 0, 10, 100, 200], width: 100, height: 10 },
      ],
    })),
    render: vi.fn(() => {
      const task = { promise: renderPromise, cancel: vi.fn() };
      renderTasks.push(task);
      return task;
    }),
    cleanup: vi.fn(),
  }));
  const document = {
    numPages,
    getPage: vi.fn((page: number) => {
      const value = pages[page - 1];
      if (value === undefined) return Promise.reject(new Error("Page out of range"));
      return Promise.resolve(value);
    }),
  };
  const loadingTask = { promise: Promise.resolve(document), destroy: vi.fn(() => Promise.resolve()), onProgress: vi.fn<(progress: { loaded: number; total: number }) => void>() };
  const workerOptions = { workerSrc: "" };
  const getDocument = vi.fn<PdfJsModule["getDocument"]>(() => loadingTask);
  const module: PdfJsModule = { GlobalWorkerOptions: workerOptions, getDocument };
  return { pages, renderTasks, document, loadingTask, workerOptions, getDocument, module, loader: vi.fn(() => Promise.resolve(module)) };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await settle();
  }
  throw new Error("Condition did not become true");
}

async function statusIncludes(element: ResearchLibraryPdfViewerElement, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (shadow(element, "[data-status]", HTMLElement).textContent.includes(text)) return;
    await settle();
  }
  throw new Error(`Status did not include ${text}: ${shadow(element, "[data-status]", HTMLElement).textContent}`);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createViewer(): ResearchLibraryPdfViewerElement {
  const value = document.createElement(researchLibraryPdfViewerTagName);
  if (!(value instanceof ResearchLibraryPdfViewerElement)) throw new Error("PDF viewer element was not registered");
  value.canvasContextFactory = () => ({});
  return value;
}

function pageAt<T>(pages: T[], index: number): T {
  const page = pages[index];
  if (page === undefined) throw new Error("Missing fake page");
  return page;
}

function shadowRoot(element: ResearchLibraryPdfViewerElement): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error("PDF viewer shadow root is missing");
  return root;
}

function shadowButton(element: ResearchLibraryPdfViewerElement, selector: string): HTMLButtonElement {
  return shadow(element, selector, HTMLButtonElement);
}

function shadow<T extends Element>(element: ResearchLibraryPdfViewerElement, selector: string, type: abstract new (...args: never[]) => T): T {
  const value = shadowRoot(element).querySelector(selector);
  if (!(value instanceof type)) throw new Error(`Missing ${selector}`);
  return value;
}

/** Drive one pointer drag across the overlay, whose layout happy-dom cannot provide. */
function dragRegion(element: ResearchLibraryPdfViewerElement, drag: { fromX: number; fromY: number; toX: number; toY: number }): void {
  const overlay = shadow(element, "[data-overlay]", HTMLElement);
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800, toJSON: () => ({}),
  });
  overlay.setPointerCapture = vi.fn();
  overlay.releasePointerCapture = vi.fn();
  overlay.hasPointerCapture = vi.fn(() => true);
  overlay.dispatchEvent(pointerEvent("pointerdown", drag.fromX, drag.fromY));
  overlay.dispatchEvent(pointerEvent("pointermove", drag.toX, drag.toY));
  overlay.dispatchEvent(pointerEvent("pointerup", drag.toX, drag.toY));
}

function pointerEvent(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  return event;
}

function selectionDetail(event: Event): ResearchPdfSelectionDetail {
  const detail = eventDetail(event);
  const rect = detail["rect"];
  if (typeof detail["page"] !== "number" || typeof detail["quote"] !== "string" || !isRecord(rect)) throw new Error("Unexpected selection detail");
  const bounds = ["x", "y", "width", "height"].map((key) => {
    const value = rect[key];
    if (typeof value !== "number") throw new Error(`Unexpected selection rect ${key}`);
    return value;
  });
  return { page: detail["page"], quote: detail["quote"], rect: { x: bounds[0] ?? 0, y: bounds[1] ?? 0, width: bounds[2] ?? 0, height: bounds[3] ?? 0 } };
}

function activatedAnnotationId(event: Event): string {
  const id = eventDetail(event)["id"];
  if (typeof id !== "string") throw new Error("Unexpected annotation detail");
  return id;
}

function eventDetail(event: Event): Record<string, unknown> {
  if (!(event instanceof CustomEvent)) throw new Error("Expected a CustomEvent");
  const detail: unknown = event.detail;
  if (!isRecord(detail)) throw new Error("Expected an event detail object");
  return detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
