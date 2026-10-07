import type { PdfDocument, PdfJsModule, PdfPage, PdfRenderTask, PdfTextLayer, PdfViewport } from "./pdfViewerElement.js";
import { boundedOutputScale, MAX_PDF_RENDER_DIMENSION } from "./pdfRenderLimits.js";

/** One evictable page: owns its canvas, text task and PDF page proxy, never the document. */
export class PdfPageSurface {
  readonly element = document.createElement("div");
  readonly canvas = document.createElement("canvas");
  readonly textContainer = document.createElement("div");
  readonly overlay = document.createElement("div");
  readonly marquee = document.createElement("div");
  page: PdfPage | undefined;
  textLayer: PdfTextLayer | undefined;
  ready = false;
  finished = false;
  error = "";
  textError = "";
  scale = 1;
  private disposed = false;
  private isDisposed(): boolean { return this.disposed; }
  private task: PdfRenderTask | undefined;
  private visualDone: (() => void) | undefined;

  constructor(readonly number: number) {
    this.element.className = "page";
    this.element.dataset["page"] = String(number);
    this.canvas.setAttribute("aria-label", `Loading PDF page ${String(number)}`);
    this.textContainer.className = "textLayer";
    this.textContainer.dataset["textLayer"] = "";
    this.overlay.className = "overlay";
    this.overlay.dataset["overlay"] = "";
    this.overlay.dataset["marking"] = "off";
    this.overlay.dataset["textSelecting"] = "false";
    this.overlay.hidden = true;
    this.marquee.className = "marquee";
    this.marquee.dataset["marquee"] = "";
    this.marquee.hidden = true;
    this.overlay.append(this.marquee);
    this.element.append(this.canvas, this.textContainer, this.overlay);
  }

  render(input: {
    document: PdfDocument;
    module: PdfJsModule | undefined;
    context: (canvas: HTMLCanvasElement) => unknown;
    measure: (base: PdfViewport) => number;
    changed: () => void;
  }): Promise<void> {
    const visual = new Promise<void>(resolve => { this.visualDone = resolve; });
    void this.renderPage(input);
    return visual;
  }

  private async renderPage(input: Parameters<PdfPageSurface["render"]>[0]): Promise<void> {
    try {
      const page = await input.document.getPage(this.number);
      if (this.isDisposed()) return;
      this.page = page;
      const base = page.getViewport({ scale: 1 });
      validateSize(base);
      this.scale = input.measure(base);
      if (this.isDisposed()) return;
      const viewport = page.getViewport({ scale: this.scale });
      validateSize(viewport);
      const outputScale = boundedOutputScale(viewport.width, viewport.height, Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
      this.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      this.canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      this.canvas.style.width = `${String(Math.floor(viewport.width))}px`;
      this.canvas.style.height = `${String(Math.floor(viewport.height))}px`;
      this.overlay.style.width = this.canvas.style.width;
      this.overlay.style.height = this.canvas.style.height;
      const context = input.context(this.canvas);
      if (context === null || context === undefined) throw new Error("Canvas rendering is unavailable");
      const task = page.render({ canvasContext: context, viewport, ...(outputScale === 1 ? {} : { transform: [outputScale, 0, 0, outputScale, 0, 0] }) });
      this.task = task;
      await task.promise;
      this.task = undefined;
      if (this.isDisposed()) return;
      this.ready = true;
      this.visualDone?.();
      this.overlay.hidden = false;
      this.canvas.setAttribute("aria-label", `Visual preview of PDF page ${String(this.number)} of ${String(input.document.numPages)}. Use Open PDF for the complete accessible document.`);
      input.changed();
      if (input.module?.TextLayer !== undefined && page.getTextContent !== undefined) {
        try {
          const content = await page.getTextContent();
          if (this.isDisposed()) return;
          this.textContainer.style.setProperty("--total-scale-factor", String(this.scale));
          this.textContainer.style.setProperty("--scale-round-x", "1px");
          this.textContainer.style.setProperty("--scale-round-y", "1px");
          const layer = new input.module.TextLayer({ textContentSource: content, container: this.textContainer, viewport });
          this.textLayer = layer;
          await layer.render();
          if (this.isDisposed()) return;
          if (layer.textContentItemsStr.join("").trim() === "") this.textError = "No selectable text on this page. Scanned pages require OCR outside this reader.";
        } catch (error) {
          if (this.isDisposed()) return;
          this.textLayer = undefined;
          this.textContainer.replaceChildren();
          this.textError = `Text selection unavailable: ${message(error)}. The page remains readable; use Open PDF for another viewer.`;
        }
      }
    } catch (error) {
      if (!this.isDisposed()) {
        this.error = message(error);
        const warning = document.createElement("p");
        warning.className = "page-error";
        warning.textContent = `Page ${String(this.number)}: ${this.error}. Reload PDF to retry, or use Open PDF.`;
        this.element.append(warning);
      }
    } finally {
      this.finished = true;
      this.visualDone?.();
      if (!this.isDisposed()) input.changed();
    }
  }

  /** Cancel immediately. Draining before replacement keeps the bitmap window bounded.
   * Same-document rerenders retain proxies; eviction/source teardown may clean them. */
  dispose(cleanup = true): Promise<void> {
    this.disposed = true;
    this.task?.cancel();
    this.textLayer?.cancel();
    if (cleanup) this.page?.cleanup?.();
    this.element.remove();
    return (this.task?.promise ?? Promise.resolve()).then(() => undefined, () => undefined).then(() => {
      this.canvas.width = this.canvas.height = 0;
      this.textContainer.replaceChildren();
      if (cleanup) this.page?.cleanup?.();
    });
  }
}

function validateSize(size: PdfViewport): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new Error("PDF page dimensions are invalid");
  if (size.width > MAX_PDF_RENDER_DIMENSION || size.height > MAX_PDF_RENDER_DIMENSION) throw new Error("PDF page dimensions exceed the safe render limit");
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
