import assert from "node:assert/strict";
import { disposeSmokeReader } from "./smoke-reader-annotations.mjs";

export async function smokeReaderTextComments({ browser, url, errors }) {
  const checks = [];
  for (const device of [
    { name: "mouse", viewport: { width: 1400, height: 1000 }, hasTouch: false },
    { name: "keyboard", viewport: { width: 1400, height: 1000 }, hasTouch: false },
    { name: "tablet-touch", viewport: { width: 768, height: 1024 }, hasTouch: true },
    { name: "narrow-touch", viewport: { width: 390, height: 844 }, hasTouch: true },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: device.hasTouch, deviceScaleFactor: 2 });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(String(error)));
    const panel = page.locator("pi-web-library-workbench");
    const reader = panel.locator("pi-web-research-library-pdf-viewer");
    const editor = panel.getByRole("complementary", { name: "Passage annotation", exact: true });
    const activate = async locator => {
      if (device.hasTouch) await locator.tap();
      else if (device.name === "keyboard") { await locator.focus(); await page.keyboard.press("Enter"); }
      else await locator.click();
    };
    const idle = async () => {
      await panel.locator('[aria-busy="false"]').waitFor();
      assert.equal((await panel.locator('[role="alert"]').textContent()).trim(), "");
    };
    const open = async () => {
      await page.goto(url); await idle();
      await activate(panel.getByRole("button", { name: "Native synthetic paper", exact: true })); await idle();
      await activate(panel.getByRole("button", { name: "Reader", exact: true }));
      await reader.locator(".textLayer span").first().waitFor({ state: "attached" });
      await reader.getByLabel("PDF zoom", { exact: true }).selectOption("page");
      await reader.locator('[data-status][data-state="ready"]').waitFor();
    };
    try {
      await open();
      await activate(reader.getByRole("button", { name: "Annotate text", exact: true }));
      if (device.name === "mouse") {
        const span = reader.locator(".textLayer span").first(); await span.scrollIntoViewIfNeeded();
        const box = await span.boundingBox(); assert(box);
        await page.mouse.move(box.x + 1, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 20 }); await page.mouse.up();
        assert.equal(await page.evaluate(() => window.getSelection().toString()), "Synthetic research paper");
        await activate(reader.getByRole("button", { name: "Annotate selection", exact: true }));
      } else {
        await activate(reader.locator("[data-passage-picker] > summary"));
        const start = reader.getByLabel("Passage start", { exact: true });
        const end = reader.getByLabel("Passage end", { exact: true });
        await reader.locator("[data-text-start]:enabled").waitFor();
        if (device.hasTouch) {
          // Real touch input opens the native control. Selecting its option uses
          // Playwright's native-select API (not physical OS picker automation).
          await start.tap(); await start.selectOption("0"); await page.keyboard.press("Escape");
          await end.tap(); await end.selectOption("0"); await page.keyboard.press("Escape");
        } else {
          await start.focus(); await page.keyboard.press("Home"); await page.keyboard.press("Tab");
          assert(await end.evaluate(element => element.getRootNode().activeElement === element));
          await page.keyboard.press("Home");
        }
        assert.equal(await reader.locator("[data-text-preview]").textContent(), "Synthetic research paper");
        await page.screenshot({ path: `.smoke/text-picker-${device.name}.png`, fullPage: true });
        await activate(reader.getByRole("button", { name: "Annotate passage", exact: true }));
      }
      await editor.waitFor();
      const note = editor.getByLabel("Evidence note / question", { exact: true });
      assert(await note.evaluate(element => element.getRootNode().activeElement === element));
      const body = `Text comment with ${device.name}`;
      assert.equal(await note.inputValue(), "");
      assert.equal(await note.getAttribute("required"), null);
      await activate(editor.getByRole("button", { name: "Save evidence", exact: true })); await idle();
      await editor.getByText("Saved", { exact: true }).waitFor();
      const saved = await page.evaluate(async () => (await window.researchPeer.request("evidence.list", { version: 1, payload: {} })).items.find(item => item.body === ""));
      assert(saved && saved.pdfSha256 && saved.page === 1 && saved.rect);
      assert.equal(saved.quote, "Synthetic research paper");
      assert.equal(saved.body, "");
      assert.equal(saved.kind, "quote");
      assert(Math.abs(saved.rect.x - .06) < .01 && saved.rect.y > .12 && saved.rect.y < .22, "Saved text anchor matches the source glyphs");
      assert(await reader.isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
      await page.screenshot({ path: `.smoke/text-comment-${device.name}.png`, fullPage: true });
      await activate(editor.getByRole("button", { name: "Close annotation", exact: true }));
      assert.equal(await reader.locator(`[data-annotation-id="${saved.id}"]`).getAttribute("data-kind"), "highlight");
      await page.screenshot({ path: `.smoke/text-highlight-${device.name}.png`, fullPage: true });
      await disposeSmokeReader(page, reader); await open();
      await activate(panel.locator(".reader-annotations > summary"));
      await activate(panel.getByRole("button", { name: `Page 1: ${saved.quote}`, exact: true })); await idle();
      assert.equal(await note.inputValue(), "");
      await note.fill(body);
      await activate(editor.getByRole("button", { name: "Save evidence", exact: true })); await idle();
      await activate(editor.getByRole("button", { name: "Close annotation", exact: true }));
      await activate(panel.locator(".reader-annotations > summary"));
      await activate(panel.getByRole("button", { name: `Page 1: ${body}`, exact: true })); await idle();
      assert.equal(await note.inputValue(), body);
      await note.fill(`${body}; edited`);
      await activate(editor.getByRole("button", { name: "Save evidence", exact: true })); await idle();
      const edited = await page.evaluate(async id => (await window.researchPeer.request("evidence.list", { version: 1, payload: {} })).items.find(item => item.id === id), saved.id);
      assert.equal(edited.revision, saved.revision + 2);
      assert.equal(edited.body, `${body}; edited`);
      for (const key of ["rect", "quote", "page", "documentId", "pdfSha256", "referenceId"]) assert.deepEqual(edited[key], saved[key]);
      await disposeSmokeReader(page, reader);
      checks.push(`${device.name} ${device.viewport.width}x${device.viewport.height} DPR 2: quote-only highlight save/reload/reopen; add comment, reopen and edit; exact quote and immutable source anchor`);
    } catch (error) {
      await page.screenshot({ path: `.smoke/text-comment-${device.name}-failure.png`, fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  return checks;
}
