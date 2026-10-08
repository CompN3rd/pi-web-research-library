import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  items: PdfOutlineItem[];
}

/** Public PDF.js metadata only; no page render, external action or second reader. */
export interface PdfOutlineDocument extends Pick<PDFDocumentProxy, "numPages" | "getPageIndex"> {
  getOutline(): Promise<PdfOutlineItem[] | null>;
  getDestination(id: string): Promise<unknown>;
}

export const PDF_OUTLINE_MAX_ITEMS = 500;
export const PDF_OUTLINE_MAX_DEPTH = 16;
const MAX_TITLE = 500;
interface OutlineEntry { title: string; dest: unknown; children: OutlineEntry[] }

function boundedOutline(items: PdfOutlineItem[]): { entries: OutlineEntry[]; limited: boolean } {
  let count = 0, limited = false;
  const visit = (nodes: PdfOutlineItem[], depth: number): OutlineEntry[] => {
    const entries: OutlineEntry[] = [];
    for (const node of nodes) {
      if (count >= PDF_OUTLINE_MAX_ITEMS || depth > PDF_OUTLINE_MAX_DEPTH) { limited = true; break; }
      count++;
      const title = node.title.trim() || "Untitled bookmark";
      if (title.length > MAX_TITLE) limited = true;
      entries.push({ title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE)}…` : title, dest: node.dest, children: visit(node.items, depth + 1) });
    }
    return entries;
  };
  const entries = visit(items, 1);
  return { entries, limited };
}

/** Resolve only an internal page. PDF bookmark coordinates/zoom are deliberately ignored. */
export async function outlineDestinationPage(pdf: PdfOutlineDocument, destination: unknown): Promise<number> {
  const dest: unknown = typeof destination === "string" ? await pdf.getDestination(destination) : destination;
  if (!Array.isArray(dest) || dest.length < 2) throw new Error("Bookmark has no supported internal destination");
  const target: unknown = dest[0];
  let index: number;
  if (typeof target === "number") index = target;
  else if (typeof target === "object" && target !== null && "num" in target && "gen" in target
    && typeof target.num === "number" && Number.isSafeInteger(target.num) && target.num > 0
    && typeof target.gen === "number" && Number.isSafeInteger(target.gen) && target.gen >= 0) {
    index = await pdf.getPageIndex({ num: target.num, gen: target.gen });
  } else throw new Error("Bookmark has no supported page reference");
  if (!Number.isSafeInteger(index) || index < 0 || index >= pdf.numPages) throw new Error("Bookmark page is outside this PDF");
  return index + 1;
}

/** Source-scoped, lazy outline with a bounded DOM and at most one pending destination. */
export class PdfOutline {
  private pdf: PdfOutlineDocument | undefined;
  private generation = 0;
  private navigation = 0;
  private resolving = false;
  private loading = false;
  private loaded = false;
  private readonly list = document.createElement("ol");
  private readonly status = document.createElement("p");

  constructor(private readonly panel: HTMLElement, private readonly toggle: HTMLButtonElement, private readonly navigate: (page: number) => void) {
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Close outline";
    close.addEventListener("click", () => { this.setOpen(false); this.toggle.focus(); });
    this.status.setAttribute("role", "status");
    this.panel.append(close, this.status, this.list);
    this.toggle.addEventListener("click", () => { this.setOpen(this.panel.hidden === true); });
    this.panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.setOpen(false); this.toggle.focus(); }
    });
  }

  setDocument(pdf: PdfOutlineDocument | undefined): void {
    this.generation++;
    this.setOpen(false);
    this.pdf = pdf;
    this.loading = this.loaded = this.resolving = false;
    this.list.replaceChildren(); this.status.textContent = "";
    this.panel.removeAttribute("aria-busy");
    this.toggle.disabled = pdf === undefined;
  }

  /** A manual page jump/scroll supersedes any pending bookmark resolution. */
  cancelNavigation(): void { this.navigation++; }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (!open) this.cancelNavigation();
    else if (!this.loaded && !this.loading) void this.load();
  }

  private async load(): Promise<void> {
    const pdf = this.pdf, generation = this.generation;
    if (pdf === undefined) return;
    this.loading = true;
    this.status.textContent = "Loading PDF outline…";
    try {
      const result = await pdf.getOutline();
      if (generation !== this.generation) return;
      const { entries, limited } = boundedOutline(result ?? []);
      const append = (entries: OutlineEntry[], list: HTMLOListElement): void => {
        for (const entry of entries) {
          const item = document.createElement("li"), button = document.createElement("button");
          button.type = "button"; button.textContent = entry.title;
          button.disabled = !(typeof entry.dest === "string" || Array.isArray(entry.dest));
          if (button.disabled) { button.textContent += " — no internal destination"; }
          button.addEventListener("click", () => { void this.jump(entry.dest, entry.title); });
          item.append(button);
          if (entry.children.length > 0) { const children = document.createElement("ol"); append(entry.children, children); item.append(children); }
          list.append(item);
        }
      };
      append(entries, this.list);
      this.loaded = true;
      this.status.textContent = entries.length === 0 ? "This PDF has no outline." : `Bookmarks jump to page tops; PDF zoom and coordinates are not applied. External actions are unavailable.${limited ? " Outline display limited to 500 entries, 16 levels and 500 characters per title." : ""}`;
    } catch (error) {
      if (generation === this.generation) this.status.textContent = `Outline unavailable: ${errorMessage(error)}. Close and reopen to retry.`;
    } finally { if (generation === this.generation) this.loading = false; }
  }

  private async jump(dest: unknown, title: string): Promise<void> {
    const pdf = this.pdf, generation = this.generation;
    if (pdf === undefined || this.resolving || this.panel.hidden === true) return;
    const navigation = ++this.navigation;
    this.resolving = true;
    this.panel.setAttribute("aria-busy", "true");
    this.status.textContent = `Finding bookmark: ${title}…`;
    try {
      const page = await outlineDestinationPage(pdf, dest);
      if (generation !== this.generation || navigation !== this.navigation) return;
      this.status.textContent = `${title} — page ${String(page)}`;
      this.navigate(page);
    } catch (error) {
      if (generation === this.generation && navigation === this.navigation) this.status.textContent = `Bookmark unavailable: ${errorMessage(error)}. Use Pages or the page number instead.`;
    } finally {
      if (generation === this.generation) {
        this.resolving = false;
        this.panel.removeAttribute("aria-busy");
        if (navigation !== this.navigation && this.status.textContent.startsWith("Finding bookmark:")) this.status.textContent = "Bookmark navigation cancelled. Choose a bookmark to navigate.";
      }
    }
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
