import { readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, emptyReferenceFields, type LibraryDocument, type LibraryRepository } from "../domain/workbench.js";
import { researchFixture } from "./fixture.testSupport.js";
import { WorkbenchText, validateExtraction, type PdfTextExtractor } from "./workbenchText.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const referenceId = `ref-${"a".repeat(32)}`;
const documentId = `doc-${"b".repeat(32)}`;
async function fixture(extractor?: PdfTextExtractor) {
  const fixture = await researchFixture();
  cleanups.push(() => rm(fixture.root, { recursive: true, force: true }));
  const document: LibraryDocument = { id: documentId, ...fixture.source, label: "Synthetic", sourceUrl: "", rights: "Synthetic test", addedAt: "2026-09-26T00:00:00.000Z" };
  const state = emptyLibrary();
  state.references.push({ ...emptyReferenceFields(), id: referenceId, title: "Synthetic paper", citekey: "Synthetic2026", revision: 1, createdAt: document.addedAt, updatedAt: document.addedAt, deletedAt: null, documents: [document], aliases: [], provenance: [] });
  const repository: LibraryRepository = { read: () => Promise.resolve(structuredClone(state)), update: () => Promise.reject(new Error("Text service must not mutate catalog")) };
  const extract = vi.fn(extractor ?? (() => Promise.resolve({ pages: [{ page: 1, text: "Verified synthetic result. A second result." }, { page: 2, text: "Other page." }], warnings: ["Synthetic extractor"] })));
  const service = new WorkbenchText(repository, extract);
  cleanups.push(() => service.dispose());
  return { ...fixture, document, state, extract, service };
}

describe("verified native PDF text indexes", () => {
  it("uses a verified snapshot, durable page boundaries and cache without modifying the PDF", async () => {
    const f = await fixture();
    const before = await readFile(f.pdfPath);
    await expect(f.service.read(f.root, referenceId, documentId, 1)).rejects.toThrow("not indexed");
    expect(f.extract).not.toHaveBeenCalled();
    const indexed = await f.service.index(f.root, referenceId, documentId);
    expect(indexed).toMatchObject({ pages: 2, pdfSha256: f.source.sha256, cached: false });
    expect(await f.service.read(f.root, referenceId, documentId, 1)).toEqual({ page: 1, text: "Verified synthetic result. A second result." });
    expect(await f.service.search(f.root, "RESULT", [referenceId])).toEqual([{ referenceId, documentId, pdfSha256: f.source.sha256, page: 1, excerpt: "Verified synthetic result. A second result." }]);
    expect(await f.service.index(f.root, referenceId, documentId)).toMatchObject({ cached: true });
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect(await readFile(f.pdfPath)).toEqual(before);
    await expect(f.service.read(f.root, referenceId, documentId, 3)).rejects.toThrow("outside");
    await expect(f.service.read(f.root, referenceId, documentId, 0)).rejects.toThrow("integer");
  });

  it("keeps source excerpt offsets stable across Unicode case expansion and treats query syntax literally", async () => {
    const f = await fixture(() => Promise.resolve({ pages: [{ page: 1, text: `${"İ".repeat(500)} A literal [result].` }], warnings: [] }));
    await expect(f.service.search(f.root, "result", [referenceId])).rejects.toThrow("no text index");
    await f.service.index(f.root, referenceId, documentId);
    expect((await f.service.search(f.root, "[RESULT]", [referenceId]))[0]?.excerpt).toContain("[result]");
    expect(await f.service.search(f.root, ".*", [referenceId])).toEqual([]);
  });

  it("rejects changed PDF bytes even after indexing and never indexes a symlink", async () => {
    const f = await fixture();
    await f.service.index(f.root, referenceId, documentId);
    await writeFile(f.pdfPath, Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(f.pdf.length - 5, 32)]));
    await expect(f.service.read(f.root, referenceId, documentId, 1)).rejects.toThrow("digest changed");
    await expect(f.service.search(f.root, "result", [])).rejects.toThrow("digest changed");
    await expect(f.service.index(f.root, referenceId, documentId)).rejects.toThrow("digest changed");
    const other = join(f.root, "other.pdf"); await writeFile(other, f.pdf);
    await rm(f.pdfPath); await symlink(other, f.pdfPath);
    await expect(f.service.index(f.root, referenceId, documentId)).rejects.toThrow("symlink");
    expect(f.extract).toHaveBeenCalledTimes(1);
  });

  it("fails closed on cache corruption or a changed attachment binding", async () => {
    const f = await fixture();
    await f.service.index(f.root, referenceId, documentId);
    const directory = join(f.root, ".pi-web/research-library/text");
    const name = (await readdir(directory))[0];
    if (name === undefined) throw new Error("Missing index");
    await writeFile(join(directory, name), JSON.stringify({ version: "unrecognized", pdfSha256: f.source.sha256, size: f.pdf.length, pages: [], warnings: [], textSha256: "a".repeat(64) }));
    await expect(f.service.read(f.root, referenceId, documentId, 1)).rejects.toThrow("mismatched");
    f.state.references[0]?.documents.splice(0);
    await expect(f.service.read(f.root, referenceId, documentId, 1)).rejects.toThrow("attachment not found");
    await expect(f.service.search(f.root, "result", [`ref-${"d".repeat(32)}`])).rejects.toThrow("missing or trashed");
  });

  it("detects semantic cache corruption even when JSON remains well-formed", async () => {
    const f = await fixture();
    await f.service.index(f.root, referenceId, documentId);
    const directory = join(f.root, ".pi-web/research-library/text");
    const name = (await readdir(directory))[0]; if (name === undefined) throw new Error("Missing index");
    const path = join(directory, name);
    const content = (await readFile(path, "utf8")).replace("Verified synthetic result.", "Tampered synthetic text.");
    await writeFile(path, content);
    await expect(f.service.read(f.root, referenceId, documentId, 1)).rejects.toThrow("checksum mismatch");
    await expect(f.service.index(f.root, referenceId, documentId)).rejects.toThrow("checksum mismatch");
    expect(await f.service.index(f.root, referenceId, documentId, undefined, true)).toMatchObject({ cached: false });
    expect((await f.service.read(f.root, referenceId, documentId, 1)).text).toContain("Verified synthetic result.");
    expect(f.extract).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate extraction, propagates cancellation and cleans private snapshots", async () => {
    let started: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let snapshot = "";
    const f = await fixture((path, signal) => {
      snapshot = path;
      started?.();
      return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { reject(new Error("Synthetic abort")); }, { once: true }); });
    });
    const running = f.service.index(f.root, referenceId, documentId);
    // Observe rejection before abort; no unhandled promise is left behind.
    const failed = expect(running).rejects.toThrow("Synthetic abort");
    await ready;
    expect(await readFile(snapshot)).toEqual(f.pdf);
    await expect(f.service.index(f.root, referenceId, documentId)).rejects.toThrow("already being indexed");
    await f.service.dispose();
    await failed;
    await expect(readdir(dirname(snapshot))).rejects.toThrow("ENOENT");
    await expect(f.service.read(f.root, referenceId, documentId, 1)).rejects.toThrow();
  });

  it("validates worker results instead of treating arbitrary output as verified text", () => {
    expect(() => validateExtraction({ pages: [{ page: 2, text: "bad sequence" }], warnings: [] })).toThrow("contiguous");
    expect(() => validateExtraction({ pages: [{ page: 1, text: "x".repeat(64_001) }], warnings: [] })).toThrow("oversized");
    expect(() => validateExtraction({ pages: [{ page: 1, text: "text", javascript: "no" }], warnings: [] })).toThrow("unsupported");
    expect(() => validateExtraction({ pages: [{ page: 1, text: "\u0000" }], warnings: [] })).toThrow("text");
    expect(validateExtraction({ pages: [{ page: 1, text: "" }], warnings: ["No OCR"] })).toEqual({ pages: [{ page: 1, text: "" }], warnings: ["No OCR"] });
  });
});
