import { readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PDF_CHUNK_BYTES, PDF_IDLE_MS, PDF_MAX_READERS } from "../domain/protocol.js";
import { LIBRARY_MAX_PDF_BYTES } from "../domain/workbench.js";
import { PdfReaders } from "./pdfReaders.js";
import { researchFixture } from "./fixture.testSupport.js";
import { openWorkspaceFile } from "./files.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const signal = () => new AbortController().signal;
async function fixture(pdf?: Buffer) {
  const f = await researchFixture(pdf);
  cleanup.push(() => rm(f.root, { recursive: true, force: true }));
  const cache = join(f.root, "cache");
  let now = 0;
  const readers = new PdfReaders(cache, () => now);
  await readers.start();
  cleanup.push(() => readers.dispose());
  return { ...f, cache, readers, tick: (ms: number) => { now += ms; } };
}

describe("bounded verified PDF snapshots", () => {
  it("serves exact chunks from a verified attachment even when the source later changes", async () => {
    const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(PDF_CHUNK_BYTES * 2, 65)]);
    const f = await fixture(bytes);
    const opened = await f.readers.openDocument(f.root, "workspace-a", f.source, signal());
    await writeFile(f.pdfPath, "modified source");
    const range = await f.readers.read("workspace-a", opened.id, 3, 100, signal());
    expect(Buffer.from(range.data, "base64")).toEqual(bytes.subarray(3, 100));
    expect(opened).toMatchObject({ size: bytes.length, sha256: f.source.sha256 });
    await expect(f.readers.read("workspace-b", opened.id, 0, 5, signal())).rejects.toThrow("another workspace");
    await expect(f.readers.close("workspace-b", opened.id)).rejects.toThrow("another workspace");
    await f.readers.close("workspace-a", opened.id);
    expect(await readdir(f.cache)).toEqual([]);
  });
  it("rejects invalid attachment identity before creating a snapshot", async () => {
    const f = await fixture();
    for (const size of [-1, 4, LIBRARY_MAX_PDF_BYTES + 1, NaN]) {
      await expect(f.readers.openDocument(f.root, "a", { ...f.source, size }, signal())).rejects.toThrow("identity");
    }
    await expect(f.readers.openDocument(f.root, "a", { ...f.source, sha256: "bad" }, signal())).rejects.toThrow("identity");
    expect(await readdir(f.cache)).toEqual([]);
  });
  it("rejects a mismatched digest, size, signature or symlink and cleans partial snapshots", async () => {
    const f = await fixture();
    await writeFile(f.pdfPath, Buffer.alloc(f.pdf.length, 65));
    await expect(f.readers.openDocument(f.root, "a", f.source, signal())).rejects.toThrow("not a PDF");
    await writeFile(f.pdfPath, Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(f.pdf.length - 5, 65)]));
    await expect(f.readers.openDocument(f.root, "a", f.source, signal())).rejects.toThrow("digest mismatch");
    await writeFile(f.pdfPath, "%PDF-1.7");
    await expect(f.readers.openDocument(f.root, "a", f.source, signal())).rejects.toThrow("size");
    const other = join(f.root, "other.pdf"); await writeFile(other, f.pdf);
    await rm(f.pdfPath); await symlink(other, f.pdfPath);
    await expect(f.readers.openDocument(f.root, "a", f.source, signal())).rejects.toThrow("symlink");
    expect(await readdir(f.cache)).toEqual([]);
  });
  it("bounds active and pending readers, ranges, cancellation and idle cleanup", async () => {
    const f = await fixture();
    const opened = await Promise.all(Array.from({ length: PDF_MAX_READERS }, () => f.readers.openDocument(f.root, "a", f.source, signal())));
    await expect(f.readers.openDocument(f.root, "a", f.source, signal())).rejects.toThrow("limit");
    const first = opened[0]; if (first === undefined) throw new Error("Missing reader");
    await expect(f.readers.read("a", first.id, -1, 5, signal())).rejects.toThrow("range");
    await expect(f.readers.read("a", first.id, 0, PDF_CHUNK_BYTES + 1, signal())).rejects.toThrow("range");
    const controller = new AbortController(); controller.abort();
    await expect(f.readers.read("a", first.id, 0, 5, controller.signal)).rejects.toThrow();
    f.tick(PDF_IDLE_MS);
    await expect(f.readers.read("a", first.id, 0, 5, signal())).rejects.toThrow("expired");
    await f.readers.expire();
    expect(await readdir(f.cache)).toEqual([]);
    await expect(f.readers.openDocument(f.root, "a", f.source, controller.signal)).rejects.toThrow();
  });
  it("refuses lexical traversal and cleans stale cache files at startup", async () => {
    const f = await fixture();
    for (const path of ["../outside.pdf", "/root.pdf", "C:/outside.pdf", "raw\\paper.pdf"]) await expect(openWorkspaceFile(f.root, path, 100)).rejects.toThrow();
    await writeFile(join(f.cache, "orphan"), "partial");
    await f.readers.start();
    expect(await readdir(f.cache)).toEqual([]);
  });
});
