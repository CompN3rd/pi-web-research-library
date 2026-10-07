import assert from "node:assert/strict";

// Actual PDF.js worker, canvas, text layer and browser geometry; synthetic PDF only.
export async function smokeReader({ browser, url, errors }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2 });
  page.on("pageerror", error => errors.push(String(error)));
  try {
    await page.goto(url);
    await page.waitForFunction(() => customElements.get("pi-web-research-library-pdf-viewer"));
    await page.evaluate(() => {
      const reader = document.createElement("pi-web-research-library-pdf-viewer");
      document.body.replaceChildren(reader);
      reader.sourceUrl = new URL("reader-fixture.pdf", location.href).href;
    });
    const reader = page.locator("pi-web-research-library-pdf-viewer");
    const ready = () => reader.locator('[data-status][data-state="ready"]').waitFor();
    await ready();
    await reader.locator("[data-active-page=true] .textLayer span").first().waitFor({ state: "attached" });
    const fitWidth = async () => {
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        const view = root.querySelector(".viewport"), canvas = root.querySelector("[data-active-page=true] canvas");
        return Math.abs(canvas.getBoundingClientRect().width - (view.clientWidth - 40)) < 2 && view.scrollWidth <= view.clientWidth + 1;
      });
    };
    await fitWidth();
    const geometry = await reader.evaluate(element => {
      const root = element.shadowRoot, canvas = root.querySelector("[data-active-page=true] canvas"), span = root.querySelector("[data-active-page=true] .textLayer span");
      const page = canvas.getBoundingClientRect(), text = span.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(span);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const selected = selection.toString(); selection.removeAllRanges();
      return { left: (text.left - page.left) / page.width, top: (text.top - page.top) / page.height, selected, pixels: canvas.width * canvas.height };
    });
    assert(Math.abs(geometry.left - 48 / 600) < .01, "Text selection aligns horizontally with PDF glyphs");
    assert(geometry.top > .04 && geometry.top < .09, "Text selection aligns vertically with PDF glyphs");
    assert.equal(geometry.selected, "Reading fixture - page 1");
    assert(geometry.pixels <= 16_000_000);
    await reader.getByRole("button", { name: "Find", exact: true }).click();
    await reader.getByRole("searchbox", { name: "Find in PDF", exact: true }).fill("unique needle");
    await reader.getByRole("searchbox", { name: "Find in PDF", exact: true }).press("Enter");
    await reader.getByText("1 of 1 matches · Page 2", { exact: true }).waitFor();
    await ready(); await reader.locator("mark[data-current]").waitFor();
    assert.equal(await reader.locator("mark[data-current]").textContent(), "Unique needle");
    const visibleMatch = await reader.evaluate(element => {
      const root = element.shadowRoot, view = root.querySelector(".viewport").getBoundingClientRect(), mark = root.querySelector("mark[data-current]").getBoundingClientRect();
      return mark.top >= view.top && mark.bottom <= view.bottom;
    });
    assert(visibleMatch, "Search brings the matching passage into view");
    await reader.getByRole("button", { name: "Close PDF search", exact: true }).click();
    await reader.getByRole("button", { name: "Reading focus", exact: true }).click();
    assert(await reader.locator("dialog").evaluate(dialog => dialog.matches(":modal")));
    await fitWidth(); await ready();
    await page.screenshot({ path: ".smoke/reader-focus.png" });
    await page.keyboard.press("Escape");
    assert.equal(await reader.locator("dialog").evaluate(dialog => dialog.matches(":modal")), false);
    assert.equal(await reader.getByRole("button", { name: "Reading focus", exact: true }).evaluate(button => button.getRootNode().activeElement === button), true);
    await reader.getByRole("combobox", { name: "PDF zoom", exact: true }).selectOption("page");
    await ready();
    await page.waitForFunction(() => {
      const root = document.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
      const view = root.querySelector(".viewport"), canvas = root.querySelector("[data-active-page=true] canvas").getBoundingClientRect();
      return canvas.height <= view.clientHeight - 39 && canvas.width <= view.clientWidth - 39;
    });
    const viewport = reader.locator(".viewport");
    await viewport.focus(); await page.keyboard.press("ArrowRight");
    await reader.getByText(/Page 3 of 3 ·/).waitFor();
    await page.keyboard.press("Home"); await reader.getByText(/Page 1 of 3 ·/).waitFor();
    await page.keyboard.press("Space"); await reader.getByText(/Page 2 of 3 ·/).waitFor();
    // Stress cancellation with successive real PDF.js zoom renders, not fake tasks.
    await reader.getByRole("combobox", { name: "PDF zoom", exact: true }).selectOption("3");
    await reader.getByRole("combobox", { name: "PDF zoom", exact: true }).selectOption("1");
    await reader.getByRole("combobox", { name: "PDF zoom", exact: true }).selectOption("width");
    await ready(); await fitWidth();
    await reader.getByLabel("More reader options", { exact: true }).click();
    await reader.getByRole("combobox", { name: "Page tone", exact: true }).selectOption("warm");
    assert.equal(await reader.locator("dialog").getAttribute("data-tone"), "warm");
    await page.keyboard.press("Escape");
    await page.screenshot({ path: ".smoke/reader-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(); await fitWidth();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Narrow layout has no document-level horizontal overflow");
    const before = await reader.getByLabel("PDF page number", { exact: true }).inputValue();
    await reader.getByRole("button", { name: "Reading focus", exact: true }).click(); await fitWidth();
    assert.equal(await reader.getByLabel("PDF page number", { exact: true }).inputValue(), before);
    await page.screenshot({ path: ".smoke/reader-mobile.png" });
    await reader.evaluate(element => { element.addEventListener("research-pdf-region-selected", event => { element.dataset.selection = JSON.stringify(event.detail); }, { once: true }); });
    // Continuous scrolling preserves the in-page offset through focus/fit changes.
    // Explicitly jump to this page top before marking its heading.
    await reader.getByLabel("PDF page number", { exact: true }).fill("2");
    await reader.getByLabel("PDF page number", { exact: true }).press("Enter");
    await reader.getByLabel("PDF page number", { exact: true }).press("Tab");
    await page.waitForFunction(() => {
      const root = document.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
      return Math.abs(root.querySelector("[data-active-page=true] canvas").getBoundingClientRect().top - root.querySelector(".viewport").getBoundingClientRect().top - 20) < 2;
    });
    await reader.getByRole("button", { name: "Mark region", exact: true }).click();
    const canvasBox = await reader.locator("[data-active-page=true] canvas").boundingBox(); assert(canvasBox);
    await page.mouse.move(canvasBox.x + canvasBox.width * .05, canvasBox.y + canvasBox.height * .04);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * .8, canvasBox.y + canvasBox.height * .14, { steps: 20 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("pi-web-research-library-pdf-viewer").dataset.selection);
    const selection = JSON.parse(await reader.getAttribute("data-selection"));
    assert.equal(selection.page, 2); assert(selection.quote.includes("Reading fixture - page 2"));
    assert.equal(await reader.locator("dialog").evaluate(dialog => dialog.matches(":modal")), false, "Evidence selection leaves focus mode before opening the notebook");
    assert.equal(await reader.locator("[data-text-status]").textContent(), "");
    return ["multipage reading, page-fit and responsive width-fit at DPR 2", "real selectable text alignment/copy and highlighted document search", "native focus dialog, Escape/focus restoration and page keyboard navigation", "rapid zoom cancellation, warm page tone and 390px layout", "mobile focus-mode evidence selection and automatic focus exit"];
  } catch (error) {
    await page.screenshot({ path: ".smoke/reader-failure.png", fullPage: true }).catch(() => {});
    console.error("Reader smoke:", await page.locator("pi-web-research-library-pdf-viewer").evaluate(element => element.shadowRoot.querySelector("[data-status]").textContent).catch(() => "unavailable"));
    throw error;
  } finally { await page.close(); }
}
