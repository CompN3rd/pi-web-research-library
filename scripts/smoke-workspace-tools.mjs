import assert from "node:assert/strict";

// The same connected workbench and PDF survive every secondary workflow visit.
export async function smokeWorkspaceTools({ page, panel, reader, device }) {
  const activate = async locator => device.hasTouch ? locator.tap() : locator.click();
  const idle = async () => {
    await panel.locator('[aria-busy="false"]').waitFor();
    assert.equal((await panel.locator('[role="alert"]').textContent()).trim(), "");
  };
  const summary = panel.locator(".workspace-tools > summary");
  const tools = ["Reference", "Evidence", "Research", "Writing", "Import & export"];
  const selectTool = async name => {
    if (device.hasTouch) {
      await summary.tap();
      await panel.getByRole("button", { name, exact: true }).tap();
    } else {
      await summary.focus(); await page.keyboard.press("Enter");
      for (let i = 0; i <= tools.indexOf(name); i++) await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
    }
    await idle();
    assert.equal(await panel.locator(".workspace-tools").getAttribute("open"), null);
    assert(await summary.evaluate(element => element.getRootNode().activeElement === element), "Collapsed tools restore focus to their summary");
  };
  const retained = await reader.elementHandle();
  const pageNumber = await reader.getByLabel("PDF page number", { exact: true }).inputValue();
  const back = async () => {
    await activate(panel.getByRole("button", { name: "Reader", exact: true })); await idle();
    assert(await reader.isVisible());
    assert(await reader.evaluate((element, original) => element === original, retained));
    assert.equal(await reader.getByLabel("PDF page number", { exact: true }).inputValue(), pageNumber);
    for (const name of tools) assert.equal(await panel.getByRole("button", { name, exact: true }).isVisible(), false);
  };
  const title = panel.getByLabel("Title", { exact: true });
  try {
    await back();
    const target = await summary.boundingBox(); assert(target && target.height >= 44);
    await page.screenshot({ path: `.smoke/workspace-reader-${device.name}.png`, fullPage: true });
    await selectTool("Reference"); await title.fill("Pending secondary metadata"); await back();
    assert((await summary.textContent()).includes("Unsaved edits"));
    await selectTool("Evidence"); assert(await panel.getByRole("heading", { name: "Evidence notebook", exact: true }).isVisible()); await back();
    await selectTool("Research"); await panel.getByLabel("Research goal", { exact: true }).fill("Pending secondary goal"); await back();
    await selectTool("Writing"); await activate(panel.getByRole("button", { name: "New manuscript", exact: true }));
    await panel.getByLabel("Manuscript title", { exact: true }).fill("Pending secondary manuscript"); await back();
    await selectTool("Import & export"); await panel.getByLabel("Paste bibliography", { exact: true }).fill("Pending secondary import"); await back();
    await selectTool("Reference"); assert.equal(await title.inputValue(), "Pending secondary metadata");
    await activate(panel.getByRole("button", { name: "Discard metadata edits", exact: true })); await back();
    await selectTool("Research"); assert.equal(await panel.getByLabel("Research goal", { exact: true }).inputValue(), "Pending secondary goal");
    await panel.getByLabel("Research goal", { exact: true }).fill(""); await back();
    await selectTool("Writing"); assert.equal(await panel.getByLabel("Manuscript title", { exact: true }).inputValue(), "Pending secondary manuscript");
    await activate(panel.getByRole("button", { name: "Discard manuscript edits", exact: true })); await back();
    await selectTool("Import & export"); assert.equal(await panel.getByLabel("Paste bibliography", { exact: true }).inputValue(), "Pending secondary import");
    await panel.getByLabel("Paste bibliography", { exact: true }).fill(""); await back();
    assert.equal((await summary.textContent()).includes("Unsaved edits"), false);
    await activate(summary);
    await page.screenshot({ path: `.smoke/workspace-tools-${device.name}.png`, fullPage: true });
    const geometry = await panel.locator('nav[aria-label="Library workspace"]').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert(geometry.scroll <= geometry.width + 1, "Secondary tools wrap without horizontal navigation overflow");
    await back();
  } finally { await retained.dispose(); }
}
