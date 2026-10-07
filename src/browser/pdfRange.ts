import type { PluginPeer } from "@jmfederico/pi-web/plugin-api";
import { LIBRARY_MAX_PDF_BYTES } from "../domain/workbench.js";
import { boundedString, integer, PDF_CHUNK_BYTES, record } from "../domain/protocol.js";
import { researchRequest } from "./peerClient.js";

export interface PdfRangeTransport {
  requestDataRange(begin: number, end: number): void;
  onDataRange(begin: number, chunk: Uint8Array): void;
  abort(): void;
}
export interface RangeModule {
  PDFDataRangeTransport?: new (length: number, initialData: Uint8Array, progressiveDone: boolean) => PdfRangeTransport;
}
export interface PdfPeerSource {
  peer: PluginPeer;
  referenceId: string;
  documentId: string;
  expectedSha256: string;
}

/** PDF.js pulls bounded chunks; no whole-document fetch or private URL is used. */
export async function openPdfRange(module: RangeModule, source: PdfPeerSource, signal: AbortSignal, fail: (error: unknown) => void) {
  const Transport = module.PDFDataRangeTransport;
  if (Transport === undefined) throw new Error("PDF.js range transport is unavailable");
  const { referenceId, documentId, expectedSha256 } = source;
  const info = record(await researchRequest(source.peer, "library.pdf.open", { referenceId, documentId }, signal), ["id", "size", "sha256", "chunkBytes"]);
  const id = boundedString(info["id"], /^[a-f0-9-]{36}$/u);
  let closed = false;
  let queued = 0;
  let tail = Promise.resolve();
  const abort = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", abort);
    // Disconnection can prevent this request. Server-side idle expiry is the backstop.
    void researchRequest(source.peer, "pdf.close", { id }).catch((error: unknown) => {
      console.warn("Research PDF close was not confirmed; server idle expiry will clean it up", error);
    });
  };
  let size: number;
  let transport: PdfRangeTransport;
  try {
    size = integer(info["size"], 5, LIBRARY_MAX_PDF_BYTES);
    if (info["sha256"] !== expectedSha256 || info["chunkBytes"] !== PDF_CHUNK_BYTES) throw new Error("Invalid PDF reader metadata");
    transport = new Transport(size, new Uint8Array(), true);
  } catch (error) { abort(); throw error; }
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) { abort(); signal.throwIfAborted(); }
  const isClosed = () => closed;
  transport.abort = abort;
  transport.requestDataRange = (begin, end) => {
    if (closed) return;
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > size || queued >= 16) {
      abort(); fail(new Error("PDF.js requested an invalid or excessive range")); return;
    }
    queued += 1;
    tail = tail.then(async () => {
      if (closed) return;
      // PDF.js requires exactly one response per requested range, even when it
      // coalesces chunks. Only this serial range buffer is allocated (<= document size).
      const bytes = new Uint8Array(end - begin);
      for (let position = begin; position < end && !isClosed(); position += PDF_CHUNK_BYTES) {
        const next = Math.min(end, position + PDF_CHUNK_BYTES);
        const result = record(await researchRequest(source.peer, "pdf.read", { id, begin: position, end: next }, signal), ["begin", "data"]);
        if (result["begin"] !== position || typeof result["data"] !== "string" || result["data"].length > Math.ceil(PDF_CHUNK_BYTES / 3) * 4) throw new Error("Invalid PDF range response");
        const decoded = atob(result["data"]);
        if (decoded.length !== next - position) throw new Error("Truncated PDF range response");
        for (let index = 0; index < decoded.length; index += 1) bytes[position - begin + index] = decoded.charCodeAt(index);
      }
      if (!isClosed()) transport.onDataRange(begin, bytes);
    }).catch((error: unknown) => { if (!closed) { abort(); fail(error); } }).finally(() => { queued -= 1; });
  };
  return { range: transport, rangeChunkSize: PDF_CHUNK_BYTES, length: size };
}
