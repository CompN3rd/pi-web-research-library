import { fittedPdfScale, type PdfFitMode } from "./pdfReading.js";

export interface PdfPageSize { width: number; height: number }
const GAP = 20;
export const MAX_RESIDENT_PDF_PAGES = 6;

/** Sparse measured dimensions; unvisited pages use the first measured page's size.
 * No page DOM or PDF proxies are retained here. Offsets change only as sizes are learned. */
export class PdfContinuousLayout {
  private readonly measured = new Map<number, PdfPageSize>();
  private estimate: PdfPageSize = { width: 612, height: 792 };
  mode: PdfFitMode = "width";
  zoom = 1;
  viewport: PdfPageSize = { width: 0, height: 0 };

  constructor(readonly count: number) {}

  measure(page: number, size: PdfPageSize): void {
    if (this.measured.size === 0) this.estimate = size;
    this.measured.set(page, size);
  }

  scale(page: number): number {
    return this.mode === "custom" ? this.zoom : fittedPdfScale(this.mode, this.measured.get(page) ?? this.estimate, this.viewport);
  }

  size(page: number): PdfPageSize {
    const base = this.measured.get(page) ?? this.estimate;
    const scale = this.scale(page);
    return { width: Math.floor(base.width * scale), height: Math.floor(base.height * scale) };
  }

  top(page: number): number {
    const scale = this.mode === "custom" ? this.zoom : fittedPdfScale(this.mode, this.estimate, this.viewport);
    const estimateHeight = Math.floor(this.estimate.height * scale);
    let top = GAP + (page - 1) * (estimateHeight + GAP);
    for (const [number] of this.measured) if (number < page) top += this.size(number).height - estimateHeight;
    return top;
  }

  get height(): number { return this.top(this.count + 1); }

  pageAt(offset: number): number {
    let low = 1, high = this.count;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.top(middle) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  window(page: number, offset = this.top(page), height = 0): number[] {
    // Include visible pages at low zoom, not only the active page's neighbors.
    // The hard cap bounds pathological PDFs with many tiny pages in one viewport.
    const firstVisible = this.pageAt(offset);
    let first = Math.max(1, Math.min(page - 1, firstVisible));
    let last = Math.min(this.count, Math.max(page + 1, this.pageAt(offset + height)));
    if (last - first + 1 > MAX_RESIDENT_PDF_PAGES) {
      first = Math.max(firstVisible, page - MAX_RESIDENT_PDF_PAGES + 1);
      last = Math.min(this.count, first + MAX_RESIDENT_PDF_PAGES - 1);
    }
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }
}
