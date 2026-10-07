// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedTextRange, textSelectionAnchor } from "./pdfTextSelection.js";

afterEach(() => { vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

describe("selected PDF text anchors", () => {
  const page = { left: 100, top: 50, right: 500, bottom: 850 };
  it("preserves the exact quote and normalizes a multi-line bounding rectangle", () => {
    expect(textSelectionAnchor("First line\nSecond line", [
      { left: 140, top: 130, right: 300, bottom: 146 },
      { left: 140, top: 150, right: 260, bottom: 170 },
    ], page)).toEqual({ quote: "First line\nSecond line", rect: { x: .1, y: .1, width: .4, height: .05 } });
  });
  it("clips geometry to the page, not the quote", () => {
    expect(textSelectionAnchor(" exact ", [{ left: 90, top: 40, right: 510, bottom: 860 }], page)).toEqual({ quote: " exact ", rect: { x: 0, y: 0, width: 1, height: 1 } });
  });
  it("rejects empty, oversized or unpositioned selections rather than fabricating anchors", () => {
    expect(() => textSelectionAnchor(" ", [page], page)).toThrow("Select text");
    expect(() => textSelectionAnchor("x".repeat(16_001), [page], page)).toThrow("never truncated");
    expect(() => textSelectionAnchor("quote", [], page)).toThrow("no page geometry");
    expect(() => textSelectionAnchor("quote", [{ left: 0, top: 0, right: 10, bottom: 10 }], page)).toThrow("outside");
  });
  it("accepts only a range wholly inside this viewer's current text layer", () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const container = document.createElement("div"); container.textContent = "A selected passage"; root.append(container);
    const node = container.firstChild; if (node === null) throw new Error("Missing text fixture");
    const range = document.createRange(); range.setStart(node, 2); range.setEnd(node, 10);
    const selection = window.getSelection(); selection?.addRange(range);
    expect(selectedTextRange(root, container)?.toString()).toBe("selected");
    // Real Chromium mouse selections in nested shadow DOM report isCollapsed
    // on the rescoped document selection, not on their composed range.
    if (selection === null) throw new Error("Missing browser selection");
    const original = Object.getOwnPropertyDescriptor(selection, "getComposedRanges");
    Object.defineProperty(selection, "getComposedRanges", { configurable: true, value: () => [range] });
    const collapsed = vi.spyOn(selection, "isCollapsed", "get").mockReturnValue(true);
    try { expect(selectedTextRange(root, container)?.toString()).toBe("selected"); }
    finally {
      collapsed.mockRestore();
      if (original === undefined) Reflect.deleteProperty(selection, "getComposedRanges");
      else Object.defineProperty(selection, "getComposedRanges", original);
    }
    const outside = document.createElement("p"); outside.textContent = "Not PDF text"; document.body.append(outside);
    const external = document.createRange(); external.selectNodeContents(outside);
    selection.removeAllRanges(); selection.addRange(external);
    expect(selectedTextRange(root, container)).toBeUndefined();
    selection.collapse(outside, 0);
    expect(selectedTextRange(root, container)).toBeUndefined();
  });
});
