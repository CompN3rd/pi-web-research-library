import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { syntheticReaderPdf } from "./synthetic-pdf.mjs";
import { disposeSmokeReader } from "./smoke-reader-annotations.mjs";

// Actual scroll input and page geometry through Library, not a detached viewer demo.
export async function smokeContinuousReader({ browser, url, errors, fixture }) {
  const bytes = syntheticReaderPdf(8, true, true);
  const path = join(fixture.root, "continuous.pdf"); await writeFile(path, bytes);
  const checks = [];
  for (const device of [
    { name: "desktop", viewport: { width: 1400, height: 1000 }, hasTouch: false },
    { name: "tablet-touch", viewport: { width: 768, height: 1024 }, hasTouch: true },
    { name: "narrow-touch", viewport: { width: 390, height: 844 }, hasTouch: true },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: device.hasTouch, deviceScaleFactor: 2 });
    const page = await context.newPage(); page.setDefaultTimeout(30_000); page.on("pageerror", error => errors.push(String(error)));
    const panel = page.locator("pi-web-library-workbench"), reader = panel.locator("pi-web-research-library-pdf-viewer");
    const activate = async locator => device.hasTouch ? locator.tap() : locator.click();
    const idle = async () => { await panel.locator('[aria-busy="false"]').waitFor(); assert.equal((await panel.locator('[role="alert"]').textContent()).trim(), ""); };
    const ready = async number => { await reader.getByText(new RegExp(`Page ${number} of 8 ·`)).waitFor(); await reader.locator(`[data-page="${number}"] .textLayer span`).first().waitFor(); };
    const jump = async number => {
      const field = reader.getByLabel("PDF page number", { exact: true });
      await field.fill(String(number)); await field.press("Enter"); await ready(number);
    };
    try {
      await page.goto(url); await idle();
      if (device.name === "desktop") {
        await activate(panel.getByRole("button", { name: "New reference", exact: true }));
        await panel.getByLabel("Title", { exact: true }).fill("Continuous synthetic paper");
        await panel.getByLabel("Citekey", { exact: true }).fill("Continuous2026");
        await activate(panel.getByRole("button", { name: "Save metadata", exact: true })); await idle();
        await activate(panel.getByRole("button", { name: "Reader", exact: true }));
        await activate(panel.getByText("Attach a PDF", { exact: true }));
        await panel.getByLabel("Contained workspace PDF path", { exact: true }).fill("continuous.pdf");
        await panel.getByLabel("Document label", { exact: true }).fill("Eight mixed-size pages");
        await panel.getByLabel("Rights / license", { exact: true }).fill("Authored synthetic fixture");
        await activate(panel.getByRole("button", { name: "Attach existing PDF", exact: true })); await idle();
        await activate(panel.getByRole("button", { name: "Eight mixed-size pages", exact: true }));
        await ready(1);
        await activate(panel.getByText("Documents & research tools", { exact: true }));
        await activate(panel.getByText("Verified full-text search", { exact: true }));
        await activate(panel.getByRole("button", { name: "Index current PDF", exact: true })); await idle();
        await activate(panel.getByText("Documents & research tools", { exact: true }));
      } else {
        await activate(panel.getByRole("button", { name: "Continuous synthetic paper", exact: true })); await idle();
        await activate(panel.getByRole("button", { name: "Reader", exact: true })); await ready(1);
      }
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("page"); await ready(1);
      await reader.locator(".viewport").scrollIntoViewIfNeeded();
      const view = await reader.locator(".viewport").boundingBox(); assert(view);
      const session = device.hasTouch ? await context.newCDPSession(page) : undefined;
      try {
        for (let gesture = 0; gesture < 8 && await reader.getByLabel("PDF page number", { exact: true }).inputValue() === "1"; gesture++) {
          if (session) {
            const start = { x: view.x + view.width * .7, y: view.y + view.height * .75 };
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
            for (let step = 1; step <= 10; step++) {
              await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x, y: start.y - view.height * .45 * step / 10 }] });
              await page.waitForTimeout(25); // Pace an emulated finger, not a zero-time fling.
            }
            await page.waitForTimeout(100);
            await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          } else {
            await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
            await page.mouse.wheel(0, view.height * .4);
          }
          await page.waitForTimeout(100); // Let compositor scrolling settle before inspecting geometry.
        }
      } finally { await session?.detach(); }
      await ready(2);
      assert(await reader.locator("canvas").count() <= 3);
      const continuity = await reader.evaluate(element => {
        const root = element.shadowRoot;
        const one = root.querySelector('[data-page="1"] canvas').getBoundingClientRect();
        const two = root.querySelector('[data-page="2"] canvas').getBoundingClientRect();
        return { gap: two.top - one.bottom, width: two.width, height: two.height };
      });
      assert(Math.abs(continuity.gap - 20) < 2, "Adjacent pages share a continuous scroll coordinate space");
      await page.screenshot({ path: `.smoke/continuous-${device.name}.png`, fullPage: true });
      // Natural mouse/touch scrolling, not only explicit jumps, is remembered
      // across a full browser-page reload through the real workbench boundary.
      await disposeSmokeReader(page, reader); await page.reload(); await idle();
      await activate(panel.getByRole("button", { name: "Continuous synthetic paper", exact: true })); await idle();
      await activate(panel.getByRole("button", { name: "Reader", exact: true })); await ready(2);
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-library-workbench").shadowRoot.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        const canvas = root.querySelector('[data-page="2"] canvas');
        return canvas && Math.abs(canvas.getBoundingClientRect().top - root.querySelector('.viewport').getBoundingClientRect().top - 20) < 2;
      });
      await page.screenshot({ path: `.smoke/remembered-page-${device.name}.png`, fullPage: true });
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("page"); await ready(2);
      await activate(reader.getByRole("button", { name: "Pages", exact: true }));
      const previews = reader.getByRole("navigation", { name: "PDF page previews", exact: true });
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-library-workbench").shadowRoot.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        return [...root.querySelectorAll('.thumbnail-list canvas')].filter(canvas => canvas.width > 0).length === 6
          && [...root.querySelectorAll('.thumbnail-state')].every(state => state.textContent === "");
      });
      assert.equal(await previews.locator("canvas").count(), 6);
      await page.screenshot({ path: `.smoke/thumbnails-${device.name}.png`, fullPage: true });
      const sixth = previews.getByRole("button", { name: "Go to PDF page 6", exact: true });
      if (device.hasTouch) await sixth.tap();
      else { await previews.getByRole("button", { name: "Go to PDF page 5", exact: true }).focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
      await ready(6);
      assert.equal(await sixth.getAttribute("aria-current"), "page");
      await activate(previews.getByRole("button", { name: "Next previews", exact: true }));
      await activate(previews.getByRole("button", { name: "Go to PDF page 8", exact: true })); await ready(8);
      assert.equal(await previews.locator("canvas").count(), 2);
      await activate(reader.getByRole("button", { name: "Reading focus", exact: true }));
      await activate(previews.getByRole("button", { name: "Previous previews", exact: true }));
      await activate(previews.getByRole("button", { name: "Go to PDF page 4", exact: true })); await ready(4);
      await activate(previews.getByRole("button", { name: "Close page previews", exact: true }));
      assert.equal(await previews.locator("canvas").count(), 0);
      await activate(reader.getByRole("button", { name: "Exit reading focus", exact: true }));
      await activate(reader.getByRole("button", { name: "Outline", exact: true }));
      const outline = reader.getByRole("navigation", { name: "PDF outline", exact: true });
      await outline.getByRole("button", { name: "Methods", exact: true }).waitFor();
      assert.equal(await outline.locator("ol ol button").textContent(), "Methods");
      assert(await outline.getByRole("button", { name: "External website — no internal destination", exact: true }).isDisabled());
      if (device.hasTouch) await outline.getByRole("button", { name: "Methods", exact: true }).tap();
      else { await outline.getByRole("button", { name: "Introduction", exact: true }).focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
      await ready(4);
      await activate(reader.getByRole("button", { name: "Reading focus", exact: true }));
      await activate(outline.getByRole("button", { name: "Results", exact: true })); await ready(8);
      assert.equal(await reader.getByLabel("PDF zoom", { exact: true }).inputValue(), "page", "Outline ignores bookmark zoom");
      await page.screenshot({ path: `.smoke/outline-${device.name}.png`, fullPage: true });
      if (device.hasTouch) await outline.getByRole("button", { name: "Close outline", exact: true }).tap();
      else await page.keyboard.press("Escape");
      assert.equal(await reader.getByRole("button", { name: "Outline", exact: true }).getAttribute("aria-expanded"), "false");
      assert(await reader.getByRole("button", { name: "Exit reading focus", exact: true }).isVisible(), "Closing outline does not exit Focus");
      await activate(reader.getByRole("button", { name: "Exit reading focus", exact: true }));
      await jump(8); assert(await reader.locator("canvas").count() <= 3);
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-library-workbench").shadowRoot.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        const canvas = root.querySelector('[data-page="8"] canvas');
        return root.querySelector('[data-page-number]').value === "8" && canvas && Math.abs(canvas.getBoundingClientRect().top - root.querySelector('.viewport').getBoundingClientRect().top - 20) < 2;
      });
      assert.equal(await reader.locator('[data-page="1"]').count(), 0, "Distant page DOM is evicted");
      await jump(4);
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-library-workbench").shadowRoot.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        const canvas = root.querySelector('[data-page="4"][data-active-page=true] canvas');
        const box = canvas?.getBoundingClientRect();
        return box && box.width > box.height && box.height > 0;
      });
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("1"); await ready(4);
      await reader.locator(".viewport").focus(); await page.keyboard.press("-");
      await reader.getByText(/Page 4 of 8 · 75%/).waitFor(); await page.keyboard.press("-");
      await reader.getByText(/Page 4 of 8 · 50%/).waitFor(); await jump(1);
      await activate(reader.getByRole("button", { name: "Reading focus", exact: true }));
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-library-workbench").shadowRoot.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        const pages = [...root.querySelectorAll("[data-page]")];
        const last = pages.at(-1).querySelector("canvas");
        return pages.length <= 6 && last.height > 0 && last.getBoundingClientRect().bottom >= root.querySelector(".viewport").getBoundingClientRect().bottom;
      });
      await page.screenshot({ path: `.smoke/continuous-low-zoom-${device.name}.png`, fullPage: true });
      await activate(reader.getByRole("button", { name: "Exit reading focus", exact: true }));
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("page");
      await jump(2);
      await activate(reader.getByRole("button", { name: "Annotate text", exact: true }));
      await activate(reader.locator("[data-passage-picker] > summary"));
      await reader.locator("[data-text-start]:enabled").waitFor();
      assert.equal(await reader.locator("[data-text-preview]").textContent(), "Reading fixture - page 2");
      await activate(reader.getByRole("button", { name: "Annotate passage", exact: true }));
      const editor = panel.getByRole("complementary", { name: "Passage annotation", exact: true });
      const note = editor.getByLabel("Evidence note / question", { exact: true });
      const body = `Continuous comment ${device.name}`;
      await note.fill(body);
      await activate(reader.getByRole("button", { name: "Pages", exact: true }));
      await activate(previews.getByRole("button", { name: "Go to PDF page 5", exact: true })); await ready(5);
      assert.equal(await note.inputValue(), body, "Thumbnail navigation preserves the open annotation draft");
      await activate(reader.getByRole("button", { name: "Outline", exact: true }));
      await activate(outline.getByRole("button", { name: "Results", exact: true })); await ready(8);
      assert.equal(await note.inputValue(), body, "Outline navigation preserves the open annotation draft");
      assert.equal(await previews.getByRole("button", { name: "Go to PDF page 8", exact: true }).getAttribute("aria-current"), "page");
      await activate(outline.getByRole("button", { name: "Close outline", exact: true }));
      await activate(previews.getByRole("button", { name: "Close page previews", exact: true }));
      await activate(editor.getByRole("button", { name: "Save evidence", exact: true })); await idle();
      const saved = await page.evaluate(async body => (await window.researchPeer.request("evidence.list", { version: 1, payload: {} })).items.find(item => item.body === body), body);
      assert(saved && saved.page === 2 && saved.pdfSha256 && saved.rect);
      assert.equal(saved.quote, "Reading fixture - page 2");
      assert(Math.abs(saved.rect.x - .08) < .01 && saved.rect.y > .04 && saved.rect.y < .09);
      await activate(editor.getByRole("button", { name: "Close annotation", exact: true }));
      await jump(7);
      await disposeSmokeReader(page, reader); await page.reload(); await idle();
      await activate(panel.getByRole("button", { name: "Continuous synthetic paper", exact: true })); await idle();
      await activate(panel.getByRole("button", { name: "Evidence", exact: true })); await idle();
      const card = panel.locator('section[aria-label="Evidence notebook"] .card').filter({ hasText: body });
      await activate(card.getByRole("button", { name: "Read quote on page 2", exact: true })); await idle(); await ready(2);
      // The first verified-ready callback must honor this explicit backlink,
      // even though page 7 was stored before reload.
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("page"); await ready(2);
      await activate(panel.locator(".reader-annotations > summary"));
      await activate(panel.getByRole("button", { name: `Page 2: ${body}`, exact: true })); await idle(); await ready(2);
      assert.equal(await note.inputValue(), body);
      await note.fill(`${body}; edited`); await activate(editor.getByRole("button", { name: "Save evidence", exact: true })); await idle();
      const edited = await page.evaluate(async id => (await window.researchPeer.request("evidence.list", { version: 1, payload: {} })).items.find(item => item.id === id), saved.id);
      for (const key of ["rect", "quote", "page", "documentId", "pdfSha256", "referenceId"]) assert.deepEqual(edited[key], saved[key]);
      await activate(editor.getByRole("button", { name: "Close annotation", exact: true }));
      await jump(4);
      await activate(reader.getByRole("button", { name: "Mark region", exact: true }));
      await page.keyboard.press("Enter"); // Existing keyboard region boundary on a mixed-size, non-first page.
      await editor.waitFor(); await note.fill(`Continuous region ${device.name}`);
      await activate(editor.getByRole("button", { name: "Save evidence", exact: true })); await idle();
      const region = await page.evaluate(async body => (await window.researchPeer.request("evidence.list", { version: 1, payload: {} })).items.find(item => item.body === body), `Continuous region ${device.name}`);
      assert(region && region.page === 4 && region.pdfSha256 === saved.pdfSha256);
      assert.deepEqual(region.rect, { x: .1, y: .1, width: .4, height: .1 });
      await disposeSmokeReader(page, reader);
      checks.push(`${device.name} ${device.viewport.width}x${device.viewport.height} DPR 2: actual ${device.hasTouch ? "CDP touch swipes" : "mouse wheel"} across pages; normal 3-canvas eviction and expanded visible window at 50% focus zoom (6-page cap); mixed-size jumps; lazy six-preview groups, desktop Tab/Enter and touch taps, active-page labels, focus navigation and close eviction; thumbnail and outline jumps preserve page-2 draft/anchor; nested named/explicit outline destinations via desktop Tab/Enter and touch taps, external actions disabled, Focus/Escape/close, thumbnail synchronization; page-2 text save/backlink/edit with immutable anchor; page-4 keyboard region save; naturally scrolled page 2 restored at page top after full reload; explicit page-2 evidence backlink beats remembered page 7 on initial verified ready`);
    } catch (error) {
      console.error("Continuous failure", device.name, error);
      await page.screenshot({ path: `.smoke/continuous-${device.name}-failure.png`, fullPage: true, timeout: 5_000 }).catch(() => {});
      console.error("Continuous reader:", await reader.locator("[data-status]").textContent().catch(() => "unavailable"));
      console.error("Continuous geometry:", await reader.evaluate(element => {
        const root = element.shadowRoot, view = root.querySelector(".viewport");
        return { scrollTop: view.scrollTop, height: view.clientHeight, total: view.scrollHeight, viewTop: view.getBoundingClientRect().top, pages: [...root.querySelectorAll('[data-page]')].map(page => ({ page: page.dataset.page, top: page.getBoundingClientRect().top, height: page.getBoundingClientRect().height })) };
      }).catch(() => "unavailable"));
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(await readFile(path), bytes, "Source PDF bytes stay unchanged");
  return checks;
}
