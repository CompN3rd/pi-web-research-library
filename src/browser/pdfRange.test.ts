import { describe, expect, it, vi } from "vitest";
import { openPdfRange } from "./pdfRange.js";
import { PDF_CHUNK_BYTES, record } from "../domain/protocol.js";
import type { ResearchPeer } from "./peerClient.js";

const attachment = { referenceId: `ref-${"a".repeat(32)}`, documentId: `doc-${"b".repeat(32)}`, expectedSha256: "a".repeat(64) };
const id = "12345678-1234-1234-1234-123456789abc";
class Transport {
  readonly onDataRange = vi.fn<(begin: number, bytes: Uint8Array) => void>();
  requestDataRange(): void { /* replaced by the adapter */ }
  abort(): void { /* replaced by the adapter */ }
}
function peer(size: number) {
  return { request: vi.fn<ResearchPeer["request"]>((operation, envelope) => {
    if (operation === "library.pdf.open") return Promise.resolve({ id, size, sha256: attachment.expectedSha256, chunkBytes: PDF_CHUNK_BYTES });
    if (operation === "pdf.close") return Promise.resolve(null);
    if (operation !== "pdf.read") throw new Error(`Unexpected operation: ${operation}`);
    const payload = record(record(envelope, ["version", "payload"])["payload"], ["id", "begin", "end"]);
    const begin = payload["begin"]; const end = payload["end"];
    if (typeof begin !== "number" || typeof end !== "number") throw new Error("Invalid test range");
    return Promise.resolve({ begin, data: Buffer.alloc(end - begin, 65).toString("base64") });
  }) };
}

describe("PDF.js package-peer range adapter", () => {
  it("closes an admitted reader when metadata validation or transport construction fails", async () => {
    const badMetadata = peer(100);
    badMetadata.request.mockResolvedValueOnce({ id, size: 100, sha256: "wrong", chunkBytes: PDF_CHUNK_BYTES });
    await expect(openPdfRange({ PDFDataRangeTransport: Transport }, { peer: badMetadata, ...attachment }, new AbortController().signal, vi.fn())).rejects.toThrow("metadata");
    expect(badMetadata.request.mock.calls.filter(([op]) => op === "pdf.close")).toHaveLength(1);
    class BrokenTransport extends Transport { constructor() { super(); throw new Error("constructor failed"); } }
    const p = peer(100);
    await expect(openPdfRange({ PDFDataRangeTransport: BrokenTransport }, { peer: p, ...attachment }, new AbortController().signal, vi.fn())).rejects.toThrow("constructor failed");
    expect(p.request.mock.calls.filter(([op]) => op === "pdf.close")).toHaveLength(1);
  });
  it("opens only a catalog attachment and verifies its expected digest", async () => {
    const p = peer(100);
    const source = { peer: p, ...attachment };
    const abort = new AbortController();
    const { range } = await openPdfRange({ PDFDataRangeTransport: Transport }, source, abort.signal, vi.fn());
    expect(p.request).toHaveBeenCalledWith("library.pdf.open", { version: 1, payload: { referenceId: attachment.referenceId, documentId: attachment.documentId } }, { signal: abort.signal });
    range.abort();
    p.request.mockResolvedValueOnce({ id, size: 100, sha256: "b".repeat(64), chunkBytes: PDF_CHUNK_BYTES });
    await expect(openPdfRange({ PDFDataRangeTransport: Transport }, source, new AbortController().signal, vi.fn())).rejects.toThrow("metadata");
  });
  it("splits coalesced ranges into bounded requests and closes once on abort", async () => {
    const p = peer(PDF_CHUNK_BYTES * 2 + 10);
    const abort = new AbortController(); const fail = vi.fn();
    const { range } = await openPdfRange({ PDFDataRangeTransport: Transport }, { peer: p, ...attachment }, abort.signal, fail);
    range.requestDataRange(0, PDF_CHUNK_BYTES * 2 + 10);
    await vi.waitFor(() => { expect(p.request.mock.calls.filter(([op]) => op === "pdf.read")).toHaveLength(3); });
    await vi.waitFor(() => { expect(range.onDataRange).toHaveBeenCalledTimes(1); });
    expect(fail).not.toHaveBeenCalled();
    abort.abort(); range.abort();
    expect(p.request.mock.calls.filter(([op]) => op === "pdf.close")).toHaveLength(1);
  });
  it("reports malformed chunks without passing partial data into the renderer", async () => {
    const p = peer(100); const fail = vi.fn();
    const { range } = await openPdfRange({ PDFDataRangeTransport: Transport }, { peer: p, ...attachment }, new AbortController().signal, fail);
    p.request.mockResolvedValueOnce({ begin: 0, data: "QQ==" });
    range.requestDataRange(0, 10);
    await vi.waitFor(() => { expect(fail).toHaveBeenCalledTimes(1); });
    expect(range.onDataRange).not.toHaveBeenCalled();
    expect(p.request.mock.calls.filter(([op]) => op === "pdf.close")).toHaveLength(1);
  });
  it("does not deliver late bytes after cancellation", async () => {
    const p = peer(100); const fail = vi.fn();
    const abort = new AbortController();
    const { range } = await openPdfRange({ PDFDataRangeTransport: Transport }, { peer: p, ...attachment }, abort.signal, fail);
    let complete: ((value: { begin: number; data: string }) => void) | undefined;
    p.request.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    range.requestDataRange(0, 10);
    await vi.waitFor(() => { expect(complete).toBeDefined(); });
    abort.abort();
    complete?.({ begin: 0, data: Buffer.alloc(10).toString("base64") });
    await Promise.resolve(); await Promise.resolve();
    expect(range.onDataRange).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });
});
