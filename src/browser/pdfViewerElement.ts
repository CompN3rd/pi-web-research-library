import { normalizedRect, type PdfRect } from "../domain/pdf.js";
import { pdfViewerTemplate } from "./pdfViewerTemplate.js";
import { fittedPdfScale, findPdfText, matchInTextRun, pdfTextStrings, PDF_FIND_MAX_PAGES, PDF_FIND_MAX_HITS, PDF_FIND_MAX_PAGE_CHARACTERS, type PdfFitMode, type PdfFindHit } from "./pdfReading.js";
import { quoteFromTextItems, textItemsToQuoteItems, type PdfTextContentItem } from "./pdfQuote.js";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdfRange, type PdfPeerSource, type PdfRangeTransport, type RangeModule } from "./pdfRange.js";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const MAX_DEVICE_PIXEL_RATIO = 2;
export const MAX_PDF_RENDER_DIMENSION = 16_384;
export const MAX_PDF_RENDER_PIXELS = 16_000_000;

export const researchLibraryPdfViewerTagName = "pi-web-research-library-pdf-viewer";
export const researchPdfSelectionEventName = "research-pdf-region-selected";
export const researchPdfAnnotationEventName = "research-pdf-annotation-activated";
export const researchPdfReadyEventName = "research-pdf-ready";

/** Smallest drag the viewer accepts, as a fraction of the page box. */
const MIN_SELECTION_FRACTION = 0.01;

/** A region the reader marked on the current page, with any text it covers. */
export interface ResearchPdfSelectionDetail {
  page: number;
  rect: PdfRect;
  quote: string;
}

/** An existing annotation the viewer paints over the page. */
export interface ResearchPdfAnnotationMarker {
  id: string;
  page: number;
  rect: PdfRect;
  kind: "question" | "note";
  status: "open" | "resolved";
  label: string;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfRenderTask {
  promise: Promise<unknown>;
  cancel(): void;
}

interface PdfPage {
  getViewport(input: { scale: number }): PdfViewport;
  render(input: { canvasContext: unknown; viewport: PdfViewport; transform?: number[] }): PdfRenderTask;
  getTextContent?(): Promise<{ items: PdfTextContentItem[] }>;
  cleanup?(): void;
}

interface PdfDocument extends Pick<PDFDocumentProxy, "numPages"> {
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfTextLayer {
  render(): Promise<unknown>;
  cancel(): void;
  textDivs: HTMLElement[];
  textContentItemsStr: string[];
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
  onProgress?: (progress: { loaded: number; total: number }) => void;
}

export interface PdfJsModule extends RangeModule {
  GlobalWorkerOptions: { workerSrc: string };
  TextLayer?: new (input: { textContentSource: { items: PdfTextContentItem[] }; container: HTMLElement; viewport: PdfViewport }) => PdfTextLayer;
  getDocument(input: {
    url?: string;
    range?: PdfRangeTransport;
    length?: number;
    rangeChunkSize?: number;
    cMapUrl?: string;
    cMapPacked?: boolean;
    standardFontDataUrl?: string;
    wasmUrl?: string;
    iccUrl?: string;
    isEvalSupported: false;
    enableXfa: false;
    disableAutoFetch: boolean;
    disableStream: boolean;
    maxImageSize: typeof MAX_PDF_RENDER_PIXELS;
  }): PdfLoadingTask;
}

export type PdfJsModuleLoader = () => Promise<PdfJsModule>;

export function defineResearchLibraryPdfViewerElement(): void {
  if (!customElements.get(researchLibraryPdfViewerTagName)) customElements.define(researchLibraryPdfViewerTagName, ResearchLibraryPdfViewerElement);
}

export class ResearchLibraryPdfViewerElement extends HTMLElement {
  private readonly root = this.attachShadow({ mode: "open" });
  private readonly canvas: HTMLCanvasElement;
  private readonly statusElement: HTMLElement;
  private readonly fallback: HTMLAnchorElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly zoomOutButton: HTMLButtonElement;
  private readonly zoomInButton: HTMLButtonElement;
  private readonly markButton: HTMLButtonElement;
  private readonly pageInput: HTMLInputElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly marquee: HTMLElement;
  private readonly viewportElement: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly textContainer: HTMLElement;
  private readonly fitSelect: HTMLSelectElement;
  private readonly findInput: HTMLInputElement;
  private readonly findStatus: HTMLElement;
  private pdfjs: PdfJsModule | undefined;
  private textLayer: PdfTextLayer | undefined;
  private fitMode: PdfFitMode = "width";
  private focused = false;
  private showMarkers = true;
  private resizeObserver: ResizeObserver | undefined;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private viewportSize = "";
  private findGeneration = 0;
  private findHits: PdfFindHit[] = [];
  private findIndex = -1;
  private findSummary = "";
  private findScrollPending = false;
  private markers: ResearchPdfAnnotationMarker[] = [];
  private activeMarkerId: string | undefined;
  private marking = false;
  private dragPointerId: number | undefined;
  private dragOrigin: { x: number; y: number } | undefined;
  private source: string | undefined;
  private peerSource: PdfPeerSource | undefined;
  private sourceAbort: AbortController | undefined;

  set pdfPeerSource(value: PdfPeerSource) { this.peerSource = value; }
  private generation = 0;
  private renderGeneration = 0;
  private readyGeneration = -1;
  private pageNumber = 1;
  private zoom = 1;
  private renderedZoom = 1;
  private document: PdfDocument | undefined;
  private loadingTask: PdfLoadingTask | undefined;
  private renderTask: PdfRenderTask | undefined;
  private renderedPage: PdfPage | undefined;
  private moduleLoader: PdfJsModuleLoader = loadBundledPdfJs;
  private contextFactory: (canvas: HTMLCanvasElement) => unknown = (canvas) => canvas.getContext("2d", { alpha: false });

  constructor() {
    super();
    this.root.innerHTML = pdfViewerTemplate();
    this.canvas = required(this.root.querySelector("canvas"), HTMLCanvasElement);
    this.statusElement = required(this.root.querySelector("[data-status]"), HTMLElement);
    this.fallback = required(this.root.querySelector("[data-open-pdf]"), HTMLAnchorElement);
    this.previousButton = required(this.root.querySelector("[data-previous]"), HTMLButtonElement);
    this.nextButton = required(this.root.querySelector("[data-next]"), HTMLButtonElement);
    this.zoomOutButton = required(this.root.querySelector("[data-zoom-out]"), HTMLButtonElement);
    this.zoomInButton = required(this.root.querySelector("[data-zoom-in]"), HTMLButtonElement);
    this.markButton = required(this.root.querySelector("[data-mark]"), HTMLButtonElement);
    this.pageInput = required(this.root.querySelector("[data-page-number]"), HTMLInputElement);
    this.reloadButton = required(this.root.querySelector("[data-reload]"), HTMLButtonElement);
    this.overlay = required(this.root.querySelector("[data-overlay]"), HTMLElement);
    this.marquee = required(this.root.querySelector("[data-marquee]"), HTMLElement);
    this.viewportElement = required(this.root.querySelector(".viewport"), HTMLElement);
    this.dialog = required(this.root.querySelector("dialog"), HTMLDialogElement);
    this.textContainer = required(this.root.querySelector("[data-text-layer]"), HTMLElement);
    this.fitSelect = required(this.root.querySelector("[data-fit]"), HTMLSelectElement);
    this.findInput = required(this.root.querySelector("[data-find-input]"), HTMLInputElement);
    this.findStatus = required(this.root.querySelector("[data-find-status]"), HTMLElement);
    this.fitSelect.addEventListener("change", () => {
      const mode = this.fitSelect.value;
      if (mode === "width" || mode === "page") {
        this.fitMode = mode;
        this.runInteraction(() => this.renderCurrentPage(this.generation));
      } else if (mode !== "custom") this.runInteraction(() => this.setZoom(Number(mode)));
    });
    this.control("[data-focus]").addEventListener("click", () => { this.setReadingFocus(!this.focused); });
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.setReadingFocus(false); });
    this.control("[data-page-tone]").addEventListener("change", event => {
      if (event.target instanceof HTMLSelectElement) this.dialog.dataset["tone"] = event.target.value;
    });
    this.control("[data-markers]").addEventListener("change", event => {
      if (event.target instanceof HTMLInputElement) { this.showMarkers = event.target.checked; this.renderMarkers(); }
    });
    this.control("[data-mark-cancel]").addEventListener("click", () => { this.setMarking(false); this.viewportElement.focus(); });
    this.control("[data-find-toggle]").addEventListener("click", () => { this.toggleFind(this.control("[data-find-bar]").hidden === true); });
    this.control("[data-find-close]").addEventListener("click", () => { this.toggleFind(false); });
    this.control("[data-find-bar]").addEventListener("submit", event => { event.preventDefault(); void this.findInDocument(); });
    this.findInput.addEventListener("input", () => { this.resetFind(); });
    this.findInput.addEventListener("keydown", event => {
      if (event.key === "Enter" && this.findHits.length > 0) { event.preventDefault(); this.stepMatch(event.shiftKey ? -1 : 1); }
    });
    this.control("[data-find-previous]").addEventListener("click", () => { this.stepMatch(-1); });
    this.control("[data-find-next]").addEventListener("click", () => { this.stepMatch(1); });
    this.previousButton.addEventListener("click", () => { this.runInteraction(() => this.goToPage(this.pageNumber - 1)); });
    this.nextButton.addEventListener("click", () => { this.runInteraction(() => this.goToPage(this.pageNumber + 1)); });
    this.zoomOutButton.addEventListener("click", () => { this.runInteraction(() => this.setZoom(this.zoom - ZOOM_STEP)); });
    this.zoomInButton.addEventListener("click", () => { this.runInteraction(() => this.setZoom(this.zoom + ZOOM_STEP)); });
    this.markButton.addEventListener("click", () => { this.setMarking(!this.marking); this.closeOptions(); this.viewportElement.focus(); });
    this.pageInput.addEventListener("change", () => {
      const value = this.pageInput.valueAsNumber;
      if (!Number.isSafeInteger(value)) { this.updateControls(); return; }
      this.showPage(value);
    });
    this.root.addEventListener("keydown", event => { if (event instanceof KeyboardEvent) this.onKeyDown(event); });
    this.reloadButton.addEventListener("click", () => { this.closeOptions(); void this.loadSource(this.source, true); });
    this.overlay.addEventListener("pointerdown", (event) => { this.startSelection(event); });
    this.overlay.addEventListener("pointermove", (event) => { this.updateSelection(event); });
    this.overlay.addEventListener("pointerup", (event) => { this.runInteraction(() => this.finishSelection(event)); });
    this.overlay.addEventListener("pointercancel", () => { this.cancelSelection(); });
    this.overlay.addEventListener("click", (event) => { this.activateMarker(event); });
    this.hideFallback();
    this.updateControls();
  }

  /** Existing annotations to paint over their pages. */
  set annotations(markers: readonly ResearchPdfAnnotationMarker[]) {
    this.markers = [...markers];
    this.renderMarkers();
  }

  /** Emphasize one annotation without changing the stored list. */
  set activeAnnotationId(id: string | undefined) {
    this.activeMarkerId = id;
    this.renderMarkers();
  }

  get currentPage(): number {
    return this.pageNumber;
  }

  get pageCount(): number {
    return this.document?.numPages ?? 0;
  }

  /** Bring one page into view; out-of-range pages are clamped, not rejected. */
  showPage(page: number): void {
    this.runInteraction(() => this.goToPage(page));
  }

  /** Arm or disarm region marking; disarming always releases a pointer capture. */
  setMarking(marking: boolean): void {
    const armed = marking && this.document !== undefined && this.statusElement.dataset["state"] === "ready";
    if (armed === this.marking) {
      if (!armed) this.cancelSelection();
      return;
    }
    this.marking = armed;
    if (!armed) this.cancelSelection();
    this.updateControls();
  }

  set pdfJsLoader(loader: PdfJsModuleLoader) {
    this.moduleLoader = loader;
  }

  set canvasContextFactory(factory: (canvas: HTMLCanvasElement) => unknown) {
    this.contextFactory = factory;
  }

  set sourceUrl(value: string | undefined) {
    if (value === this.source) return;
    this.source = value;
    if (this.isConnected) void this.loadSource(value);
    else { this.pageNumber = 1; this.zoom = 1; this.fitMode = "width"; }
  }

  get sourceUrl(): string | undefined {
    return this.source;
  }

  connectedCallback(): void {
    this.resizeObserver = new ResizeObserver(() => {
      const size = this.currentViewportSize();
      if (this.fitMode === "custom" || this.viewportElement.clientWidth === 0 || size === this.viewportSize) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        const currentSize = this.currentViewportSize();
        if (this.fitMode !== "custom" && this.viewportElement.clientWidth > 0 && currentSize !== this.viewportSize) this.runInteraction(() => this.renderCurrentPage(this.generation));
      }, 120);
    });
    this.resizeObserver.observe(this.viewportElement);
    window.addEventListener("pointerdown", this.dismissOptions);
    if (this.source !== undefined && this.source !== "" && this.document === undefined && this.loadingTask === undefined) {
      void this.loadSource(this.source, true);
    }
  }

  disconnectedCallback(): void {
    this.setReadingFocus(false);
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeTimer);
    window.removeEventListener("pointerdown", this.dismissOptions);
    this.hideFallback();
    void this.dispose(++this.generation);
  }

  private control(selector: string): HTMLElement { return required(this.root.querySelector(selector), HTMLElement); }
  private currentViewportSize(): string {
    return this.fitMode === "width" ? String(this.viewportElement.clientWidth) : `${String(this.viewportElement.clientWidth)}:${String(this.viewportElement.clientHeight)}`;
  }
  private closeOptions(): void { required(this.root.querySelector("[data-more]"), HTMLDetailsElement).open = false; }
  private readonly dismissOptions = (event: Event): void => {
    if (!event.composedPath().includes(this.control("[data-more]"))) this.closeOptions();
  };

  /** Native modal top layer hides host chrome and traps focus without changing the PDF source. */
  setReadingFocus(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.closeOptions();
    this.dialog.close();
    this.dialog.setAttribute("role", focused ? "dialog" : "region");
    this.control("[data-focus]").setAttribute("aria-pressed", String(focused));
    this.control("[data-focus]").setAttribute("aria-label", focused ? "Exit reading focus" : "Reading focus");
    if (focused) { this.dialog.showModal(); this.viewportElement.focus(); }
    else { this.dialog.show(); if (this.isConnected) this.control("[data-focus]").focus(); }
  }

  private async loadSource(value: string | undefined, keepPosition = false): Promise<void> {
    const generation = ++this.generation;
    this.setStatus(value === undefined || value === "" ? "No PDF selected." : "Loading PDF…", value === undefined || value === "" ? "idle" : "loading");
    this.hideFallback();
    await this.dispose(generation);
    if (generation !== this.generation || !this.isConnected) return;
    if (!keepPosition) { this.pageNumber = 1; this.zoom = 1; this.fitMode = "width"; }
    this.findInput.value = "";
    this.resetFind();
    this.control("[data-text-status]").textContent = "";
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.style.width = "";
    this.canvas.style.height = "";
    this.canvas.setAttribute("aria-label", "PDF visual preview. No page rendered; use Open PDF when available for the complete document.");
    this.overlay.style.width = "";
    this.overlay.style.height = "";
    this.setMarking(false);
    this.renderMarkers();
    this.updateControls();
    if (value === undefined || value === "") {
      this.setStatus("No PDF selected.", "idle");
      return;
    }

    let url: URL;
    try {
      url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) throw new Error("PDF preview URL must be same-origin");
    } catch (error) {
      this.setStatus(formatError(error), "error");
      return;
    }
    this.showFallback(url.href);
    this.setStatus("Loading PDF…", "loading");

    try {
      const pdfjs = await this.moduleLoader();
      if (generation !== this.generation) return;
      this.pdfjs = pdfjs;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      const sourceAbort = new AbortController();
      this.sourceAbort = sourceAbort;
      const peerSource = this.peerSource;
      const input = peerSource === undefined ? { url: url.href } : await openPdfRange(pdfjs, peerSource, sourceAbort.signal, (error) => {
        if (generation !== this.generation) return;
        const failedGeneration = ++this.generation;
        void this.dispose(failedGeneration).then(() => { this.handleOperationError(error, failedGeneration); });
      });
      if (generation !== this.generation) { sourceAbort.abort(); return; }
      const loadingTask = pdfjs.getDocument({
        ...input,
        cMapUrl: new URL("./pdfjs/cmaps/", import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("./pdfjs/standard_fonts/", import.meta.url).href,
        wasmUrl: new URL("./pdfjs/wasm/", import.meta.url).href,
        iccUrl: new URL("./pdfjs/iccs/", import.meta.url).href,
        isEvalSupported: false,
        enableXfa: false,
        disableAutoFetch: peerSource !== undefined,
        disableStream: peerSource !== undefined,
        maxImageSize: MAX_PDF_RENDER_PIXELS,
      });
      this.loadingTask = loadingTask;
      loadingTask.onProgress = ({ loaded, total }) => {
        if (generation !== this.generation || this.document !== undefined || total <= 0) return;
        this.setStatus(`Loading PDF… ${String(Math.min(100, Math.round((loaded / total) * 100)))}%`, "loading");
      };
      const document = await loadingTask.promise;
      if (generation !== this.generation) {
        await loadingTask.destroy();
        return;
      }
      // PDF.js 6 owns destruction on the loading task, even after its document resolves.
      this.document = document;
      this.pageNumber = Math.max(1, Math.min(document.numPages, this.pageNumber));
      await this.renderCurrentPage(generation, keepPosition);
    } catch (error) {
      if (generation === this.generation) await this.dispose(generation);
      this.handleOperationError(error, generation);
    } finally {
      if (generation === this.generation) this.updateControls();
    }
  }

  private async goToPage(next: number): Promise<void> {
    if (this.document === undefined || !Number.isSafeInteger(next)) return;
    const bounded = Math.max(1, Math.min(this.document.numPages, next));
    if (bounded === this.pageNumber) { this.updateControls(); return; }
    this.pageNumber = bounded;
    await this.renderCurrentPage(this.generation, false);
  }

  private async setZoom(next: number): Promise<void> {
    const bounded = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(next / ZOOM_STEP) * ZOOM_STEP));
    if (this.document === undefined || !Number.isFinite(next)) return;
    this.fitMode = "custom";
    this.zoom = bounded;
    await this.renderCurrentPage(this.generation);
  }

  private async renderCurrentPage(generation: number, preservePosition = true): Promise<void> {
    const document = this.document;
    if (document === undefined) return;
    const renderGeneration = ++this.renderGeneration;
    const position = { top: this.viewportElement.scrollTop / this.renderedZoom, left: this.viewportElement.scrollLeft / this.renderedZoom };
    this.setMarking(false);
    this.textLayer?.cancel(); this.textLayer = undefined; this.textContainer.replaceChildren();
    const previousTask = this.renderTask;
    previousTask?.cancel();
    // PDF.js must release the shared canvas before the next render uses it. The
    // previous operation owns reporting its error; this await only drains it.
    if (previousTask !== undefined) await previousTask.promise.catch(() => undefined);
    if (generation !== this.generation || renderGeneration !== this.renderGeneration) return;
    const previousPage = this.renderedPage;
    this.renderTask = undefined;
    this.setStatus(`Rendering page ${String(this.pageNumber)}…`, "loading");
    this.overlay.hidden = true;
    const page = await document.getPage(this.pageNumber).catch((error: unknown) => {
      if (generation !== this.generation || renderGeneration !== this.renderGeneration) return undefined;
      throw error;
    });
    if (page === undefined || generation !== this.generation || renderGeneration !== this.renderGeneration) return;
    if (previousPage !== page) previousPage?.cleanup?.();
    this.renderedPage = page;
    const base = page.getViewport({ scale: 1 });
    if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) throw new Error("PDF page dimensions are invalid");
    if (base.width > MAX_PDF_RENDER_DIMENSION || base.height > MAX_PDF_RENDER_DIMENSION) throw new Error("PDF page dimensions exceed the safe render limit");
    this.viewportSize = this.currentViewportSize();
    if (this.fitMode !== "custom") this.zoom = fittedPdfScale(this.fitMode, base, { width: this.viewportElement.clientWidth, height: this.viewportElement.clientHeight });
    const viewport = page.getViewport({ scale: this.zoom });
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error("PDF page dimensions are invalid");
    if (viewport.width > MAX_PDF_RENDER_DIMENSION || viewport.height > MAX_PDF_RENDER_DIMENSION) throw new Error("PDF page dimensions exceed the safe render limit");
    const desiredDpr = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
    const outputScale = boundedOutputScale(viewport.width, viewport.height, desiredDpr);
    this.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    this.canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    this.canvas.style.width = `${String(Math.floor(viewport.width))}px`;
    this.canvas.style.height = `${String(Math.floor(viewport.height))}px`;
    this.overlay.style.width = this.canvas.style.width;
    this.overlay.style.height = this.canvas.style.height;
    this.textContainer.style.setProperty("--total-scale-factor", String(this.zoom));
    this.textContainer.style.setProperty("--scale-round-x", "1px");
    this.textContainer.style.setProperty("--scale-round-y", "1px");
    this.viewportElement.scrollTop = preservePosition ? position.top * this.zoom : 0;
    this.viewportElement.scrollLeft = preservePosition ? position.left * this.zoom : 0;
    this.renderedZoom = this.zoom;
    const context = this.contextFactory(this.canvas);
    if (context === null || context === undefined) throw new Error("Canvas rendering is unavailable");
    const renderTask = page.render({
      canvasContext: context,
      viewport,
      ...(outputScale === 1 ? {} : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
    });
    this.renderTask = renderTask;
    try {
      await renderTask.promise;
    } catch (error) {
      // Superseded initial renders must not reach loadSource's document-disposal
      // path: a resize or zoom now owns the still-valid loading task.
      if (generation !== this.generation || renderGeneration !== this.renderGeneration) return;
      throw error;
    } finally {
      if (this.renderTask === renderTask) this.renderTask = undefined;
    }
    if (generation !== this.generation || renderGeneration !== this.renderGeneration) return;
    this.canvas.setAttribute("aria-label", `Visual preview of PDF page ${String(this.pageNumber)} of ${String(document.numPages)}. Use Open PDF for the complete accessible document.`);
    this.setStatus(`Page ${String(this.pageNumber)} of ${String(document.numPages)} · ${String(Math.round(this.zoom * 100))}%`, "ready");
    this.overlay.hidden = false;
    this.renderMarkers();
    this.updateControls();
    await this.renderText(page, viewport, generation, renderGeneration);
    if (generation === this.generation && renderGeneration === this.renderGeneration && this.readyGeneration !== generation) {
      this.readyGeneration = generation;
      this.dispatchEvent(new CustomEvent(researchPdfReadyEventName, { detail: { sourceUrl: this.source, pageCount: document.numPages }, bubbles: true, composed: true }));
    }
  }

  private async renderText(page: PdfPage, viewport: PdfViewport, generation: number, renderGeneration: number): Promise<void> {
    const TextLayer = this.pdfjs?.TextLayer;
    if (TextLayer === undefined || page.getTextContent === undefined) return;
    const current = (): boolean => generation === this.generation && renderGeneration === this.renderGeneration;
    try {
      const content = await page.getTextContent();
      if (!current()) return;
      const layer = new TextLayer({ textContentSource: content, container: this.textContainer, viewport });
      this.textLayer = layer;
      await layer.render();
      if (!current()) return;
      this.paintFindMatches();
      this.control("[data-text-status]").textContent = layer.textContentItemsStr.join("").trim() === "" ? "No selectable text on this page. Scanned pages require OCR outside this reader." : "";
    } catch (error) {
      if (!current() || isCancellationError(error)) return;
      this.control("[data-text-status]").textContent = `Text selection unavailable: ${formatError(error)}. The page remains readable; use Open PDF for another viewer.`;
    }
  }

  private async dispose(expectedGeneration: number): Promise<void> {
    this.sourceAbort?.abort();
    this.sourceAbort = undefined;
    this.findGeneration++;
    this.textLayer?.cancel(); this.textLayer = undefined; this.textContainer.replaceChildren();
    this.pdfjs = undefined;
    this.setMarking(false);
    this.renderGeneration += 1;
    this.renderTask?.cancel();
    this.renderTask = undefined;
    this.renderedPage?.cleanup?.();
    this.renderedPage = undefined;
    const loadingTask = this.loadingTask;
    this.loadingTask = undefined;
    this.document = undefined;
    const cleanup = loadingTask?.destroy();
    if (cleanup !== undefined) await Promise.allSettled([cleanup]);
    if (expectedGeneration === this.generation) this.updateControls();
  }

  private runInteraction(operation: () => Promise<void>): void {
    const generation = this.generation;
    void operation().catch((error: unknown) => { this.handleOperationError(error, generation); });
  }

  private handleOperationError(error: unknown, generation: number): void {
    if (generation !== this.generation || !this.isConnected || isCancellationError(error)) return;
    this.setStatus(`Unable to render PDF: ${formatError(error)}`, "error");
    this.updateControls();
  }

  private hideFallback(): void {
    this.fallback.removeAttribute("href");
    this.fallback.hidden = true;
    this.fallback.setAttribute("aria-disabled", "true");
    this.fallback.tabIndex = -1;
  }

  private showFallback(url: string): void {
    this.fallback.href = url;
    this.fallback.hidden = false;
    this.fallback.removeAttribute("aria-disabled");
    this.fallback.removeAttribute("tabindex");
  }

  private setStatus(message: string, state: "idle" | "loading" | "ready" | "error"): void {
    this.statusElement.textContent = message;
    this.statusElement.dataset["state"] = state;
    this.updateControls();
  }

  private updateControls(): void {
    const pages = this.document?.numPages ?? 0;
    this.previousButton.disabled = pages === 0 || this.pageNumber <= 1;
    this.nextButton.disabled = pages === 0 || this.pageNumber >= pages;
    this.zoomOutButton.disabled = pages === 0 || this.zoom <= MIN_ZOOM;
    this.zoomInButton.disabled = pages === 0 || this.zoom >= MAX_ZOOM;
    this.markButton.disabled = pages === 0 || this.statusElement.dataset["state"] !== "ready";
    this.pageInput.disabled = pages === 0;
    this.pageInput.max = String(Math.max(1, pages));
    this.pageInput.value = String(this.pageNumber);
    this.control("[data-page-count]").textContent = String(pages);
    this.fitSelect.disabled = pages === 0;
    this.fitSelect.value = this.fitMode === "custom" ? ([1, 1.5, 2, 3].includes(this.zoom) ? String(this.zoom) : "custom") : this.fitMode;
    const custom = this.fitSelect.querySelector("option[value=custom]");
    if (custom !== null) custom.textContent = `${String(Math.round(this.zoom * 100))}%`;
    this.control("[data-zoom-label]").textContent = `${String(Math.round(this.zoom * 100))}%`;
    const progress = required(this.root.querySelector("[data-progress]"), HTMLProgressElement);
    progress.max = Math.max(1, pages); progress.value = pages > 0 ? this.pageNumber : 0;
    required(this.root.querySelector("[data-find-submit]"), HTMLButtonElement).disabled = pages === 0;
    for (const selector of ["[data-find-next]", "[data-find-previous]"]) required(this.root.querySelector(selector), HTMLButtonElement).disabled = this.findHits.length === 0;
    this.control("[data-mark-hint]").hidden = !this.marking;
    this.reloadButton.disabled = this.source === undefined || this.statusElement.dataset["state"] === "loading";
    this.markButton.textContent = this.marking ? "Cancel marking" : "Mark region";
    this.markButton.setAttribute("aria-pressed", this.marking ? "true" : "false");
    this.overlay.dataset["marking"] = this.marking ? "on" : "off";
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "f") { event.preventDefault(); this.toggleFind(true); return; }
    if (key === "escape") {
      event.preventDefault();
      if (this.marking) this.setMarking(false);
      else if (required(this.root.querySelector("[data-more]"), HTMLDetailsElement).open) { this.closeOptions(); this.control("[data-more] summary").focus(); }
      else if (this.control("[data-find-bar]").hidden !== true) this.toggleFind(false);
      else this.setReadingFocus(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.closest("input, select, textarea, button, summary, a") !== null || target.isContentEditable)) return;
    let action: (() => void) | undefined;
    if (key === "arrowright") action = () => { this.showPage(this.pageNumber + 1); };
    if (key === "arrowleft") action = () => { this.showPage(this.pageNumber - 1); };
    if (key === "home") action = () => { this.showPage(1); };
    if (key === "end") action = () => { this.showPage(this.pageCount); };
    if (key === "g") action = () => { this.pageInput.focus(); this.pageInput.select(); };
    if (key === "f") action = () => { this.setReadingFocus(!this.focused); };
    if (key === "+" || key === "=") action = () => { this.runInteraction(() => this.setZoom(this.zoom + ZOOM_STEP)); };
    if (key === "-") action = () => { this.runInteraction(() => this.setZoom(this.zoom - ZOOM_STEP)); };
    if (key === "0") action = () => { this.fitMode = "width"; this.runInteraction(() => this.renderCurrentPage(this.generation)); };
    if (key === " " || key === "pagedown" || key === "pageup") action = () => {
      const backwards = key === "pageup" || (key === " " && event.shiftKey);
      const atEdge = backwards ? this.viewportElement.scrollTop <= 1 : this.viewportElement.scrollTop + this.viewportElement.clientHeight >= this.viewportElement.scrollHeight - 1;
      if (atEdge) this.runInteraction(async () => {
        const before = this.pageNumber;
        await this.goToPage(this.pageNumber + (backwards ? -1 : 1));
        if (backwards && before !== this.pageNumber) this.viewportElement.scrollTop = this.viewportElement.scrollHeight;
      });
      else this.viewportElement.scrollBy({ top: this.viewportElement.clientHeight * .85 * (backwards ? -1 : 1), behavior: "auto" });
    };
    if (action !== undefined) { event.preventDefault(); action(); }
  }

  private toggleFind(open: boolean): void {
    this.closeOptions();
    this.control("[data-find-bar]").hidden = !open;
    this.control("[data-find-toggle]").setAttribute("aria-expanded", String(open));
    if (open) { this.findInput.focus(); this.findInput.select(); }
    else { this.resetFind(); this.control("[data-find-toggle]").focus(); }
  }

  private resetFind(): void {
    this.findGeneration++;
    this.findHits = []; this.findIndex = -1; this.findSummary = ""; this.findScrollPending = false;
    this.findStatus.textContent = "Search this PDF without creating an index.";
    this.paintFindMatches(); this.updateControls();
  }

  private async findInDocument(): Promise<void> {
    this.resetFind();
    const query = this.findInput.value.trim();
    const document = this.document;
    if (document === undefined || query === "") return;
    if (query.length > 200) { this.findStatus.textContent = "Use at most 200 characters."; return; }
    const generation = this.findGeneration;
    const current = (): boolean => generation === this.findGeneration && document === this.document && this.isConnected;
    let scanned = 0;
    let unreadable = 0;
    const hits: PdfFindHit[] = [];
    try {
      for (let number = 1; number <= Math.min(document.numPages, PDF_FIND_MAX_PAGES); number++) {
        if (!current()) return;
        this.findStatus.textContent = `Searching page ${String(number)} of ${String(document.numPages)}…`;
        const page = await document.getPage(number);
        if (!current()) return;
        try {
          if (page.getTextContent === undefined) throw new Error("PDF text extraction is unavailable");
          const content = await page.getTextContent();
          if (!current()) return;
          const strings = pdfTextStrings(content.items);
          if (strings.reduce((length, text) => length + text.length + 1, 0) > PDF_FIND_MAX_PAGE_CHARACTERS) {
            throw new Error(`Page ${String(number)} exceeds the reader search text limit; use Open PDF`);
          }
          if (strings.join("").trim() === "") unreadable++;
          hits.push(...findPdfText(strings, query, PDF_FIND_MAX_HITS - hits.length).map(match => ({ ...match, page: number })));
          scanned = number;
        } finally {
          // Never clean up a page owned by a concurrent visual render.
          if (page !== this.renderedPage && number !== this.pageNumber) page.cleanup?.();
        }
        if (hits.length >= PDF_FIND_MAX_HITS) break;
        // Yield between pages so closing/changing search can cancel a cached PDF scan.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!current()) return;
      this.findHits = hits;
      const limited = scanned < document.numPages || hits.length >= PDF_FIND_MAX_HITS;
      this.findSummary = `${limited ? ` · Limited to ${String(scanned)} / ${String(document.numPages)} pages, at most ${String(PDF_FIND_MAX_HITS)} matches` : ""}${unreadable > 0 ? ` · ${String(unreadable)} pages without text (no OCR)` : ""}`;
      const first = hits.findIndex(hit => hit.page >= this.pageNumber);
      this.findIndex = first < 0 ? -1 : first - 1;
      if (hits.length > 0) this.stepMatch(1);
      else this.findStatus.textContent = `No matches${this.findSummary}.`;
      this.updateControls();
    } catch (error) {
      if (current()) { this.findHits = []; this.findIndex = -1; this.findStatus.textContent = `Search stopped: ${formatError(error)}. Results are incomplete; retry or use Open PDF.`; this.updateControls(); }
    }
  }

  private stepMatch(direction: number): void {
    if (this.findHits.length === 0) return;
    this.findIndex = (Math.max(-1, this.findIndex) + direction + this.findHits.length) % this.findHits.length;
    const hit = this.findHits[this.findIndex];
    if (hit === undefined) return;
    const generation = this.findGeneration;
    this.findScrollPending = true;
    this.findStatus.textContent = `${String(this.findIndex + 1)} of ${String(this.findHits.length)} matches · Page ${String(hit.page)}${this.findSummary}`;
    this.runInteraction(async () => {
      await this.goToPage(hit.page);
      if (generation !== this.findGeneration) return;
      this.paintFindMatches();
    });
  }

  private paintFindMatches(): void {
    const layer = this.textLayer;
    if (layer === undefined) return;
    const hits = this.findHits.filter(hit => hit.page === this.pageNumber);
    const active = this.findHits[this.findIndex];
    let offset = 0;
    layer.textDivs.forEach((span, index) => {
      const text = layer.textContentItemsStr[index] ?? "";
      const fragments: (Node | string)[] = [];
      let cursor = 0;
      for (const hit of hits) {
        const local = matchInTextRun(hit, offset, text.length);
        if (local === null) continue;
        fragments.push(text.slice(cursor, local.start));
        const mark = window.document.createElement("mark");
        mark.textContent = text.slice(local.start, local.end);
        if (hit === active) mark.dataset["current"] = "true";
        fragments.push(mark); cursor = local.end;
      }
      fragments.push(text.slice(cursor));
      span.replaceChildren(...fragments);
      offset += text.length + 1;
    });
    const mark = this.textContainer.querySelector<HTMLElement>("mark[data-current]");
    // Also handles searches that finish before the current page's text layer.
    // Scroll only this reader, never the enclosing workbench or host.
    if (this.findScrollPending && mark !== null) {
      this.findScrollPending = false;
      const box = mark.getBoundingClientRect(); const view = this.viewportElement.getBoundingClientRect();
      this.viewportElement.scrollTop += box.top - view.top - this.viewportElement.clientHeight / 3;
      this.viewportElement.scrollLeft += box.left - view.left - this.viewportElement.clientWidth / 3;
    }
  }

  private startSelection(event: PointerEvent): void {
    if (!this.marking || this.statusElement.dataset["state"] !== "ready" || !event.isPrimary || this.dragPointerId !== undefined) return;
    const origin = this.pointFromEvent(event);
    if (origin === undefined) return;
    this.dragPointerId = event.pointerId;
    this.dragOrigin = origin;
    this.overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.paintMarquee(origin, origin);
  }

  private updateSelection(event: PointerEvent): void {
    if (this.dragPointerId !== event.pointerId || this.dragOrigin === undefined) return;
    const point = this.pointFromEvent(event);
    if (point === undefined) return;
    event.preventDefault();
    this.paintMarquee(this.dragOrigin, point);
  }

  private async finishSelection(event: PointerEvent): Promise<void> {
    if (this.dragPointerId !== event.pointerId || this.dragOrigin === undefined) return;
    const origin = this.dragOrigin;
    const point = this.pointFromEvent(event) ?? origin;
    this.cancelSelection();
    const rect = normalizedRect({ x: origin.x, y: origin.y, width: point.x - origin.x, height: point.y - origin.y });
    if (rect.width < MIN_SELECTION_FRACTION || rect.height < MIN_SELECTION_FRACTION) {
      this.setStatus("That region was too small to mark. Drag across the passage you want.", "ready");
      return;
    }
    this.setMarking(false);
    const generation = this.generation;
    const renderGeneration = this.renderGeneration;
    const detail: ResearchPdfSelectionDetail = { page: this.pageNumber, rect, quote: await this.quoteForRect(rect) };
    if (!this.isConnected || generation !== this.generation || renderGeneration !== this.renderGeneration) return;
    this.setReadingFocus(false);
    this.dispatchEvent(new CustomEvent<ResearchPdfSelectionDetail>(researchPdfSelectionEventName, { detail, bubbles: true, composed: true }));
  }

  private cancelSelection(): void {
    if (this.dragPointerId !== undefined && this.overlay.hasPointerCapture(this.dragPointerId)) {
      this.overlay.releasePointerCapture(this.dragPointerId);
    }
    this.dragPointerId = undefined;
    this.dragOrigin = undefined;
    this.marquee.hidden = true;
  }

  /** Read the text under a marked region; an unreadable page yields no quote. */
  private async quoteForRect(rect: PdfRect): Promise<string> {
    const page = this.renderedPage;
    if (page?.getTextContent === undefined) return "";
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      return quoteFromTextItems(textItemsToQuoteItems(content.items, viewport.width, viewport.height), rect);
    } catch {
      return "";
    }
  }

  private activateMarker(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest("[data-annotation-id]") : null;
    const id = target?.getAttribute("data-annotation-id");
    if (id === null || id === undefined) return;
    this.setReadingFocus(false);
    this.dispatchEvent(new CustomEvent<{ id: string }>(researchPdfAnnotationEventName, { detail: { id }, bubbles: true, composed: true }));
  }

  private paintMarquee(origin: { x: number; y: number }, point: { x: number; y: number }): void {
    const rect = normalizedRect({ x: origin.x, y: origin.y, width: point.x - origin.x, height: point.y - origin.y });
    this.marquee.hidden = false;
    applyRectStyle(this.marquee, rect);
  }

  private pointFromEvent(event: PointerEvent): { x: number; y: number } | undefined {
    const bounds = this.overlay.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  private renderMarkers(): void {
    const visible = this.document === undefined || !this.showMarkers ? [] : this.markers.filter((marker) => marker.page === this.pageNumber);
    const elements = visible.map((marker) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "marker";
      element.dataset["annotationId"] = marker.id;
      element.dataset["kind"] = marker.kind;
      element.dataset["evidenceStatus"] = marker.status;
      if (marker.id === this.activeMarkerId) element.dataset["active"] = "true";
      element.title = marker.label;
      element.setAttribute("aria-label", `${marker.kind === "question" ? "Question" : "Note"} on page ${String(marker.page)}: ${marker.label}`);
      applyRectStyle(element, marker.rect);
      return element;
    });
    this.overlay.replaceChildren(this.marquee, ...elements);
  }
}

function applyRectStyle(element: HTMLElement, rect: PdfRect): void {
  element.style.left = `${String(rect.x * 100)}%`;
  element.style.top = `${String(rect.y * 100)}%`;
  element.style.width = `${String(rect.width * 100)}%`;
  element.style.height = `${String(rect.height * 100)}%`;
}

export function boundedOutputScale(width: number, height: number, desiredScale: number): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const pixelBound = Math.sqrt(MAX_PDF_RENDER_PIXELS / (safeWidth * safeHeight));
  const dimensionBound = Math.min(MAX_PDF_RENDER_DIMENSION / safeWidth, MAX_PDF_RENDER_DIMENSION / safeHeight);
  return Math.min(desiredScale, pixelBound, dimensionBound);
}

async function loadBundledPdfJs(): Promise<PdfJsModule> {
  const moduleUrl = new URL("./pdfjs/pdf.min.mjs", import.meta.url).href;
  const value: unknown = await import(moduleUrl);
  if (!isPdfJsModule(value)) throw new Error("Bundled PDF.js module has an invalid contract");
  return value;
}

export function isPdfJsModule(value: unknown): value is PdfJsModule {
  return isRecord(value)
    && isPropertyContainer(value["GlobalWorkerOptions"])
    && typeof value["GlobalWorkerOptions"]["workerSrc"] === "string"
    && typeof value["getDocument"] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPropertyContainer(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function required<T>(value: Element | null, type: abstract new (...args: never[]) => T): T {
  if (!(value instanceof type)) throw new Error("Research PDF viewer template is incomplete");
  return value;
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && (error.name === "RenderingCancelledException" || error.name === "AbortException");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
