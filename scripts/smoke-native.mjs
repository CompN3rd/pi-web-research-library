import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Drives compiled UI controls; peer calls below inspect public state, not private
// component fields. Only session execution/events are synthetic.
export async function smokeNative({ browser, url, fixture, host, errors }) {
  await mkdir(join(fixture.root, "drafts"));
  const originalDraft = "Original synthetic draft; preserve this backup.\n";
  await writeFile(join(fixture.root, "drafts/manuscript.md"), originalDraft);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", error => errors.push(String(error)));
  const panel = page.locator("pi-web-library-workbench");
  const idle = async () => { await panel.locator('[aria-busy="false"]').waitFor(); assert.equal((await panel.locator('[role="alert"]').textContent()).trim(), ""); };
  const click = async name => { await panel.getByRole("button", { name, exact: true }).click(); await idle(); };
  const field = name => panel.getByLabel(name, { exact: true });
  const peer = (operation, payload) => page.evaluate(({ operation, payload }) => window.researchPeer.request(operation, { version: 1, payload }), { operation, payload });
  try {
    await page.goto(url + "?panel=native"); await idle();
    await click("New reference");
    await field("Title").fill("Native synthetic paper"); await field("Citekey").fill("NativeSmoke2026");
    await field("Authors (one per line)").fill("Test, Author"); await field("Year").fill("2026");
    await field("Read state").selectOption("read"); await field("Screening decision").selectOption("included");
    await click("Save metadata");
    // A second tab holds a stale native reference, not a legacy annotation.
    const second = await browser.newPage(); second.on("pageerror", error => errors.push(String(error)));
    try {
      await second.goto(url); const other = second.locator("pi-web-library-workbench");
      await other.getByRole("button", { name: "Native synthetic paper", exact: true }).click();
      await other.getByLabel("Title", { exact: true }).waitFor();
      await field("Private notes").fill("First tab saved notes"); await click("Save metadata");
      await other.getByLabel("Private notes", { exact: true }).fill("Stale second tab notes");
      await other.getByRole("button", { name: "Save metadata", exact: true }).click();
      await other.getByRole("alert").filter({ hasText: /revision|changed/i }).waitFor();
      assert.equal((await peer("library.list", {})).items[0].notes, "First tab saved notes");
    } finally { await second.close(); }
    await click("Reader"); await panel.getByText("Attach a PDF", { exact: true }).click();
    await field("Contained workspace PDF path").fill(fixture.source.path); await field("Document label").fill("Native synthetic PDF");
    await field("Rights / license").fill("Authored synthetic test fixture"); await click("Attach existing PDF");
    let reference = (await peer("library.list", {})).items[0]; assert.equal(reference.documents.length, 1);
    await click("Native synthetic PDF");
    const reader = panel.locator("pi-web-research-library-pdf-viewer");
    await reader.locator('[data-status][data-state="ready"]').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: ".smoke/library-reader.png", fullPage: true });
    await panel.getByText("Documents & research tools", { exact: true }).click();
    await panel.getByText("Verified full-text search", { exact: true }).click();
    await click("Index current PDF"); // Actual bundled unpdf worker, not injected text.
    await field("Search document text").fill("Synthetic research paper"); await click("Search text");
    const hits = await peer("library.text.search", { query: "Synthetic research paper", referenceIds: [reference.id] });
    assert.equal(hits.length, 1); assert.equal(hits[0].page, 1); assert.equal(hits[0].pdfSha256, reference.documents[0].sha256);
    await panel.getByText("Verified full-text search", { exact: true }).click();
    const canvas = reader.locator("canvas"); await canvas.scrollIntoViewIfNeeded();
    assert(await canvas.evaluate(element => { const data = element.getContext("2d").getImageData(0, 0, element.width, element.height).data; return data.some((v, i) => i % 4 !== 3 && v < 100); }));
    await reader.getByLabel("More reader options", { exact: true }).click();
    await reader.getByRole("button", { name: "Mark region", exact: true }).click();
    await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox(); assert(box);
    await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 140, { steps: 10 }); await page.mouse.up();
    await field("Evidence note / question").fill("Synthetic native evidence; inspect the quoted page.");
    assert((await field("Captured quote").inputValue()).includes("Synthetic research paper"));
    await click("Save evidence");
    const evidence = (await peer("evidence.list", { referenceId: reference.id })).items[0];
    assert.equal(evidence.documentId, reference.documents[0].id); assert.equal(evidence.pdfSha256, reference.documents[0].sha256);
    await page.reload(); await idle(); await click("Native synthetic paper"); await click("Evidence");
    await panel.getByText("Synthetic native evidence; inspect the quoted page.", { exact: true }).waitFor();
    await click("Read quote on page 1"); await reader.locator('[data-status][data-state="ready"]').waitFor();
    await reader.getByLabel("More reader options", { exact: true }).click();
    await reader.getByRole("button", { name: "Reload PDF", exact: true }).click();
    await reader.locator('[data-status][data-state="ready"]').waitFor();
    assert.equal(host.runs.length, 0, "Browsing, indexing and evidence must not start a session");
    const passage = await host.tool("research_library_native_read_passage", { referenceId: reference.id, documentId: reference.documents[0].id, page: 1 });
    assert(passage.details.text.includes("Synthetic research paper"));
    assert.equal(passage.details.pdfSha256, reference.documents[0].sha256);
    const catalog = await host.tool("research_library_native_catalog_search", { query: "Native synthetic" });
    assert.equal(catalog.details.items[0].id, reference.id);
    console.log("Native browser: catalog, actual PDF rendering/index and anchored evidence passed.");

    await click("Show library");
    await panel.getByRole("checkbox", { name: "Select Native synthetic paper", exact: true }).check(); await click("Research");
    assert.equal(await field("Task recipe").locator("option").count(), 8);
    await field("Research goal").fill("Summarize this synthetic paper and the saved evidence only.");
    await click("Preview model disclosure"); assert.equal(host.runs.length, 0);
    assert.equal(await panel.getByRole("button", { name: "Confirm and start model task", exact: true }).isDisabled(), true);
    await click("Cancel disclosure"); assert.equal(host.runs.length, 0);
    await click("Preview model disclosure"); await field("I consent to running this task with this disclosed corpus.").check();
    await click("Confirm and start model task"); assert.equal(host.runs.length, 1);
    const task = (await peer("tasks.list", {})).items[0];
    const result = { markdown: "# Synthetic draft\n\nThe source is a synthetic research paper [@NativeSmoke2026].", claims: [{ id: "smoke-claim", text: "Synthetic source text was checked against page one.", referenceIds: [reference.id], evidenceIds: [evidence.id], relationship: "context" }], cells: [{ referenceId: reference.id, column: "Fixture", value: "Synthetic PDF with verified text", evidenceIds: [evidence.id] }], warnings: ["Synthetic transport check, not an actual model/provider response."] };
    await host.submitResult({ taskId: task.id, corpusHash: task.corpusHash, result });
    await click("Refresh tasks");
    const completed = await peer("tasks.get", { id: task.id }); assert.equal(completed.status, "completed"); assert.equal(completed.review, "unreviewed");
    await panel.getByRole("cell", { name: "Synthetic PDF with verified text", exact: true }).waitFor();
    await click("Accept reviewed result");
    assert.equal((await peer("tasks.get", { id: task.id })).review, "accepted");
    assert.equal((await peer("evidence.list", { referenceId: reference.id })).items[0].status, "open", "Acceptance must not resolve evidence");
    console.log("Native browser: compiled companion publication, durable acknowledgment and human acceptance passed.");

    await click("Create manuscript from accepted result"); await field("Manuscript title").fill("Native smoke manuscript");
    await click("Save manuscript"); await click("Audit citations & evidence");
    const manuscript = (await peer("writing.list", {})).items[0];
    const audit = await peer("writing.audit", { id: manuscript.id }); assert.deepEqual(audit.citationKeys, ["NativeSmoke2026"]); assert(audit.bibliography.includes("Native synthetic paper"));
    const downloading = page.waitForEvent("download"); await click("Export html"); const exported = await downloading;
    assert.equal(await exported.failure(), null); const html = await readFile(await exported.path(), "utf8");
    assert(html.includes("Native synthetic paper")); assert(!html.includes("[@NativeSmoke2026]"), "HTML must render citations rather than echo tokens");
    const bundle = JSON.parse((await peer("writing.export", { id: manuscript.id, format: "bundle" })).text);
    assert(JSON.stringify(bundle).includes(evidence.id), "Portable bundle must retain evidence attribution");
    await field("Workspace target path").fill("drafts/manuscript.md"); await click("Preview file changes");
    assert.equal(await readFile(join(fixture.root, "drafts/manuscript.md"), "utf8"), originalDraft);
    assert.equal(await panel.getByRole("button", { name: "Confirm apply to file", exact: true }).isDisabled(), true);
    await click("Cancel file apply"); assert.equal(await readFile(join(fixture.root, "drafts/manuscript.md"), "utf8"), originalDraft);
    await click("Preview file changes"); await field("I reviewed the target and diff and consent to this file write.").check();
    await click("Confirm apply to file");
    assert((await readFile(join(fixture.root, "drafts/manuscript.md"), "utf8")).includes("Native synthetic paper"));
    const backups = (await readdir(join(fixture.root, "drafts"))).filter(name => name.endsWith(".backup")); assert.equal(backups.length, 1);
    assert.equal(await readFile(join(fixture.root, "drafts", backups[0]), "utf8"), originalDraft);
    assert.deepEqual(await readFile(fixture.pdfPath), fixture.pdf);
    await page.screenshot({ path: ".smoke/native-library.png", fullPage: true });
    console.log("Native browser: citation audit/export, separate file consent and preserved backup passed.");
    await page.goto(url + "?panel=discovery");
    const discovery = page.locator("pi-web-library-discovery");
    await discovery.getByLabel("Literature query", { exact: true }).fill("Native synthetic");
    await discovery.getByRole("button", { name: "Search literature", exact: true }).click();
    await discovery.getByText("Search completed. Select references to import; no metadata was changed automatically.", { exact: true }).waitFor();
    await discovery.getByRole("checkbox", { name: "Select Native synthetic paper", exact: true }).waitFor();
    await discovery.getByRole("button", { name: "Saved searches", exact: true }).click();
    await discovery.getByRole("button", { name: "Refresh saved searches", exact: true }).click();
    await discovery.getByRole("button", { name: "Save current query", exact: true }).waitFor();
    await discovery.getByLabel("Saved search name", { exact: true }).fill("Synthetic local recipe");
    await discovery.getByRole("button", { name: "Save current query", exact: true }).click();
    await discovery.getByRole("heading", { name: "Synthetic local recipe", exact: true }).waitFor();
    await discovery.getByRole("button", { name: "Local connections", exact: true }).click();
    await discovery.getByRole("button", { name: "Refresh local connections", exact: true }).click();
    await discovery.getByText("Local connections loaded.", { exact: true }).waitFor();
    await discovery.getByRole("img", { name: "Local metadata and claim connections. Equivalent labeled connection table follows.", exact: true }).waitFor();
    assert.equal(host.runs.length, 1, "Discovery and writing must not trigger implicit sessions");
    await page.screenshot({ path: ".smoke/native-discovery.png", fullPage: true });
    return ["native catalog creation/metadata and PDF attachment", "actual native PDF worker indexing/search", "native region evidence, reader reload/backlink and stale two-tab metadata conflict", "compiled native companion passage/catalog tools", "explicit model preview/cancel/start", "compiled companion durable result protocol before fake completion", "separate human acceptance with unchanged evidence", "CSL citation audit and browser HTML download", "portable evidence bundle", "file preview/cancellation/consent/backup", "unchanged source PDF", "local discovery/saved recipes/labeled graph"];
  } catch (error) {
    console.error("Browser errors:", errors);
    console.error("Reader failure:", await panel.locator("pi-web-research-library-pdf-viewer").evaluate(element => ({ status: element.shadowRoot.querySelector('[data-status]').textContent, textStatus: element.shadowRoot.querySelector('[data-text-status]').textContent, canvas: [element.shadowRoot.querySelector('canvas').width, element.shadowRoot.querySelector('canvas').height] })).catch(() => "reader unavailable"));
    console.error("Native panel failure:", (await panel.evaluate(element => element.shadowRoot?.textContent).catch(() => "panel unavailable"))?.slice(-12_000));
    await page.screenshot({ path: ".smoke/native-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally { await page.close(); }
}
