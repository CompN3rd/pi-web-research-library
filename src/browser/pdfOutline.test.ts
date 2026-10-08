// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfOutline, outlineDestinationPage, PDF_OUTLINE_MAX_ITEMS, PDF_OUTLINE_MAX_DEPTH, type PdfOutlineDocument, type PdfOutlineItem } from "./pdfOutline.js";

afterEach(() => { document.body.replaceChildren(); });

function item(title: string, dest: unknown = [0, { name: "Fit" }], items: PdfOutlineItem[] = []): PdfOutlineItem { return { title, dest, items }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(items: PdfOutlineItem[] | null = [item("Chapter one")]) {
  const pdf = {
    numPages: 8,
    getOutline: vi.fn< PdfOutlineDocument["getOutline"] >().mockResolvedValue(items),
    getDestination: vi.fn< PdfOutlineDocument["getDestination"] >().mockResolvedValue([{ num: 12, gen: 0 }, { name: "XYZ" }, 0, 20, 2]),
    getPageIndex: vi.fn< PdfOutlineDocument["getPageIndex"] >().mockResolvedValue(5),
  };
  const panel = document.createElement("nav"), toggle = document.createElement("button"), navigate = vi.fn();
  document.body.append(toggle, panel);
  const outline = new PdfOutline(panel, toggle, navigate); outline.setDocument(pdf);
  const open = async () => { toggle.click(); await vi.waitFor(() => { expect(panel.textContent).not.toContain("Loading PDF outline"); }); };
  const button = (label: string) => {
    const result = [...panel.querySelectorAll("button")].find(button => button.textContent === label);
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  };
  return { pdf, panel, toggle, navigate, outline, open, button };
}

describe("outline destinations", () => {
  it("resolves explicit zero-based indexes, indirect references and named destinations via public APIs", async () => {
    const { pdf } = fixture();
    expect(await outlineDestinationPage(pdf, [2, { name: "Fit" }])).toBe(3);
    expect(await outlineDestinationPage(pdf, [{ num: 12, gen: 0 }, { name: "FitH" }, 42])).toBe(6);
    expect(await outlineDestinationPage(pdf, "chapter")).toBe(6);
    expect(pdf.getDestination).toHaveBeenCalledExactlyOnceWith("chapter");
    expect(pdf.getPageIndex).toHaveBeenCalledWith({ num: 12, gen: 0 });
  });

  it.each([null, [], [0], [-1, {}], [8, {}], [1.5, {}], [{ num: -1, gen: 0 }, {}], ["https://example.com", {}]])("rejects unsupported or out-of-range destinations: %j", async dest => {
    const { pdf } = fixture();
    await expect(outlineDestinationPage(pdf, dest)).rejects.toThrow(/Bookmark/);
  });

  it("reports missing names and invalid resolved references without clamping to another page", async () => {
    const { pdf } = fixture();
    pdf.getDestination.mockResolvedValue(null);
    await expect(outlineDestinationPage(pdf, "missing")).rejects.toThrow("no supported internal destination");
    pdf.getPageIndex.mockResolvedValue(8);
    await expect(outlineDestinationPage(pdf, [{ num: 1, gen: 0 }, {}])).rejects.toThrow("outside this PDF");
  });
});

describe("PDF outline panel", () => {
  it("loads lazily once per source and keeps hierarchy, literal titles and unsupported headings visible", async () => {
    const h = fixture([item("<b>Chapter</b>", null, [item("Child", "chapter")])]);
    expect(h.panel.hidden).toBe(true); expect(h.pdf.getOutline).not.toHaveBeenCalled();
    await h.open();
    expect(h.panel.querySelector("b")).toBeNull();
    expect(h.button("<b>Chapter</b> — no internal destination").disabled).toBe(true);
    expect(h.panel.querySelector("ol ol button")?.textContent).toBe("Child");
    h.button("Child").click(); await vi.waitFor(() => { expect(h.navigate).toHaveBeenCalledWith(6); });
    h.button("Close outline").click(); expect(h.panel.hidden).toBe(true); expect(document.activeElement).toBe(h.toggle);
    await h.open(); expect(h.pdf.getOutline).toHaveBeenCalledOnce();
    h.button("Child").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(h.panel.hidden).toBe(true); expect(h.toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows absent outlines and lets a failed load retry without impacting the reader", async () => {
    const h = fixture(null); await h.open(); expect(h.panel.textContent).toContain("has no outline");
    h.outline.setDocument(h.pdf); h.pdf.getOutline.mockRejectedValueOnce(new Error("broken outline"));
    await h.open(); expect(h.panel.textContent).toContain("Outline unavailable: broken outline");
    h.toggle.click(); await h.open(); expect(h.panel.textContent).toContain("has no outline");
  });

  it("caps rendered entries, nesting and titles with visible limits", async () => {
    const h = fixture(Array.from({ length: PDF_OUTLINE_MAX_ITEMS + 1 }, () => item("x".repeat(501))));
    await h.open(); expect(h.panel.querySelectorAll("li")).toHaveLength(PDF_OUTLINE_MAX_ITEMS);
    expect(h.panel.textContent).toContain("Outline display limited");
    expect(h.panel.querySelector("li button")?.textContent).toHaveLength(501);
    const tree = item("Deep"); tree.items.push(tree); // Exercise depth without recursion overflow.
    h.pdf.getOutline.mockResolvedValue([tree]); h.outline.setDocument(h.pdf); await h.open();
    expect(h.panel.querySelectorAll("li")).toHaveLength(PDF_OUTLINE_MAX_DEPTH);
    expect(h.panel.textContent).toContain("Outline display limited");
  });

  it("does not publish late outline data into a replacement document", async () => {
    const h = fixture(), pending = deferred<PdfOutlineItem[]>();
    h.pdf.getOutline.mockReturnValueOnce(pending.promise); h.toggle.click();
    const next = fixture([item("New source")]); h.outline.setDocument(next.pdf); await h.open();
    pending.resolve([item("Old source")]); await pending.promise;
    expect(h.panel.textContent).toContain("New source"); expect(h.panel.textContent).not.toContain("Old source");
  });

  it.each(["close", "source", "manual navigation"])("ignores a late destination after %s", async reason => {
    const h = fixture([item("Delayed", "chapter")]), pending = deferred<unknown>();
    h.pdf.getDestination.mockReturnValueOnce(pending.promise); await h.open(); h.button("Delayed").click();
    if (reason === "close") h.button("Close outline").click();
    else if (reason === "source") h.outline.setDocument(undefined);
    else h.outline.cancelNavigation();
    pending.resolve([4, { name: "Fit" }]); await pending.promise;
    await vi.waitFor(() => { expect(h.panel.hasAttribute("aria-busy")).toBe(false); });
    expect(h.navigate).not.toHaveBeenCalled();
    if (reason === "source") { expect(h.toggle.disabled).toBe(true); expect(h.panel.querySelectorAll("li")).toHaveLength(0); }
  });

  it("serializes destination work and reports failure locally, then permits another bookmark", async () => {
    const h = fixture([item("Missing", "missing"), item("Good", [2, {}])]), pending = deferred<unknown>();
    h.pdf.getDestination.mockReturnValueOnce(pending.promise); await h.open(); h.button("Missing").click(); h.button("Missing").click();
    expect(h.pdf.getDestination).toHaveBeenCalledOnce(); pending.resolve(null);
    await vi.waitFor(() => { expect(h.panel.textContent).toContain("Bookmark unavailable"); });
    expect(h.navigate).not.toHaveBeenCalled(); h.button("Good").click();
    await vi.waitFor(() => { expect(h.navigate).toHaveBeenCalledWith(3); });
  });
});
