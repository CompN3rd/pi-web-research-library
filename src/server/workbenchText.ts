import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { LIBRARY_MAX_PDF_BYTES, LIBRARY_ROOT, libraryId, libraryInteger, libraryObject, libraryStrings, libraryText, type LibraryDocument, type LibraryReference, type LibraryRepository, type LibraryTextAccess, type LibraryTextHit, type LibraryTextPage } from "../domain/workbench.js";
import { openWorkspaceFile, readExactly } from "./files.js";

export const PDF_TEXT_VERSION = "unpdf-1.8.1-text-v1";
export const PDF_TEXT_MAX_PAGES = 2_000;
export const PDF_TEXT_MAX_PAGE_CHARS = 64_000;
export const PDF_TEXT_MAX_CHARS = 2_000_000;
const INDEX_MAX_BYTES = 8 * 1024 * 1024;
const INDEX_SCAN_BYTES = 64 * 1024 * 1024;
const CHUNK = 256 * 1024;
export interface PdfTextExtraction { pages: LibraryTextPage[]; warnings: string[] }
interface TextIndex extends PdfTextExtraction { version: string; pdfSha256: string; size: number; textSha256: string }
export type PdfTextExtractor = (snapshot: string, signal: AbortSignal) => Promise<PdfTextExtraction>;

/** Verified derivative data only. It is neither browser-supplied extraction nor OCR. */
export class WorkbenchText implements LibraryTextAccess {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly lifetime = new AbortController();
  private readonly inflight = new Set<string>();
  constructor(private readonly repository: LibraryRepository, private readonly extract: PdfTextExtractor = extractPdfInWorker) {}

  index(root: string, referenceId: string, documentId: string, signal?: AbortSignal, rebuild = false) {
    return this.track(() => this.indexDocument(root, referenceId, documentId, signal, rebuild));
  }

  private async indexDocument(root: string, referenceId: string, documentId: string, signal: AbortSignal | undefined, rebuild: boolean) {
    const live = this.signal(signal);
    const document = await this.document(root, referenceId, documentId, live);
    const identity = JSON.stringify([await realpath(root), document.sha256]);
    if (this.inflight.has(identity)) throw new Error("This PDF is already being indexed; retry after the current request finishes");
    if (this.inflight.size >= 2) throw new Error("PDF text extraction limit reached; wait for another extraction to finish");
    this.inflight.add(identity);
    let directory: string | undefined;
    try {
      const existing = rebuild ? null : await readIndex(root, document, live);
      if (existing !== null) {
        await verifyPdf(root, document, live);
        return indexReceipt(document, existing, true);
      }
      directory = await mkdtemp(join(tmpdir(), "research-pdf-text-"));
      const snapshot = join(directory, "verified.pdf");
      await verifyPdf(root, document, live, snapshot);
      const extraction = validateExtraction(await this.extract(snapshot, live));
      const current = await this.document(root, referenceId, documentId, live);
      if (current.sha256 !== document.sha256 || current.path !== document.path || current.size !== document.size) throw new Error("PDF binding changed during extraction");
      const content = { ...extraction, version: PDF_TEXT_VERSION, pdfSha256: document.sha256, size: document.size };
      const index: TextIndex = { ...content, textSha256: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
      await writeIndex(root, document, index, live);
      return indexReceipt(document, index, false);
    } finally {
      this.inflight.delete(identity);
      if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    }
  }

  read(root: string, referenceId: string, documentId: string, page: number, signal?: AbortSignal): Promise<LibraryTextPage> {
    return this.track(() => this.readPage(root, referenceId, documentId, page, signal));
  }

  private async readPage(root: string, referenceId: string, documentId: string, page: number, signal?: AbortSignal): Promise<LibraryTextPage> {
    const live = this.signal(signal);
    libraryInteger(page, 1, PDF_TEXT_MAX_PAGES);
    const document = await this.document(root, referenceId, documentId, live);
    const index = await readIndex(root, document, live);
    if (index === null) throw new Error("PDF text is not indexed. Use Index PDF text first; scanned PDFs require OCR outside this tool.");
    await verifyPdf(root, document, live);
    const result = index.pages[page - 1];
    if (result === undefined) throw new Error("Page is outside this PDF text index");
    return result;
  }

  search(root: string, query: string, referenceIds: string[], signal?: AbortSignal): Promise<LibraryTextHit[]> {
    return this.track(() => this.searchIndex(root, query, referenceIds, signal));
  }

  private async searchIndex(root: string, query: string, referenceIds: string[], signal?: AbortSignal): Promise<LibraryTextHit[]> {
    const live = this.signal(signal);
    const needle = libraryText(query, 300, false);
    // A literal Unicode-insensitive matcher preserves offsets into the original
    // text, unlike case folding that can expand characters such as capital İ.
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu");
    const ids = libraryStrings(referenceIds, 100, 80).map(id => libraryId(id, "ref"));
    const state = await this.repository.read(root, live);
    const references = state.references.filter(reference => reference.deletedAt === null && (ids.length === 0 || ids.includes(reference.id)));
    if (ids.some(id => !references.some(reference => reference.id === id))) throw new Error("Search includes a missing or trashed reference");
    const hits: LibraryTextHit[] = [];
    let scanned = 0;
    for (const reference of references) {
      for (const document of reference.documents) {
        live.throwIfAborted();
        const index = await readIndex(root, document, live);
        if (index === null) {
          if (ids.length > 0) throw new Error("A selected PDF has no text index; use Index PDF text on its attachments before searching this corpus");
          continue;
        }
        scanned += Buffer.byteLength(JSON.stringify(index));
        if (scanned > INDEX_SCAN_BYTES) throw new Error("Full-text search exceeds its 64 MiB scan budget; select fewer references");
        const matches: LibraryTextHit[] = [];
        for (const page of index.pages) {
          const position = page.text.search(pattern);
          if (position >= 0) matches.push({ referenceId: reference.id, documentId: document.id, pdfSha256: document.sha256, page: page.page, excerpt: page.text.slice(Math.max(0, position - 240), position + needle.length + 240) });
          if (hits.length + matches.length >= 50) break;
        }
        if (matches.length !== 0) {
          await verifyPdf(root, document, live);
          hits.push(...matches);
        }
        if (hits.length >= 50) return hits;
      }
    }
    return hits;
  }

  async document(root: string, referenceId: string, documentId: string, signal?: AbortSignal): Promise<LibraryDocument> {
    const reference = findReference((await this.repository.read(root, signal)).references, referenceId);
    const document = reference.documents.find(item => item.id === libraryId(documentId, "doc"));
    if (document === undefined) throw new Error("PDF attachment not found on this reference");
    return document;
  }

  async dispose(): Promise<void> {
    this.lifetime.abort();
    await Promise.allSettled([...this.pending]);
  }

  private signal(signal?: AbortSignal): AbortSignal {
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal]);
    combined.throwIfAborted();
    return combined;
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending.size >= 8) return Promise.reject(new Error("PDF text service is busy; retry after pending requests finish"));
    const promise = operation();
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => undefined);
    return promise;
  }
}

export function findReference(references: LibraryReference[], id: string): LibraryReference {
  const reference = references.find(item => item.id === libraryId(id, "ref") && item.deletedAt === null);
  if (reference === undefined) throw new Error("Reference not found or is in trash");
  return reference;
}

/** Streaming verification reserves no document-sized buffer in the daemon. */
async function verifyPdf(root: string, document: LibraryDocument, signal: AbortSignal, snapshot?: string): Promise<void> {
  signal.throwIfAborted();
  const source = await openWorkspaceFile(root, document.path, LIBRARY_MAX_PDF_BYTES);
  try {
    const before = await source.stat();
    if (before.size !== document.size || before.size < 5) throw new Error("PDF size changed; attach the replacement explicitly");
    const destination = snapshot === undefined ? undefined : await open(snapshot, "wx", 0o600);
    try {
      const hash = createHash("sha256");
      for (let position = 0; position < before.size; position += CHUNK) {
        const bytes = await readExactly(source, position, Math.min(CHUNK, before.size - position), signal);
        if (position === 0 && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Attachment does not have a PDF signature");
        hash.update(bytes);
        if (destination !== undefined) await destination.writeFile(bytes);
      }
      const after = await source.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || hash.digest("hex") !== document.sha256) throw new Error("PDF digest changed; attach the replacement explicitly");
      signal.throwIfAborted();
    } finally { await destination?.close(); }
  } finally { await source.close(); }
}

function cachePath(document: LibraryDocument): string {
  return `${LIBRARY_ROOT}/text/${document.sha256}-${PDF_TEXT_VERSION}.json`;
}

async function readIndex(root: string, document: LibraryDocument, signal: AbortSignal): Promise<TextIndex | null> {
  try {
    const file = await openWorkspaceFile(root, cachePath(document), INDEX_MAX_BYTES);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > INDEX_MAX_BYTES) throw new Error("PDF text index exceeds its bounded read limit");
      const bytes = await readExactly(file, 0, before.size, signal);
      const after = await file.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("PDF text index changed during read");
      const value = libraryObject(JSON.parse(bytes.toString("utf8")), ["version", "pdfSha256", "size", "pages", "warnings", "textSha256"]);
      if (value["version"] !== PDF_TEXT_VERSION || value["pdfSha256"] !== document.sha256 || value["size"] !== document.size) throw new Error("PDF text index has a mismatched source or extraction version");
      const content = { ...validateExtraction({ pages: value["pages"], warnings: value["warnings"] }), version: PDF_TEXT_VERSION, pdfSha256: document.sha256, size: document.size };
      const textSha256 = createHash("sha256").update(JSON.stringify(content)).digest("hex");
      if (value["textSha256"] !== textSha256) throw new Error("PDF text index checksum mismatch; restore or rebuild the derivative index");
      return { ...content, textSha256 };
    } finally { await file.close(); }
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function writeIndex(root: string, document: LibraryDocument, index: TextIndex, signal: AbortSignal): Promise<void> {
  const serialized = JSON.stringify(index);
  if (Buffer.byteLength(serialized) > INDEX_MAX_BYTES) throw new Error("PDF text index exceeds storage limit");
  let directory = await realpath(root);
  for (const part of [...LIBRARY_ROOT.split("/"), "text"]) {
    directory = join(directory, part);
    await mkdir(directory).catch((error: unknown) => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("PDF text storage cannot traverse symlinks or non-directories");
  }
  const destination = join(directory, cachePath(document).split("/").at(-1) ?? "invalid");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    created = true;
    try { await file.writeFile(serialized, "utf8"); await file.sync(); } finally { await file.close(); }
    signal.throwIfAborted();
    try { const entry = await lstat(destination); if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("PDF text index destination is not a regular file"); }
    catch (error) { if (!isMissing(error)) throw error; }
    await rename(temporary, destination);
  } finally { if (created) await rm(temporary, { force: true }); }
}

export function validateExtraction(input: unknown): PdfTextExtraction {
  const value = libraryObject(input, ["pages", "warnings"]);
  const rows = value["pages"];
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > PDF_TEXT_MAX_PAGES) throw new Error("PDF page count exceeds extraction limits");
  let length = 0;
  const pages = rows.map((row: unknown, index: number) => {
    const page = libraryObject(row, ["page", "text"]);
    if (page["page"] !== index + 1) throw new Error("PDF text pages must be contiguous and one-based");
    const text = libraryText(page["text"], PDF_TEXT_MAX_PAGE_CHARS);
    length += text.length;
    return { page: index + 1, text };
  });
  if (length > PDF_TEXT_MAX_CHARS) throw new Error("PDF text exceeds extraction character limit");
  return { pages, warnings: libraryStrings(value["warnings"], 20, 1_000) };
}

function indexReceipt(document: LibraryDocument, index: TextIndex, cached: boolean) {
  return { documentId: document.id, pdfSha256: document.sha256, pages: index.pages.length, characters: index.pages.reduce((sum, page) => sum + page.text.length, 0), warnings: index.warnings, cached, extractionVersion: PDF_TEXT_VERSION };
}
function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

/** CPU/memory faults and a sixty-second deadline terminate only the extraction worker. */
export function extractPdfInWorker(snapshot: string, signal: AbortSignal): Promise<PdfTextExtraction> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-text-worker.js", import.meta.url), { workerData: { snapshot }, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 } });
    let settled = false;
    const finish = (error: unknown, result?: PdfTextExtraction) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      void worker.terminate().then(() => { if (error !== null) reject(error instanceof Error ? error : new Error(typeof error === "string" ? error : "PDF text worker failed without an Error")); else if (result !== undefined) resolve(result); else reject(new Error("PDF worker returned no text")); }).catch(reject);
    };
    const abort = () => { finish(new Error("PDF text extraction cancelled")); };
    const timer = setTimeout(() => { finish(new Error("PDF text extraction exceeded its 60-second limit")); }, 60_000);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
    worker.once("message", (message: unknown) => {
      try {
        const envelope = libraryObject(message, ["ok"], ["result", "error"]);
        if (envelope["ok"] !== true) throw new Error(libraryText(envelope["error"], 1_000, false));
        finish(null, validateExtraction(envelope["result"]));
      } catch (error) { finish(error); }
    });
    worker.once("error", (error) => { finish(error); });
    worker.once("exit", (code) => { if (!settled) finish(new Error(`PDF text worker exited without a result (${String(code)})`)); });
    if (signal.aborted) abort();
  });
}
