import type { PdfTextContentItem } from "./pdfQuote.js";

export type PdfFitMode = "width" | "page" | "custom";
export interface PdfTextMatch { start: number; end: number }
export interface PdfFindHit extends PdfTextMatch { page: number }
export const PDF_FIND_MAX_PAGES = 500;
export const PDF_FIND_MAX_HITS = 1000;
export const PDF_FIND_MAX_PAGE_CHARACTERS = 1_000_000;

/** Fit uses CSS pixels, independent of the bounded canvas device-pixel ratio. */
export function fittedPdfScale(mode: Exclude<PdfFitMode, "custom">, page: { width: number; height: number }, available: { width: number; height: number }): number {
  if (available.width <= 0 || available.height <= 0) return 1;
  const width = Math.max(1, available.width - 40) / page.width;
  const height = Math.max(1, available.height - 40) / page.height;
  return Math.max(0.1, Math.min(3, mode === "width" ? width : Math.min(width, height)));
}

export function pdfTextStrings(items: readonly PdfTextContentItem[]): string[] {
  return items.flatMap(item => typeof item.str === "string" ? [item.str] : []);
}

/** Offsets refer to original UTF-16 text, also used by the selectable text layer. */
export function findPdfText(strings: readonly string[], query: string, limit: number): PdfTextMatch[] {
  if (query.trim() === "" || limit <= 0) return [];
  const pattern = query.trim().split(/\s+/u).map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s+");
  const expression = new RegExp(pattern, "giu");
  const text = strings.join(" ");
  const matches: PdfTextMatch[] = [];
  for (const match of text.matchAll(expression)) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
}

/** Map a cross-run match to one text span without changing its PDF positioning. */
export function matchInTextRun(match: PdfTextMatch, offset: number, length: number): PdfTextMatch | null {
  const start = Math.max(0, match.start - offset);
  const end = Math.min(length, match.end - offset);
  return start < end ? { start, end } : null;
}
