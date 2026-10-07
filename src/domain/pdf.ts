/** Normalized page-relative rectangle in the unrotated page box. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bound automatic region capture; users can review/edit the captured quote. */
export const PDF_SELECTION_MAX_CHARACTERS = 4_000;

/** Clamp a drawn rectangle and round to stable four-decimal fractions. */
export function normalizedRect(rect: PdfRect): PdfRect {
  const left = clampFraction(Math.min(rect.x, rect.x + rect.width));
  const top = clampFraction(Math.min(rect.y, rect.y + rect.height));
  const right = clampFraction(Math.max(rect.x, rect.x + rect.width));
  const bottom = clampFraction(Math.max(rect.y, rect.y + rect.height));
  return { x: round4(left), y: round4(top), width: round4(Math.max(right - left, 0)), height: round4(Math.max(bottom - top, 0)) };
}
function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
function round4(value: number): number { return Math.round(value * 10_000) / 10_000; }
