import { Buffer } from "node:buffer";
import { mkdtemp, open, rm, stat, truncate, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, LIBRARY_MAX_BYTES, LIBRARY_MAX_PDF_BYTES, type BibliographyCodec } from "../domain/workbench.js";
import { reference } from "./workbench.testSupport.js";
import { LibraryCatalog } from "./workbenchCatalog.js";
import { readWorkbenchBytes } from "./workbenchFiles.js";
import { WorkbenchStore } from "./workbenchStore.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "native-library-growth-")); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.mocked(open).mockReset().mockImplementation(actualFs.open);
  await rm(root, { recursive: true, force: true });
});

/** Grow the real file only after the opening check, immediately before the consumer's fresh stat. */
function growAfterOpeningSnapshot(path: string, maxBytes: number) {
  const handles: FileHandle[] = [];
  const readAttempt = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("Oversized file must not be read"));
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await actualFs.open(...args); handles.push(handle);
    const openingStat = await handle.stat();
    expect(openingStat.size).toBeLessThanOrEqual(maxBytes);
    const actualStat = handle.stat.bind(handle);
    vi.spyOn(handle, "stat")
      .mockResolvedValueOnce(openingStat)
      .mockImplementationOnce(async () => {
        await truncate(path, maxBytes + 1);
        return actualStat();
      });
    vi.spyOn(handle, "read").mockImplementation(readAttempt);
    return handle;
  });
  return { handles, readAttempt };
}

describe("workbench file bounds after opening", () => {
  it("rejects a grown state snapshot before allocating or reading beyond the 16MiB bound", async () => {
    const path = join(root, "library.json"); await writeFile(path, JSON.stringify(emptyLibrary()));
    const growth = growAfterOpeningSnapshot(path, LIBRARY_MAX_BYTES);
    const allocations = vi.spyOn(Buffer, "alloc");
    await expect(readWorkbenchBytes(root, "library.json", LIBRARY_MAX_BYTES)).rejects.toThrow(/bounded regular library file/u);
    expect((await stat(path)).size).toBe(LIBRARY_MAX_BYTES + 1);
    expect(allocations.mock.calls.some(([size]) => size > LIBRARY_MAX_BYTES)).toBe(false);
    expect(growth.readAttempt).not.toHaveBeenCalled();
    expect(growth.handles).toHaveLength(1); expect(growth.handles[0]?.fd).toBe(-1);
  });
  it("rejects a grown attachment snapshot before streaming any PDF bytes or changing the catalog", async () => {
    const store = new WorkbenchStore(); const ref = reference();
    await store.update(root, state => { state.references.push(ref); });
    const before = await store.read(root);
    const codec: BibliographyCodec = {
      parse: () => { throw new Error("Codec must not be invoked by attachment admission"); },
      export: () => { throw new Error("Codec must not be invoked by attachment admission"); },
      format: () => { throw new Error("Codec must not be invoked by attachment admission"); },
    };
    const path = join(root, "synthetic.pdf"); await writeFile(path, "%PDF-1.7\nSynthetic fixture\n%%EOF\n");
    const growth = growAfterOpeningSnapshot(path, LIBRARY_MAX_PDF_BYTES);
    await expect(new LibraryCatalog(store, codec).handle(root, "library.attach", {
      referenceId: ref.id, expectedRevision: ref.revision, path: "synthetic.pdf", label: "Synthetic", sourceUrl: "", rights: "",
    }, new AbortController().signal)).rejects.toThrow(/bounded regular PDF file/u);
    expect((await stat(path)).size).toBe(LIBRARY_MAX_PDF_BYTES + 1);
    expect(growth.readAttempt).not.toHaveBeenCalled();
    expect(growth.handles).toHaveLength(1); expect(growth.handles[0]?.fd).toBe(-1);
    expect(await store.read(root)).toEqual(before);
  });
});
