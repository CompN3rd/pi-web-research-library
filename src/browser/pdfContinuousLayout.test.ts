import { describe, expect, it } from "vitest";
import { PdfContinuousLayout } from "./pdfContinuousLayout.js";

describe("continuous PDF layout", () => {
  it("estimates unvisited pages, locates offsets and bounds the resident window", () => {
    const layout = new PdfContinuousLayout(10_000);
    layout.measure(1, { width: 600, height: 800 });
    expect(layout.top(5000)).toBe(20 + 4999 * 820);
    expect(layout.pageAt(layout.top(5000) + 100)).toBe(5000);
    expect(layout.pageAt(-100)).toBe(1);
    expect(layout.pageAt(layout.height)).toBe(10_000);
    expect(layout.window(1)).toEqual([1, 2]);
    expect(layout.window(5000)).toEqual([4999, 5000, 5001]);
    expect(layout.window(10_000)).toEqual([9999, 10_000]);
  });

  it("uses measured mixed sizes and never reorders pages when estimates change", () => {
    const layout = new PdfContinuousLayout(5);
    layout.measure(1, { width: 600, height: 800 });
    layout.measure(2, { width: 800, height: 600 });
    expect(layout.top(3)).toBe(1460);
    expect(layout.pageAt(1459)).toBe(2);
    expect(layout.pageAt(1460)).toBe(3);
    layout.measure(4, { width: 600, height: 1200 });
    expect(layout.top(5)).toBe(3500);
    layout.mode = "custom"; layout.zoom = 2;
    expect(layout.top(3)).toBe(2860);
    expect(layout.size(2)).toEqual({ width: 1600, height: 1200 });
  });

  it("includes more than two visible pages at low zoom while bounding tiny-page windows", () => {
    const layout = new PdfContinuousLayout(100);
    layout.mode = "custom"; layout.zoom = .5;
    layout.measure(1, { width: 600, height: 800 });
    expect(layout.window(1, 0, 1100)).toEqual([1, 2, 3]);
    expect(layout.window(4, layout.top(4) + 100, 1100)).toEqual([3, 4, 5, 6]);
    layout.measure(1, { width: 1, height: 1 });
    const tiny = new PdfContinuousLayout(100);
    tiny.measure(1, { width: 1, height: 1 });
    expect(tiny.window(10, tiny.top(10), 1100)).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("fits each page to the same available width or whole-page box", () => {
    const layout = new PdfContinuousLayout(3);
    layout.measure(1, { width: 600, height: 800 });
    layout.measure(2, { width: 800, height: 600 });
    layout.viewport = { width: 640, height: 440 };
    expect(layout.size(1)).toEqual({ width: 600, height: 800 });
    expect(layout.size(2)).toEqual({ width: 600, height: 450 });
    layout.mode = "page";
    expect(layout.size(1)).toEqual({ width: 300, height: 400 });
    expect(layout.size(2)).toEqual({ width: 533, height: 400 });
  });
});
