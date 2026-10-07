// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfThumbnails } from "./pdfThumbnails.js";
import type { PdfPage } from "./pdfViewerElement.js";

afterEach(() => { document.body.replaceChildren(); });

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing test fixture");
  return value;
}

function harness(count = 10) {
  const panel = document.createElement("nav"), toggle = document.createElement("button");
  panel.hidden = true; document.body.append(toggle, panel);
  const navigate = vi.fn(), release = vi.fn();
  const pages = Array.from({ length: count }, () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  }));
  const getPage = vi.fn((number: number): Promise<PdfPage> => Promise.resolve(required(pages[number - 1])));
  const previews = new PdfThumbnails(panel, toggle, () => ({}), navigate, release);
  previews.setDocument({ numPages: count, getPage });
  const button = (text: string): HTMLButtonElement => {
    const found = [...panel.querySelectorAll("button")].find(item => item.textContent === text);
    if (!found) throw new Error(`Missing button ${text}`);
    return found;
  };
  return { panel, toggle, previews, navigate, release, pages, getPage, button };
}

const tick = async (): Promise<void> => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

describe("lazy PDF page previews", () => {
  it("browses bounded groups, labels the active page and navigates without a second document", async () => {
    const h = harness(); expect(h.getPage).not.toHaveBeenCalled();
    h.toggle.click(); await tick();
    expect(h.panel.querySelectorAll("canvas")).toHaveLength(6);
    expect(h.getPage.mock.calls.map(call => call[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(h.panel.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe("Go to PDF page 1");
    for (const canvas of h.panel.querySelectorAll("canvas")) { expect(canvas.width).toBeLessThanOrEqual(192); expect(canvas.height).toBeLessThanOrEqual(224); }
    h.button("Next previews").click(); await tick();
    expect(h.panel.querySelectorAll("canvas")).toHaveLength(4);
    expect(h.button("Next previews").disabled).toBe(true);
    required(h.panel.querySelector<HTMLButtonElement>('[data-thumbnail-page="8"]')).click();
    expect(h.navigate).toHaveBeenCalledWith(8);
    h.previews.setCurrentPage(8);
    expect(h.panel.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe("Go to PDF page 8");
    h.previews.setCurrentPage(2); await tick();
    expect(h.panel.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe("Go to PDF page 2");
    const canvas = required(h.panel.querySelector("canvas"));
    h.panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await tick();
    expect(h.panel.hidden).toBe(true); expect(h.toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(h.toggle); expect(canvas.width).toBe(0);
    expect(h.panel.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("cancels and drains a render before a replacement batch can allocate bitmaps", async () => {
    const h = harness(); let reject!: (error: Error) => void;
    const promise = new Promise<void>((_, fail) => { reject = fail; });
    const cancel = vi.fn(); required(h.pages[0]).render.mockReturnValueOnce({ promise, cancel });
    h.toggle.click(); await tick();
    const old = required(h.panel.querySelector("canvas"));
    h.button("Next previews").click(); await tick();
    expect(cancel).toHaveBeenCalledOnce(); expect(h.getPage).toHaveBeenCalledTimes(1);
    expect([...h.panel.querySelectorAll("canvas")].every(canvas => canvas.width === 0)).toBe(true);
    reject(new Error("Cancelled")); await tick();
    expect(old.width).toBe(0); expect(h.getPage.mock.calls.map(call => call[0])).toEqual([1, 7, 8, 9, 10]);
    expect(h.release).toHaveBeenCalledWith(1, h.pages[0]);
  });

  it("ignores a late page after source reset and starts only the replacement source", async () => {
    const h = harness(); let resolve!: (page: PdfPage) => void;
    h.getPage.mockReturnValueOnce(new Promise<PdfPage>(done => { resolve = done; }));
    h.toggle.click(); await tick();
    h.previews.setDocument(undefined);
    expect(h.toggle.disabled).toBe(true); expect(h.panel.hidden).toBe(true);
    const replacement = harness(1);
    h.previews.setDocument({ numPages: 1, getPage: replacement.getPage }); h.toggle.click();
    resolve(required(h.pages[0])); await tick();
    expect(required(h.pages[0]).render).not.toHaveBeenCalled();
    expect(replacement.getPage).toHaveBeenCalledWith(1);
    expect(h.panel.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("reports preview failures while preserving page buttons and later previews", async () => {
    const h = harness(2); h.getPage.mockRejectedValueOnce(new Error("Broken preview"));
    h.toggle.click(); await tick();
    expect(h.panel.textContent).toContain("Preview unavailable: Broken preview");
    required(h.panel.querySelector<HTMLButtonElement>('[data-thumbnail-page="1"]')).click();
    expect(h.navigate).toHaveBeenCalledWith(1);
    expect(required(h.pages[1]).render).toHaveBeenCalledOnce();
    expect(required(h.panel.querySelectorAll("canvas")[1]).width).toBeGreaterThan(0);
  });
});
