export const MAX_PDF_RENDER_DIMENSION = 16_384;
export const MAX_PDF_RENDER_PIXELS = 16_000_000;

export function boundedOutputScale(width: number, height: number, desiredScale: number): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const pixelBound = Math.sqrt(MAX_PDF_RENDER_PIXELS / (safeWidth * safeHeight));
  const dimensionBound = Math.min(MAX_PDF_RENDER_DIMENSION / safeWidth, MAX_PDF_RENDER_DIMENSION / safeHeight);
  return Math.min(desiredScale, pixelBound, dimensionBound);
}
