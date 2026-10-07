import type { PdfDocument, PdfPage, PdfRenderTask } from "./pdfViewerElement.js";

export const PDF_THUMBNAIL_GROUP_SIZE = 6;
const WIDTH = 96;
const HEIGHT = 112;

/** Lazy, serial previews on the reader's existing document. No text layers or second reader. */
export class PdfThumbnails {
  private pdf: PdfDocument | undefined;
  private current = 1;
  private start = 1;
  private generation = 0;
  private task: PdfRenderTask | undefined;
  private pending: Promise<void> = Promise.resolve();
  private readonly list = document.createElement("div");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly status = document.createElement("span");

  constructor(
    private readonly panel: HTMLElement,
    private readonly toggle: HTMLButtonElement,
    private readonly context: (canvas: HTMLCanvasElement) => unknown,
    private readonly navigate: (page: number) => void,
    private readonly releasePage: (number: number, page: PdfPage) => void,
  ) {
    const controls = document.createElement("div"); controls.className = "thumbnail-controls";
    this.previous.type = this.next.type = "button";
    this.previous.textContent = "Previous previews"; this.next.textContent = "Next previews";
    this.status.setAttribute("role", "status");
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Close page previews";
    close.addEventListener("click", () => { this.setOpen(false); this.toggle.focus(); });
    this.previous.addEventListener("click", () => { this.start = Math.max(1, this.start - PDF_THUMBNAIL_GROUP_SIZE); this.refresh(); });
    this.next.addEventListener("click", () => { this.start += PDF_THUMBNAIL_GROUP_SIZE; this.refresh(); });
    controls.append(this.previous, this.next, this.status, close);
    this.list.className = "thumbnail-list";
    this.panel.append(controls, this.list);
    this.panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.setOpen(false); this.toggle.focus(); }
    });
    this.toggle.addEventListener("click", () => { this.setOpen(this.panel.hidden === true); });
  }

  setDocument(pdf: PdfDocument | undefined): void {
    this.setOpen(false);
    this.pdf = pdf;
    this.current = this.start = 1;
    this.toggle.disabled = pdf === undefined;
  }

  setCurrentPage(page: number): void {
    if (page === this.current) return;
    this.current = page;
    if (this.panel.hidden === true) return;
    if (page < this.start || page >= this.start + PDF_THUMBNAIL_GROUP_SIZE) {
      this.start = this.groupStart(page); this.refresh();
    } else this.markCurrent();
  }

  private groupStart(page: number): number { return Math.floor((page - 1) / PDF_THUMBNAIL_GROUP_SIZE) * PDF_THUMBNAIL_GROUP_SIZE + 1; }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open && this.pdf !== undefined) { this.start = this.groupStart(this.current); this.refresh(); }
    else this.clear();
  }

  private clear(): void {
    this.generation++;
    this.task?.cancel();
    const canvases = [...this.list.querySelectorAll("canvas")];
    this.list.replaceChildren();
    // Never resize a canvas while PDF.js still owns its rendering task.
    void this.pending.then(() => { for (const canvas of canvases) canvas.width = canvas.height = 0; });
  }

  private markCurrent(): void {
    for (const button of this.list.querySelectorAll("button")) {
      if (Number(button.dataset["thumbnailPage"]) === this.current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  private refresh(): void {
    this.clear();
    const pdf = this.pdf;
    if (pdf === undefined || this.panel.hidden === true) return;
    const generation = this.generation;
    const end = Math.min(pdf.numPages, this.start + PDF_THUMBNAIL_GROUP_SIZE - 1);
    this.previous.disabled = this.start === 1; this.next.disabled = end === pdf.numPages;
    this.status.textContent = `Previews ${String(this.start)}–${String(end)} of ${String(pdf.numPages)}`;
    const entries: { number: number; canvas: HTMLCanvasElement; state: HTMLSpanElement }[] = [];
    for (let number = this.start; number <= end; number++) {
      const button = document.createElement("button"); button.type = "button";
      button.dataset["thumbnailPage"] = String(number);
      button.setAttribute("aria-label", `Go to PDF page ${String(number)}`);
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 0; canvas.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.textContent = `Page ${String(number)}`;
      const state = document.createElement("span"); state.className = "thumbnail-state"; state.textContent = "Loading preview…";
      button.append(canvas, label, state);
      button.addEventListener("click", () => { this.navigate(number); });
      this.list.append(button); entries.push({ number, canvas, state });
    }
    this.markCurrent();
    // A superseded batch drains before another allocates bitmaps. Late getPage
    // results cannot start a render or publish into a different source's panel.
    this.pending = this.pending.then(async () => {
      for (const { number, canvas, state } of entries) {
        if (generation !== this.generation) return;
        let page: PdfPage | undefined;
        try {
          page = await pdf.getPage(number);
          if (generation !== this.generation) return;
          const base = page.getViewport({ scale: 1 });
          if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid page dimensions");
          const viewport = page.getViewport({ scale: Math.min(WIDTH / base.width, HEIGHT / base.height) });
          if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid preview dimensions");
          canvas.width = Math.max(1, Math.min(WIDTH * 2, Math.floor(viewport.width * 2)));
          canvas.height = Math.max(1, Math.min(HEIGHT * 2, Math.floor(viewport.height * 2)));
          canvas.style.width = `${String(canvas.width / 2)}px`; canvas.style.height = `${String(canvas.height / 2)}px`;
          const context = this.context(canvas);
          if (context === null || context === undefined) throw new Error("Canvas rendering unavailable");
          const task = page.render({ canvasContext: context, viewport, transform: [2, 0, 0, 2, 0, 0] });
          this.task = task;
          await task.promise;
          if (generation === this.generation) state.textContent = "";
        } catch (error) {
          if (generation === this.generation) {
            canvas.width = canvas.height = 0;
            state.textContent = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}. Page navigation is still available.`;
          }
        } finally {
          this.task = undefined;
          // The viewer decides whether a shared page is still resident. Release
          // off-window operator data only after the thumbnail task has drained.
          if (page !== undefined) this.releasePage(number, page);
        }
      }
    });
  }
}
