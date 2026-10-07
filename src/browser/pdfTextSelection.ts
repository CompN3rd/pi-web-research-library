import type { PdfRect } from "../domain/pdf.js";

export interface TextSelectionAnchor { rect: PdfRect; quote: string }
export interface TextBox { left: number; top: number; right: number; bottom: number }

/** The current evidence contract stores one page-space bounding rectangle. */
export function textSelectionAnchor(quote: string, boxes: readonly TextBox[], page: TextBox): TextSelectionAnchor {
  if (quote.trim() === "") throw new Error("Select text on this PDF page first.");
  if (quote.length > 16_000) throw new Error("Select a shorter passage (at most 16,000 characters). Quotes are never truncated.");
  const width = page.right - page.left, height = page.bottom - page.top;
  const visible = boxes.filter(box => box.right > box.left && box.bottom > box.top);
  if (width <= 0 || height <= 0 || visible.length === 0) throw new Error("The selected text has no page geometry. Select another passage or mark a region.");
  const left = Math.max(page.left, Math.min(...visible.map(box => box.left)));
  const top = Math.max(page.top, Math.min(...visible.map(box => box.top)));
  const right = Math.min(page.right, Math.max(...visible.map(box => box.right)));
  const bottom = Math.min(page.bottom, Math.max(...visible.map(box => box.bottom)));
  if (![left, top, right, bottom, width, height].every(Number.isFinite) || right <= left || bottom <= top) throw new Error("The selected text is outside this PDF page.");
  return { quote, rect: { x: (left - page.left) / width, y: (top - page.top) / height, width: (right - left) / width, height: (bottom - top) / height } };
}

/** Shadow-aware selection; reject selections outside this page rather than re-scope them. */
export function selectedTextRange(root: ShadowRoot, container: HTMLElement): Range | undefined {
  const selection = window.getSelection();
  if (selection === null) return undefined;
  // Chromium may expose isCollapsed=true for a real mouse selection inside a
  // shadow tree. Judge the composed range, not the document-rescoped selection.
  const composed: { getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[] } = selection;
  const ranges = composed.getComposedRanges?.({ shadowRoots: [root] });
  const selected = ranges === undefined ? (selection.rangeCount === 1 ? selection.getRangeAt(0) : undefined) : (ranges.length === 1 ? ranges[0] : undefined);
  if (selected === undefined || !container.contains(selected.startContainer) || !container.contains(selected.endContainer)) return undefined;
  const range = document.createRange();
  range.setStart(selected.startContainer, selected.startOffset);
  range.setEnd(selected.endContainer, selected.endOffset);
  return range.collapsed ? undefined : range;
}
