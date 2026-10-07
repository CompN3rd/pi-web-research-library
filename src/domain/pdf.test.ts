import { describe, expect, it } from "vitest";
import { normalizedRect } from "./pdf.js";

describe("PDF region geometry", () => {
  it("normalizes reverse drags, clamps the page box and rounds stable fractions", () => {
    expect(normalizedRect({ x: 0.6, y: 0.8, width: -0.2, height: -0.3 })).toEqual({ x: 0.4, y: 0.5, width: 0.2, height: 0.3 });
    expect(normalizedRect({ x: -0.5, y: 0.5, width: 2, height: 2 })).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
    expect(normalizedRect({ x: 0.123_456, y: 0, width: 0.1, height: 0.1 }).x).toBe(0.1235);
  });
  it("never publishes nonfinite geometry", () => {
    expect(normalizedRect({ x: NaN, y: Infinity, width: -Infinity, height: NaN })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
