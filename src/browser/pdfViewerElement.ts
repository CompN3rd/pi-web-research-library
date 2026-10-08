import { normalizedRect, type PdfRect } from "../domain/pdf.js";
import { pdfViewerTemplate } from "./pdfViewerTemplate.js";
import { PdfContinuousLayout } from "./pdfContinuousLayout.js";
import { PdfPageSurface } from "./pdfPageSurface.js";
import { PdfThumbnails } from "./pdfThumbnails.js";
import { PdfOutline, type PdfOutlineDocument } from "./pdfOutline.js";
import { selectedTextRange, textSelectionAnchor, type TextSelectionAnchor } from "./pdfTextSelection.js";
import { findPdfText, matchInTextRun, pdfTextStrings, PDF_FIND_MAX_PAGES, PDF_FIND_MAX_HITS, PDF_FIND_MAX_PAGE_CHARACTERS, type PdfFitMode, type PdfFindHit } from "./pdfReading.js";
import { quoteFromTextItems, textItemsToQuoteItems, type PdfTextContentItem } from "./pdfQuote.js";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdfRange, type PdfPeerSource, type PdfRangeTransport, type RangeModule } from "./pdfRange.js";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
import { MAX_PDF_RENDER_PIXELS } from "./pdfRenderLimits.js";
export { MAX_PDF_RENDER_DIMENSION, MAX_PDF_RENDER_PIXELS, boundedOutputScale } from "./pdfRenderLimits.js";

export const researchLibraryPdfViewerTagName = "pi-web-research-library-pdf-viewer";
export const researchPdfSelectionEventName = "research-pdf-region-selected";
export const researchPdfAnnotationEventName = "research-pdf-annotation-activated";
export const researchPdfReadyEventName = "research-pdf-ready";
export const researchPdfPageEventName = "research-pdf-page";

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
  kind: "question" | "note" | "highlight";
  status: "open" | "resolved";
  label: string;
}

export interface PdfViewport {
  width: number;
  height: number;
}

export interface PdfRenderTask {
  promise: Promise<unknown>;
  cancel(): void;
}

export interface PdfPage {
  getViewport(input: { scale: number }): PdfViewport;
  render(input: { canvasContext: unknown; viewport: PdfViewport; transform?: number[] }): PdfRenderTask;
  getTextContent?(): Promise<{ items: PdfTextContentItem[] }>;
  cleanup?(): void;
}

export interface PdfDocument extends Pick<PDFDocumentProxy, "numPages">, Partial<Pick<PdfOutlineDocument, "getOutline" | "getDestination" | "getPageIndex">> {
  getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfTextLayer {
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

function hasOutlineApis(pdf: PdfDocument): pdf is PdfDocument & PdfOutlineDocument {
  return typeof pdf.getOutline === "function" && typeof pdf.getDestination === "function" && typeof pdf.getPageIndex === "function";
}

export function defineResearchLibraryPdfViewerElement(): void {
  if (!customElements.get(researchLibraryPdfViewerTagName)) customElements.define(researchLibraryPdfViewerTagName, ResearchLibraryPdfViewerElement);
}

export class ResearchLibraryPdfViewerElement extends HTMLElement {
  private readonly root = this.attachShadow({ mode: "open" });
  private readonly emptySurface = new PdfPageSurface(1);
  private readonly surfaces = new Map<number, PdfPageSurface>();
  private layout: PdfContinuousLayout | undefined;
  private readonly stage: HTMLElement;
  private readonly thumbnails: PdfThumbnails;
  private readonly outline: PdfOutline;
  private scrollFrame: number | undefined;
  private windowGeneration = 0;
  private layoutChanging = false;
  private positionGeneration = 0;
  private pendingPageJump: number | undefined;
  private pageInputDirty = false;
  private draining: Promise<void> = Promise.resolve();
  private get surface(): PdfPageSurface { return this.surfaces.get(this.pageNumber) ?? this.emptySurface; }
  private get canvas(): HTMLCanvasElement { return this.surface.canvas; }
  private get overlay(): HTMLElement { return this.surface.overlay; }
  private get marquee(): HTMLElement { return this.surface.marquee; }
  private get textContainer(): HTMLElement { return this.surface.textContainer; }
  private get textLayer(): PdfTextLayer | undefined { return this.surface.textLayer; }
  private get renderedPage(): PdfPage | undefined { return this.surface.page; }
  private readonly statusElement: HTMLElement;
  private readonly fallback: HTMLAnchorElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly zoomOutButton: HTMLButtonElement;
  private readonly zoomInButton: HTMLButtonElement;
  private readonly markButton: HTMLButtonElement;
  private readonly pageInput: HTMLInputElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly viewportElement: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly fitSelect: HTMLSelectElement;
  private readonly findInput: HTMLInputElement;
  private readonly findStatus: HTMLElement;
  private pdfjs: PdfJsModule | undefined;
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
  private keyboardRegion: PdfRect = { x: .1, y: .1, width: .4, height: .1 };
  private dragPointerId: number | undefined;
  private dragOrigin: { x: number; y: number } | undefined;
  private source: string | undefined;
  private peerSource: PdfPeerSource | undefined;
  private sourceAbort: AbortController | undefined;

  set pdfPeerSource(value: PdfPeerSource) { this.peerSource = value; }
  private generation = 0;
  private renderGeneration = 0;
  private readyGeneration = -1;
  private announcedPage = 0;
  private pageNumber = 1;
  private zoom = 1;
  private renderedZoom = 1;
  private document: PdfDocument | undefined;
  private loadingTask: PdfLoadingTask | undefined;
  private moduleLoader: PdfJsModuleLoader = loadBundledPdfJs;
  private contextFactory: (canvas: HTMLCanvasElement) => unknown = (canvas) => canvas.getContext("2d", { alpha: false });

  constructor() {
    super();
    this.root.innerHTML = pdfViewerTemplate();
    this.stage = required(this.root.querySelector(".stage"), HTMLElement);
    this.stage.replaceChildren(this.emptySurface.element);
    this.thumbnails = new PdfThumbnails(
      this.control("[data-thumbnails]"), required(this.root.querySelector("[data-thumbnails-toggle]"), HTMLButtonElement),
      canvas => this.contextFactory(canvas), page => { this.showPage(page); },
      (number, page) => { if (!this.surfaces.has(number)) page.cleanup?.(); },
    );
    this.thumbnails.setDocument(undefined);
    this.outline = new PdfOutline(this.control("[data-outline]"), required(this.root.querySelector("[data-outline-toggle]"), HTMLButtonElement), page => { this.showPage(page); });
    this.outline.setDocument(undefined);
    this.statusElement = required(this.root.querySelector("[data-status]"), HTMLElement);
    this.fallback = required(this.root.querySelector("[data-open-pdf]"), HTMLAnchorElement);
    this.previousButton = required(this.root.querySelector("[data-previous]"), HTMLButtonElement);
    this.nextButton = required(this.root.querySelector("[data-next]"), HTMLButtonElement);
    this.zoomOutButton = required(this.root.querySelector("[data-zoom-out]"), HTMLButtonElement);
    this.zoomInButton = required(this.root.querySelector("[data-zoom-in]"), HTMLButtonElement);
    this.markButton = required(this.root.querySelector("[data-mark]"), HTMLButtonElement);
    this.pageInput = required(this.root.querySelector("[data-page-number]"), HTMLInputElement);
    this.reloadButton = required(this.root.querySelector("[data-reload]"), HTMLButtonElement);
    this.viewportElement = required(this.root.querySelector(".viewport"), HTMLElement);
    this.dialog = required(this.root.querySelector("dialog"), HTMLDialogElement);
    this.fitSelect = required(this.root.querySelector("[data-fit]"), HTMLSelectElement);
    this.findInput = required(this.root.querySelector("[data-find-input]"), HTMLInputElement);
    this.findStatus = required(this.root.querySelector("[data-find-status]"), HTMLElement);
    for (const selector of ["[data-text-toggle]", "[data-text-comment]"]) {
      // Keep the native selection when a mouse/touch activates these controls.
      this.control(selector).addEventListener("pointerdown", event => { event.preventDefault(); });
    }
    this.control("[data-text-toggle]").addEventListener("click", () => { this.toggleTextTools(this.control("[data-text-tools]").hidden === true); });
    this.control("[data-text-close]").addEventListener("click", () => { this.toggleTextTools(false); this.control("[data-text-toggle]").focus(); });
    this.control("[data-text-comment]").addEventListener("click", () => { this.commentOnText(false); });
    this.control("[data-passage-comment]").addEventListener("click", () => { this.commentOnText(true); });
    this.control("[data-text-start]").addEventListener("change", () => {
      const start = required(this.root.querySelector("[data-text-start]"), HTMLSelectElement);
      const end = required(this.root.querySelector("[data-text-end]"), HTMLSelectElement);
      if (Number(end.value) < Number(start.value)) end.value = start.value;
      this.previewPassage();
    });
    this.control("[data-text-end]").addEventListener("change", () => { this.previewPassage(); });
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
    this.pageInput.addEventListener("input", () => { this.pageInputDirty = true; });
    this.pageInput.addEventListener("blur", () => { this.pageInputDirty = false; this.updateControls(); });
    this.pageInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        const value = this.pageInput.valueAsNumber;
        this.pageInputDirty = false;
        this.showPage(value);
      }
    });
    this.pageInput.addEventListener("change", () => {
      const value = this.pageInput.valueAsNumber;
      this.pageInputDirty = false;
      if (!Number.isSafeInteger(value)) { this.updateControls(); return; }
      this.showPage(value);
    });
    this.root.addEventListener("keydown", event => { if (event instanceof KeyboardEvent) this.onKeyDown(event); });
    this.reloadButton.addEventListener("click", () => { this.closeOptions(); void this.loadSource(this.source, true); });
    this.stage.addEventListener("pointerdown", event => {
      const page = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-page]") : null;
      const number = Number(page?.dataset["page"]);
      if (this.surfaces.has(number) && number !== this.pageNumber) {
        const textToolsOpen = this.control("[data-text-tools]").hidden !== true;
        this.activatePage(number);
        if (textToolsOpen) this.toggleTextTools(true);
        this.runInteraction(() => this.renderWindow());
      }
      this.startSelection(event);
    });
    this.stage.addEventListener("pointermove", event => { this.updateSelection(event); });
    this.stage.addEventListener("pointerup", event => { this.runInteraction(() => this.finishSelection(event)); });
    this.stage.addEventListener("pointercancel", () => { this.cancelSelection(); });
    this.stage.addEventListener("click", event => { this.activateMarker(event); });
    this.viewportElement.addEventListener("scroll", () => {
      if (this.scrollFrame !== undefined) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = undefined;
        if (this.layout === undefined || this.layoutChanging || this.dragPointerId !== undefined) return;
        const next = this.layout.pageAt(this.viewportElement.scrollTop + Math.min(150, this.viewportElement.clientHeight / 4));
        if (next !== this.pageNumber) this.activatePage(next);
        this.runInteraction(() => this.renderWindow());
      });
    });
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

  /** Return keyboard focus from a contextual editor to the document. */
  focusPage(): void { this.viewportElement.focus({ preventScroll: true }); }

  /** Arm or disarm region marking; disarming always releases a pointer capture. */
  setMarking(marking: boolean): void {
    const armed = marking && this.document !== undefined && this.statusElement.dataset["state"] === "ready";
    if (armed === this.marking) {
      if (!armed) this.cancelSelection();
      return;
    }
    this.marking = armed;
    if (armed) this.toggleTextTools(false);
    if (!armed) this.cancelSelection();
    else {
      this.keyboardRegion = { x: .1, y: .1, width: .4, height: .1 };
      this.marquee.hidden = false; applyRectStyle(this.marquee, this.keyboardRegion);
    }
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
      if (this.viewportElement.clientWidth === 0 || size === this.viewportSize) return;
      if (this.fitMode === "custom") {
        this.viewportSize = size;
        this.runInteraction(() => this.renderWindow());
        return;
      }
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
    if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = undefined;
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
      this.thumbnails.setDocument(document);
      this.outline.setDocument(hasOutlineApis(document) ? document : undefined);
      this.pageNumber = Math.max(1, Math.min(document.numPages, this.pageNumber));
      await this.renderCurrentPage(generation, keepPosition);
    } catch (error) {
      if (generation === this.generation) await this.dispose(generation);
      this.handleOperationError(error, generation);
    } finally {
      if (generation === this.generation) this.updateControls();
    }
  }

  private activatePage(number: number): void {
    if (number === this.pageNumber) return;
    this.outline.cancelNavigation();
    this.setMarking(false);
    this.toggleTextTools(false);
    window.getSelection()?.removeAllRanges();
    this.renderGeneration++;
    this.pageNumber = number;
    this.refreshActivePage();
  }

  private refreshActivePage(): void {
    const surface = this.surface;
    for (const [number, page] of this.surfaces) page.element.dataset["activePage"] = String(number === this.pageNumber);
    if (surface.ready) this.zoom = this.renderedZoom = surface.scale;
    if (surface.error !== "") this.setStatus(`Unable to render PDF: ${surface.error}`, "error");
    else if (surface.ready && !this.layoutChanging) this.setStatus(`Page ${String(this.pageNumber)} of ${String(this.pageCount)} · ${String(Math.round(this.zoom * 100))}%`, "ready");
    else this.setStatus(`Rendering page ${String(this.pageNumber)}…`, "loading");
    this.control("[data-text-status]").textContent = surface.textError;
    this.updateControls();
  }

  private async goToPage(next: number): Promise<void> {
    this.outline.cancelNavigation();
    if (this.document === undefined || !Number.isSafeInteger(next)) return;
    const bounded = Math.max(1, Math.min(this.document.numPages, next));
    const positionGeneration = ++this.positionGeneration;
    this.layoutChanging = true;
    this.pendingPageJump = bounded;
    this.activatePage(bounded);
    // Opening/closing navigation or Focus changes the fitted viewport. Apply it
    // with this jump, not in a later resize callback that could cancel new tools.
    if (this.fitMode !== "custom" && this.viewportSize !== this.currentViewportSize()) {
      clearTimeout(this.resizeTimer);
      await this.renderCurrentPage(this.generation, false);
      return;
    }
    await this.renderWindow();
    if (positionGeneration !== this.positionGeneration || bounded !== this.pageNumber || this.layout === undefined) return;
    this.viewportElement.scrollTop = this.layout.top(bounded) - 20;
    this.pendingPageJump = undefined;
    this.viewportElement.scrollLeft = 0;
    this.paintFindMatches();
    this.layoutChanging = false;
    this.refreshActivePage();
    this.announceReady();
  }

  private async setZoom(next: number): Promise<void> {
    const bounded = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(next / ZOOM_STEP) * ZOOM_STEP));
    if (this.document === undefined || !Number.isFinite(next)) return;
    this.fitMode = "custom";
    this.zoom = bounded;
    await this.renderCurrentPage(this.generation);
  }

  /** Re-layout only for zoom/resize/reload. Ordinary scrolling retains live neighbors. */
  private async renderCurrentPage(generation: number, preservePosition = true): Promise<void> {
    const pdf = this.document;
    if (pdf === undefined) return;
    const renderGeneration = ++this.renderGeneration;
    const positionGeneration = ++this.positionGeneration;
    this.layoutChanging = true;
    this.toggleTextTools(false);
    this.setMarking(false);
    const oldTop = this.layout?.top(this.pageNumber) ?? 20;
    const position = { top: (this.viewportElement.scrollTop - oldTop) / this.renderedZoom, left: this.viewportElement.scrollLeft / this.renderedZoom };
    this.layout ??= new PdfContinuousLayout(pdf.numPages);
    this.layout.mode = this.fitMode;
    this.layout.zoom = this.zoom;
    this.layout.viewport = { width: this.viewportElement.clientWidth, height: this.viewportElement.clientHeight };
    this.viewportSize = this.currentViewportSize();
    this.windowGeneration++;
    const old = [...this.surfaces.values()];
    this.surfaces.clear();
    this.emptySurface.element.remove();
    this.draining = Promise.allSettled([this.draining, ...old.map(surface => surface.dispose(false))]).then(() => undefined);
    this.setStatus(`Rendering page ${String(this.pageNumber)}…`, "loading");
    await this.draining;
    if (generation !== this.generation || renderGeneration !== this.renderGeneration) return;
    await this.renderWindow();
    if (generation !== this.generation || renderGeneration !== this.renderGeneration || positionGeneration !== this.positionGeneration) return;
    this.renderedZoom = this.layout.scale(this.pageNumber);
    // A resize may supersede a jump before its scroll offset was applied. Keep
    // that explicit target rather than preserving the old page's screen position.
    this.viewportElement.scrollTop = this.layout.top(this.pageNumber) + (preservePosition && this.pendingPageJump !== this.pageNumber ? position.top * this.renderedZoom : -20);
    this.pendingPageJump = undefined;
    this.viewportElement.scrollLeft = preservePosition ? position.left * this.renderedZoom : 0;
    this.paintFindMatches();
    this.layoutChanging = false;
    this.refreshActivePage();
    this.announceReady();
  }

  private positionSurfaces(): void {
    const layout = this.layout;
    if (layout === undefined) return;
    let width = this.viewportElement.clientWidth;
    for (const [number, surface] of this.surfaces) {
      const size = layout.size(number);
      surface.element.style.top = `${String(layout.top(number))}px`;
      surface.element.style.width = `${String(size.width)}px`;
      surface.element.style.height = `${String(size.height)}px`;
      width = Math.max(width, size.width + 40);
    }
    // A short final page must still be able to align at the top. Otherwise a
    // clamped jump is immediately reclassified as the preceding page on scroll.
    const height = Math.max(layout.height, layout.top(this.pageCount) - 20 + this.viewportElement.clientHeight);
    this.stage.style.height = `${String(height)}px`;
    this.stage.style.width = `${String(width)}px`;
  }

  private pageWindow(): number[] {
    const layout = this.layout;
    return layout?.window(this.pageNumber, this.layoutChanging ? layout.top(this.pageNumber) - 20 : this.viewportElement.scrollTop, this.viewportElement.clientHeight) ?? [];
  }

  private async renderWindow(): Promise<void> {
    const pdf = this.document, layout = this.layout;
    if (pdf === undefined || layout === undefined) return;
    const generation = this.generation;
    const windowGeneration = ++this.windowGeneration;
    const wanted = this.pageWindow();
    const evicted: Promise<void>[] = [];
    for (const [number, surface] of this.surfaces) {
      if (!wanted.includes(number)) { this.surfaces.delete(number); evicted.push(surface.dispose()); }
    }
    this.draining = Promise.allSettled([this.draining, ...evicted]).then(() => undefined);
    await this.draining;
    if (generation !== this.generation || windowGeneration !== this.windowGeneration) return;
    const work: Promise<void>[] = [];
    // Render the requested page before its neighbors so its dimensions seed estimates.
    for (const number of [this.pageNumber, ...wanted.filter(number => number !== this.pageNumber)]) {
      if (this.surfaces.has(number)) continue;
      const surface = new PdfPageSurface(number);
      this.surfaces.set(number, surface);
      const following = [...this.surfaces.values()].filter(page => page.number > number).sort((a, b) => a.number - b.number)[0];
      this.stage.insertBefore(surface.element, following?.element ?? null);
      const current = (): boolean => generation === this.generation && this.surfaces.get(number) === surface;
      work.push(surface.render({
        document: pdf, module: this.pdfjs, context: this.contextFactory,
        measure: base => {
          if (!current()) return 1;
          const top = layout.top(this.pageNumber);
          layout.measure(number, base);
          this.positionSurfaces();
          // Disable browser scroll anchoring: preserve the active page ourselves when
          // a newly measured preceding page changes the estimated document offsets.
          this.viewportElement.scrollTop += layout.top(this.pageNumber) - top;
          return layout.scale(number);
        },
        changed: () => {
          if (!current()) return;
          this.renderMarkers();
          if (number === this.pageNumber) {
            this.refreshActivePage();
            this.paintFindMatches();
            if (this.control("[data-text-tools]").hidden !== true) this.toggleTextTools(true);
            this.announceReady();
          }
        },
      }));
    }
    this.positionSurfaces();
    this.refreshActivePage();
    await Promise.all(work);
    if (generation !== this.generation || windowGeneration !== this.windowGeneration) return;
    this.refreshActivePage();
    this.announceReady();
    // Measuring a short or landscape page can reveal another visible page.
    if (this.pageWindow().some(number => !this.surfaces.has(number))) await this.renderWindow();
  }

  private announceReady(): void {
    if (!this.layoutChanging && this.surface.ready && this.surface.finished && this.readyGeneration !== this.generation) {
      this.readyGeneration = this.generation;
      this.dispatchEvent(new CustomEvent(researchPdfReadyEventName, { detail: { sourceUrl: this.source, pageCount: this.pageCount }, bubbles: true, composed: true }));
    }
    // A ready listener may synchronously start a backlink/restore jump. Never
    // publish the provisional first page over that pending location.
    if (!this.layoutChanging && this.surface.ready && this.surface.finished && this.readyGeneration === this.generation && this.announcedPage !== this.pageNumber) {
      this.announcedPage = this.pageNumber;
      this.dispatchEvent(new CustomEvent(researchPdfPageEventName, { detail: { sourceUrl: this.source, page: this.pageNumber }, bubbles: true, composed: true }));
    }
  }

  private async dispose(expectedGeneration: number): Promise<void> {
    this.announcedPage = 0;
    this.outline.setDocument(undefined);
    this.thumbnails.setDocument(undefined);
    this.sourceAbort?.abort();
    this.sourceAbort = undefined;
    this.findGeneration++;
    this.toggleTextTools(false);
    this.setMarking(false);
    this.windowGeneration++;
    const disposed = [...this.surfaces.values()].map(surface => surface.dispose());
    this.surfaces.clear();
    this.draining = Promise.allSettled([this.draining, ...disposed]).then(() => undefined);
    this.layout = undefined;
    this.positionGeneration++;
    this.pendingPageJump = undefined;
    this.pageInputDirty = false;
    this.layoutChanging = false;
    this.stage.style.height = "";
    this.stage.style.width = "";
    this.pdfjs = undefined;
    this.setMarking(false);
    this.renderGeneration += 1;
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
    this.thumbnails.setCurrentPage(this.pageNumber);
    this.previousButton.disabled = pages === 0 || this.pageNumber <= 1;
    this.nextButton.disabled = pages === 0 || this.pageNumber >= pages;
    this.zoomOutButton.disabled = pages === 0 || this.zoom <= MIN_ZOOM;
    this.zoomInButton.disabled = pages === 0 || this.zoom >= MAX_ZOOM;
    this.markButton.disabled = pages === 0 || this.statusElement.dataset["state"] !== "ready";
    required(this.root.querySelector("[data-text-toggle]"), HTMLButtonElement).disabled = this.markButton.disabled;
    this.pageInput.disabled = pages === 0;
    this.pageInput.max = String(Math.max(1, pages));
    if (!this.pageInputDirty) this.pageInput.value = String(this.pageNumber);
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
      else if (this.control("[data-text-tools]").hidden !== true) { this.toggleTextTools(false); this.control("[data-text-toggle]").focus(); }
      else if (required(this.root.querySelector("[data-more]"), HTMLDetailsElement).open) { this.closeOptions(); this.control("[data-more] summary").focus(); }
      else if (this.control("[data-find-bar]").hidden !== true) this.toggleFind(false);
      else this.setReadingFocus(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.closest("input, select, textarea, button, summary, a") !== null || target.isContentEditable)) return;
    if (this.marking && (key.startsWith("arrow") || key === "enter")) {
      event.preventDefault();
      if (this.dragPointerId !== undefined) return;
      if (key === "enter") this.runInteraction(() => this.commitRegion(this.keyboardRegion));
      else {
        const rect = this.keyboardRegion;
        const dx = key === "arrowright" ? .01 : key === "arrowleft" ? -.01 : 0;
        const dy = key === "arrowdown" ? .01 : key === "arrowup" ? -.01 : 0;
        this.keyboardRegion = event.shiftKey
          ? { ...rect, width: Math.max(.01, Math.min(1 - rect.x, rect.width + dx)), height: Math.max(.01, Math.min(1 - rect.y, rect.height + dy)) }
          : { ...rect, x: Math.max(0, Math.min(1 - rect.width, rect.x + dx)), y: Math.max(0, Math.min(1 - rect.height, rect.y + dy)) };
        this.marquee.hidden = false; applyRectStyle(this.marquee, this.keyboardRegion);
        this.marquee.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = this.keyboardRegion;
        this.setStatus(`Region: ${String(Math.round(r.x * 100))}%, ${String(Math.round(r.y * 100))}%; size ${String(Math.round(r.width * 100))}% × ${String(Math.round(r.height * 100))}%. Enter to annotate.`, "ready");
      }
      return;
    }
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
      this.viewportElement.scrollBy({ top: this.viewportElement.clientHeight * .85 * (backwards ? -1 : 1), behavior: "auto" });
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
          if (![...this.surfaces.values()].some(surface => surface.page === page || surface.number === number)) page.cleanup?.();
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
    for (const surface of this.surfaces.values()) this.paintPageFindMatches(surface);
  }

  private paintPageFindMatches(surface: PdfPageSurface): void {
    const layer = surface.textLayer;
    if (layer === undefined) return;
    const hits = this.findHits.filter(hit => hit.page === surface.number);
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
    const mark = surface.textContainer.querySelector<HTMLElement>("mark[data-current]");
    // Also handles searches that finish before the current page's text layer.
    // Scroll only this reader, never the enclosing workbench or host.
    if (this.findScrollPending && surface.number === this.pageNumber && mark !== null) {
      this.findScrollPending = false;
      const box = mark.getBoundingClientRect(); const view = this.viewportElement.getBoundingClientRect();
      this.viewportElement.scrollTop += box.top - view.top - this.viewportElement.clientHeight / 3;
      this.viewportElement.scrollLeft += box.left - view.left - this.viewportElement.clientWidth / 3;
    }
  }

  private toggleTextTools(open: boolean): void {
    this.control("[data-text-tools]").hidden = !open;
    for (const surface of this.surfaces.values()) surface.overlay.dataset["textSelecting"] = String(open);
    this.control("[data-text-toggle]").setAttribute("aria-expanded", String(open));
    this.control("[data-selection-status]").textContent = "";
    this.control("[data-text-preview]").textContent = "";
    const start = required(this.root.querySelector("[data-text-start]"), HTMLSelectElement);
    const end = required(this.root.querySelector("[data-text-end]"), HTMLSelectElement);
    start.replaceChildren(); end.replaceChildren();
    if (!open) return;
    this.setMarking(false);
    const runs = this.textLayer?.textContentItemsStr ?? [];
    const selectable = runs.flatMap((text, index) => text.trim() === "" ? [] : [{ text, index }]);
    // Avoid an unbounded native option list on pathological pages. Native selection
    // and region marking remain available; never silently omit selectable runs.
    const available = selectable.length > 0 && selectable.length <= 2000;
    start.disabled = end.disabled = !available;
    required(this.root.querySelector("[data-passage-comment]"), HTMLButtonElement).disabled = !available;
    if (!available) {
      this.control("[data-selection-status]").textContent = selectable.length > 2000 ? "Too many text runs for the picker. Select text on the page or mark a region." : "No selectable text is ready on this page. Try again after loading, or mark a region.";
      return;
    }
    for (const { text, index } of selectable) {
      const option = document.createElement("option"); option.value = String(index); option.textContent = `${String(index + 1)}: ${text}`;
      start.append(option); end.append(option.cloneNode(true));
    }
    this.previewPassage();
  }

  private passageRuns(): { spans: HTMLElement[]; quote: string } {
    const start = Number(required(this.root.querySelector("[data-text-start]"), HTMLSelectElement).value);
    const end = Number(required(this.root.querySelector("[data-text-end]"), HTMLSelectElement).value);
    const layer = this.textLayer;
    if (layer === undefined || start > end || layer.textDivs[start] === undefined || layer.textDivs[end] === undefined) throw new Error("Choose a passage end at or after its start.");
    return { spans: layer.textDivs.slice(start, end + 1), quote: layer.textContentItemsStr.slice(start, end + 1).join("\n") };
  }

  private previewPassage(): void {
    try {
      const { quote } = this.passageRuns();
      this.control("[data-text-preview]").textContent = quote.length <= 16_000 ? quote : "Passage exceeds 16,000 characters. Choose a shorter passage.";
      this.control("[data-selection-status]").textContent = "";
    } catch (error) {
      this.control("[data-text-preview]").textContent = "";
      this.control("[data-selection-status]").textContent = formatError(error);
    }
  }

  private commentOnText(fromPicker: boolean): void {
    try {
      if (this.document === undefined || this.statusElement.dataset["state"] !== "ready" || this.control("[data-text-tools]").hidden === true) return;
      const page = this.canvas.getBoundingClientRect();
      let anchor: TextSelectionAnchor;
      if (fromPicker) {
        const { spans, quote } = this.passageRuns();
        anchor = textSelectionAnchor(quote, spans.map(span => span.getBoundingClientRect()), page);
      } else {
        const range = selectedTextRange(this.root, this.textContainer);
        if (range === undefined) throw new Error("Select text on this PDF page first, or use the keyboard/touch passage picker.");
        anchor = textSelectionAnchor(range.toString(), Array.from(range.getClientRects()), page);
      }
      const detail: ResearchPdfSelectionDetail = { page: this.pageNumber, ...anchor };
      this.toggleTextTools(false);
      window.getSelection()?.removeAllRanges();
      this.setReadingFocus(false);
      this.dispatchEvent(new CustomEvent<ResearchPdfSelectionDetail>(researchPdfSelectionEventName, { detail, bubbles: true, composed: true }));
    } catch (error) { this.control("[data-selection-status]").textContent = formatError(error); }
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
    await this.commitRegion(rect);
  }

  private async commitRegion(rect: PdfRect): Promise<void> {
    this.setMarking(false);
    const generation = this.generation;
    const renderGeneration = this.renderGeneration;
    const detail: ResearchPdfSelectionDetail = { page: this.pageNumber, rect, quote: await this.quoteForRect(rect) };
    if (!this.isConnected || generation !== this.generation || renderGeneration !== this.renderGeneration || detail.page !== this.pageNumber) return;
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
    for (const surface of this.surfaces.values()) this.renderPageMarkers(surface);
  }

  private renderPageMarkers(surface: PdfPageSurface): void {
    const visible = this.document === undefined || !this.showMarkers ? [] : this.markers.filter((marker) => marker.page === surface.number);
    const elements = visible.map((marker) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "marker";
      element.dataset["annotationId"] = marker.id;
      element.dataset["kind"] = marker.kind;
      element.dataset["evidenceStatus"] = marker.status;
      if (marker.id === this.activeMarkerId) element.dataset["active"] = "true";
      element.title = marker.label;
      element.setAttribute("aria-label", `${marker.kind === "question" ? "Question" : marker.kind === "highlight" ? "Highlight" : "Note"} on page ${String(marker.page)}: ${marker.label}`);
      applyRectStyle(element, marker.rect);
      return element;
    });
    surface.overlay.replaceChildren(surface.marquee, ...elements);
  }
}

function applyRectStyle(element: HTMLElement, rect: PdfRect): void {
  element.style.left = `${String(rect.x * 100)}%`;
  element.style.top = `${String(rect.y * 100)}%`;
  element.style.width = `${String(rect.width * 100)}%`;
  element.style.height = `${String(rect.height * 100)}%`;
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
