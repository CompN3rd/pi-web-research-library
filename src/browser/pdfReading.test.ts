import { describe, expect, it } from "vitest";
import { findPdfText, fittedPdfScale, matchInTextRun, pdfTextStrings } from "./pdfReading.js";

describe("PDF reading geometry and search", () => {
  it("fits width or the whole page without using device pixel ratio", () => {
    expect(fittedPdfScale("width", { width: 600, height: 800 }, { width: 940, height: 840 })).toBe(1.5);
    expect(fittedPdfScale("page", { width: 600, height: 800 }, { width: 940, height: 840 })).toBe(1);
    expect(fittedPdfScale("width", { width: 600, height: 800 }, { width: 0, height: 0 })).toBe(1);
    expect(fittedPdfScale("width", { width: 600, height: 800 }, { width: 9000, height: 9000 })).toBe(3);
  });
  it("finds literal phrases across runs, case-insensitively, retaining original offsets", () => {
    const strings = pdfTextStrings([{ str: "A [claim]." }, {}, { str: "Next line" }]);
    expect(strings).toEqual(["A [claim].", "Next line"]);
    expect(findPdfText(strings, "[CLAIM]. next", 10)).toEqual([{ start: 2, end: 15 }]);
    expect(findPdfText(["İ and claim"], "claim", 10)).toEqual([{ start: 6, end: 11 }]);
    expect(findPdfText(["a a a"], "a", 2)).toHaveLength(2);
    expect(findPdfText(["text"], "  ", 10)).toEqual([]);
  });
  it("projects cross-run matches onto positioned spans without changing text", () => {
    expect(matchInTextRun({ start: 2, end: 15 }, 0, 10)).toEqual({ start: 2, end: 10 });
    expect(matchInTextRun({ start: 2, end: 15 }, 11, 9)).toEqual({ start: 0, end: 4 });
    expect(matchInTextRun({ start: 2, end: 15 }, 21, 9)).toBeNull();
  });
});
