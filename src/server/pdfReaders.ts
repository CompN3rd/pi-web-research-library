import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rm, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { LIBRARY_MAX_PDF_BYTES } from "../domain/workbench.js";
import { PDF_CHUNK_BYTES, PDF_IDLE_MS, PDF_MAX_READERS } from "../domain/protocol.js";
import { openWorkspaceFile, readExactly } from "./files.js";

export interface VerifiedPdfSource { path: string; size: number; sha256: string }

interface Reader {
  scopeKey: string;
  handle: FileHandle;
  path: string;
  size: number;
  touchedAt: number;
  reads: number;
}

/** Verified, disk-backed immutable snapshots; never buffers a whole PDF in the daemon. */
export class PdfReaders {
  private readonly readers = new Map<string, Reader>();
  private pending = 0;
  private stopped = false;
  private readonly operations = new Set<Promise<unknown>>();
  constructor(private readonly directory: string, private readonly now: () => number = Date.now) {}

  async start(): Promise<void> {
    // This is a reconstructible, plugin-owned cache. A previous daemon may have crashed.
    await rm(this.directory, { recursive: true, force: true });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
    return operation;
  }

  private isStopped(): boolean { return this.stopped; }

  /** Metadata is resolved by the server catalog, never accepted directly from a peer. */
  openDocument(root: string, authorityKey: string, source: VerifiedPdfSource, signal: AbortSignal) {
    return this.track(this.openReader(root, authorityKey, source, signal));
  }

  private async openReader(root: string, authorityKey: string, pdf: VerifiedPdfSource, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.stopped || this.readers.size + this.pending >= PDF_MAX_READERS) throw new Error("PDF reader limit reached; close another reader or retry after its idle expiry");
    this.pending += 1;
    const id = randomUUID();
    const path = join(this.directory, id);
    let snapshot: FileHandle | undefined;
    let admitted = false;
    try {
      if (!Number.isSafeInteger(pdf.size) || pdf.size < 5 || pdf.size > LIBRARY_MAX_PDF_BYTES || !/^[a-f0-9]{64}$/u.test(pdf.sha256)) throw new Error("Invalid PDF source identity");
      signal.throwIfAborted();
      const source = await openWorkspaceFile(root, pdf.path, LIBRARY_MAX_PDF_BYTES);
      try {
        const stat = await source.stat();
        if (stat.size !== pdf.size) throw new Error("PDF size does not match attachment");
        snapshot = await open(path, "wx+", 0o600);
        const hash = createHash("sha256");
        for (let offset = 0; offset < stat.size; offset += PDF_CHUNK_BYTES) {
          const bytes = await readExactly(source, offset, Math.min(PDF_CHUNK_BYTES, stat.size - offset), signal);
          if (offset === 0 && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Source is not a PDF");
          hash.update(bytes);
          await snapshot.writeFile(bytes);
        }
        const after = await source.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || hash.digest("hex") !== pdf.sha256) throw new Error("PDF digest mismatch or source changed during verification");
        signal.throwIfAborted();
        if (this.isStopped()) throw new Error("Research plugin stopped");
        this.readers.set(id, { scopeKey: authorityKey, handle: snapshot, path, size: stat.size, touchedAt: this.now(), reads: 0 });
        admitted = true;
        return { id, size: stat.size, sha256: pdf.sha256, chunkBytes: PDF_CHUNK_BYTES };
      } finally {
        await source.close();
      }
    } finally {
      this.pending -= 1;
      if (!admitted && snapshot !== undefined) {
        await snapshot.close();
        await unlink(path);
      }
    }
  }

  read(authorityKey: string, id: string, begin: number, end: number, signal: AbortSignal) {
    return this.track(this.readRange(authorityKey, id, begin, end, signal));
  }

  private async readRange(authorityKey: string, id: string, begin: number, end: number, signal: AbortSignal) {
    const reader = this.readers.get(id);
    if (this.stopped || reader?.scopeKey !== authorityKey || this.now() - reader.touchedAt >= PDF_IDLE_MS) throw new Error("PDF reader expired or belongs to another workspace");
    if (begin < 0 || end <= begin || end > reader.size || end - begin > PDF_CHUNK_BYTES) throw new Error("Invalid PDF range");
    if (reader.reads >= 2) throw new Error("Too many concurrent PDF reads");
    signal.throwIfAborted();
    reader.reads += 1;
    reader.touchedAt = this.now();
    try {
      const bytes = await readExactly(reader.handle, begin, end - begin, signal);
      return { begin, data: bytes.toString("base64") };
    } finally {
      reader.reads -= 1;
      reader.touchedAt = this.now();
    }
  }

  close(authorityKey: string, id: string): Promise<void> {
    return this.track(this.closeReader(authorityKey, id));
  }

  private async closeReader(authorityKey: string, id: string): Promise<void> {
    const reader = this.readers.get(id);
    if (reader === undefined) return;
    if (reader.scopeKey !== authorityKey) throw new Error("PDF reader belongs to another workspace");
    this.readers.delete(id);
    await reader.handle.close();
    await unlink(reader.path);
  }

  async expire(): Promise<void> {
    for (const [id, reader] of this.readers) {
      if (reader.reads === 0 && this.now() - reader.touchedAt >= PDF_IDLE_MS) await this.close(reader.scopeKey, id);
    }
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.operations]);
    for (const [id, reader] of this.readers) await this.close(reader.scopeKey, id);
  }
}
