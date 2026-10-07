import assert from "node:assert/strict";

// Complete disconnect cleanup before navigation; abruptly closing a browser is
// intentionally only best-effort in production and snapshots otherwise expire.
export async function disposeSmokeReader(page, reader) {
  if (await reader.count() === 0) return;
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/peer") && response.request().postDataJSON()?.operation === "pdf.close"),
    reader.evaluate(element => element.remove()),
  ]);
}

// Real input and PDF geometry against the compiled workbench + isolated server
// adapter. Touch uses Chromium's input dispatch, not synthetic DOM PointerEvents.
export async function smokeReaderAnnotations({ browser, url, errors }) {
  const checks = [];
  for (const device of [
    { name: "keyboard", viewport: { width: 1400, height: 1000 }, hasTouch: false },
    { name: "tablet-touch", viewport: { width: 768, height: 1024 }, hasTouch: true },
    { name: "narrow-touch", viewport: { width: 390, height: 844 }, hasTouch: true },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: device.hasTouch, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    const panel = page.locator("pi-web-library-workbench");
    const reader = panel.locator("pi-web-research-library-pdf-viewer");
    const editor = panel.getByRole("complementary", { name: "Passage annotation", exact: true });
    const note = editor.getByLabel("Evidence note / question", { exact: true });
    const activate = async locator => device.hasTouch ? locator.tap() : locator.click();
    const idle = async () => {
      await panel.locator('[aria-busy="false"]').waitFor();
      assert.equal((await panel.locator('[role="alert"]').textContent()).trim(), "");
    };
    const ready = () => reader.locator('[data-status][data-state="ready"]').waitFor();
    const open = async () => {
      await page.goto(url); await idle();
      await activate(panel.getByRole("button", { name: "Native synthetic paper", exact: true })); await idle();
      await activate(panel.getByRole("button", { name: "Reader", exact: true })); await ready();
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("page");
      await page.waitForFunction(() => {
        const root = document.querySelector("pi-web-library-workbench").shadowRoot.querySelector("pi-web-research-library-pdf-viewer").shadowRoot;
        const view = root.querySelector(".viewport"), canvas = root.querySelector("canvas").getBoundingClientRect();
        return root.querySelector('[data-status]').dataset.state === "ready" && canvas.height <= view.clientHeight - 39;
      });
    };
    try {
      await open();
      const mark = reader.getByRole("button", { name: "Mark region", exact: true });
      if (device.hasTouch) {
        await mark.tap();
        const box = await reader.locator("canvas").boundingBox(); assert(box);
        const session = await context.newCDPSession(page);
        try {
          const start = { x: box.x + box.width * .07, y: box.y + box.height * .04 };
          const end = { x: box.x + box.width * .75, y: box.y + box.height * .18 };
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
          for (let i = 1; i <= 10; i++) {
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * i / 10, y: start.y + (end.y - start.y) * i / 10 }] });
          }
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } finally { await session.detach(); }
      } else {
        await mark.focus(); await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
        await page.keyboard.press("Enter");
      }
      await editor.waitFor();
      assert(await note.evaluate(element => element.getRootNode().activeElement === element), "Annotation entry receives keyboard focus");
      const body = `Region created with ${device.name}`;
      if (device.hasTouch) { await note.tap(); await note.fill(body); }
      else await page.keyboard.type(body);
      const save = editor.getByRole("button", { name: "Save evidence", exact: true });
      if (device.hasTouch) await save.tap();
      else { await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
      await idle(); await editor.getByText("Saved", { exact: true }).waitFor();
      assert(await reader.isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal page overflow");
      const viewBox = await reader.locator(".viewport").boundingBox(), editBox = await editor.boundingBox();
      assert(viewBox && editBox);
      assert(Math.min(viewBox.y + viewBox.height, device.viewport.height) - Math.max(viewBox.y, 0) > 100, "PDF remains visibly available beside/above annotation entry");
      assert(Math.min(editBox.y + editBox.height, device.viewport.height) - Math.max(editBox.y, 0) > 100, "Annotation entry is visible with PDF");
      await page.screenshot({ path: `.smoke/reader-annotation-${device.name}.png`, fullPage: true });
      const saved = await page.evaluate(async body => {
        const result = await window.researchPeer.request("evidence.list", { version: 1, payload: {} });
        return result.items.find(item => item.body === body);
      }, body);
      assert(saved && saved.rect && saved.pdfSha256 && saved.page === 1);
      await activate(editor.getByRole("button", { name: "Close annotation", exact: true }));
      // Reopening after reload proves a durable annotation, not a retained draft.
      await disposeSmokeReader(page, reader);
      await open();
      const marker = reader.locator(`[data-annotation-id="${saved.id}"]`);
      if (device.hasTouch) {
        // The fixtures deliberately overlap. The chooser provides an unambiguous
        // touch target even when another saved rectangle covers this marker.
        await panel.locator(".reader-annotations > summary").tap();
        await panel.getByRole("button", { name: `Page 1: ${body}`, exact: true }).tap();
        await idle();
      } else { await marker.focus(); await page.keyboard.press("Enter"); }
      assert.equal(await note.inputValue(), body);
      await note.fill(`${body}; edited`);
      await activate(save); await idle();
      const edited = await page.evaluate(async id => (await window.researchPeer.request("evidence.list", { version: 1, payload: {} })).items.find(item => item.id === id), saved.id);
      assert.equal(edited.revision, saved.revision + 1);
      for (const key of ["rect", "quote", "page", "documentId", "pdfSha256", "referenceId"]) assert.deepEqual(edited[key], saved[key]);
      await disposeSmokeReader(page, reader);
      checks.push(`${device.name} ${device.viewport.width}x${device.viewport.height} DPR 2: region create/save/reload/reopen/edit with PDF visible and immutable anchor`);
    } catch (error) {
      await page.screenshot({ path: `.smoke/reader-annotation-${device.name}-failure.png`, fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  return checks;
}
