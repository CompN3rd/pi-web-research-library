import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import type { LibraryCollection, LibraryDocument, LibraryEvidence, LibraryManuscript, LibraryPage, LibraryReference, LibraryResearchResult, LibraryTask, LibraryTextHit, ReferenceFields } from "../domain/workbench.js";
import { LIBRARY_MAX_REFERENCES, LIBRARY_MAX_TASKS, libraryId, libraryInteger, libraryObject, libraryStrings, libraryText, referenceTypes, libraryTaskKinds } from "../domain/workbench.js";
import { libraryArray, libraryHash } from "../domain/workbenchValidation.js";
import { researchRequest } from "./peerClient.js";

export function workbenchId(prefix: "ref" | "ev" | "task" | "ms" | "col" | "search"): string {
  // randomUUID is secure-context-only; getRandomValues also works on trusted LAN HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid server response");
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string { return libraryText(value, 2 * 1024 * 1024); }
export function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error("Invalid or oversized server list");
  return value.map(decode);
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  const match = values.find(item => item === value);
  if (match === undefined) throw new Error("Unexpected server value");
  return match;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("Invalid server boolean"); return value; }
function boundedJson(value: unknown, maxBytes: number): void {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) throw new Error("Oversized server response");
}
export function page<T>(decode: (item: unknown) => T): (value: unknown) => LibraryPage<T> {
  return value => {
    boundedJson(value, 192 * 1024);
    const r = object(value);
    if (!Array.isArray(r["items"]) || r["items"].length > 25) throw new Error("Invalid or oversized server page");
    return { items: list(r["items"], decode), total: libraryInteger(r["total"]), nextOffset: r["nextOffset"] === null ? null : libraryInteger(r["nextOffset"]) };
  };
}
export function fields(value: unknown): ReferenceFields {
  const r = object(value);
  return {
    type: choice(r["type"], referenceTypes), citekey: text(r["citekey"]), title: libraryText(r["title"], 1000), authors: libraryStrings(r["authors"]),
    year: r["year"] === null ? null : libraryInteger(r["year"], 0, 9999), containerTitle: libraryText(r["containerTitle"], 1000), volume: text(r["volume"]), issue: text(r["issue"]), pages: text(r["pages"]), publisher: text(r["publisher"]), doi: text(r["doi"]), isbn: text(r["isbn"]), url: text(r["url"]), abstract: libraryText(r["abstract"], 16_000), language: text(r["language"]),
    tags: libraryStrings(r["tags"]), collectionIds: libraryStrings(r["collectionIds"], 1000, 80), readingStatus: choice(r["readingStatus"], ["inbox", "reading", "read"]), screening: choice(r["screening"], ["unscreened", "included", "excluded"]), screeningReason: text(r["screeningReason"]), favorite: boolean(r["favorite"]), notes: libraryText(r["notes"], 32_000),
  };
}
export function document(value: unknown): LibraryDocument {
  const r = object(value);
  return { id: libraryId(r["id"], "doc"), path: text(r["path"]), sha256: text(r["sha256"]), size: libraryInteger(r["size"], 0, 128 * 1024 * 1024), label: text(r["label"]), sourceUrl: text(r["sourceUrl"]), rights: text(r["rights"]), addedAt: text(r["addedAt"]) };
}
function identity(r: Record<string, unknown>) { return { id: libraryId(r["id"]), revision: libraryInteger(r["revision"], 1), createdAt: text(r["createdAt"]), updatedAt: text(r["updatedAt"]) }; }
export function reference(value: unknown): LibraryReference {
  const r = object(value);
  return { ...fields(r), ...identity(r), deletedAt: nullableText(r["deletedAt"]), documents: list(r["documents"], document), aliases: libraryStrings(r["aliases"]), provenance: libraryStrings(r["provenance"], 100, 4000) };
}
export function collection(value: unknown): LibraryCollection {
  const r = object(value); return { id: libraryId(r["id"], "col"), revision: libraryInteger(r["revision"], 1), name: text(r["name"]), parentId: r["parentId"] === null ? null : libraryId(r["parentId"], "col") };
}
export function evidence(value: unknown): LibraryEvidence {
  const r = object(value); const rect = r["rect"] === null ? null : object(r["rect"]);
  function fraction(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid evidence rectangle"); return value; }
  return { ...identity(r), referenceId: libraryId(r["referenceId"], "ref"), documentId: r["documentId"] === null ? null : libraryId(r["documentId"], "doc"), pdfSha256: nullableText(r["pdfSha256"]), page: r["page"] === null ? null : libraryInteger(r["page"], 1), rect: rect === null ? null : { x: fraction(rect["x"]), y: fraction(rect["y"]), width: fraction(rect["width"]), height: fraction(rect["height"]) }, quote: libraryText(r["quote"], 16_000), body: libraryText(r["body"], 16_000), kind: choice(r["kind"], ["quote", "note", "question"]), status: choice(r["status"], ["open", "resolved"]), tags: libraryStrings(r["tags"]), deletedAt: nullableText(r["deletedAt"]) };
}
export function task(value: unknown): LibraryTask {
  const r = object(value);
  boundedJson(r["result"], 128 * 1024);
  const resultValue = r["result"] === null ? null : object(r["result"]);
  const result: LibraryResearchResult | null = resultValue === null ? null : {
    markdown: text(resultValue["markdown"]), warnings: libraryStrings(resultValue["warnings"], 100, 4000),
    claims: list(resultValue["claims"], item => { const c = object(item); return { id: text(c["id"]), text: text(c["text"]), referenceIds: libraryStrings(c["referenceIds"]), evidenceIds: libraryStrings(c["evidenceIds"]), relationship: choice(c["relationship"], ["supports", "contrasts", "context", "uncertain"]) }; }),
    cells: list(resultValue["cells"], item => { const c = object(item); return { referenceId: libraryId(c["referenceId"], "ref"), column: text(c["column"]), value: text(c["value"]), evidenceIds: libraryStrings(c["evidenceIds"]) }; }),
  };
  return { ...identity(r), kind: choice(r["kind"], libraryTaskKinds), goal: libraryText(r["goal"], 8000), referenceIds: libraryStrings(r["referenceIds"]), corpusHash: text(r["corpusHash"]), sessionId: text(r["sessionId"]), status: choice(r["status"], ["starting", "running", "completed", "failed", "cancelled", "interrupted"]), message: text(r["message"]), result, review: choice(r["review"], ["unreviewed", "accepted", "rejected"]), reviewedAt: nullableText(r["reviewedAt"]),
    corpus: list(r["corpus"], item => { const c = object(item); return { referenceId: libraryId(c["referenceId"], "ref"), revision: libraryInteger(c["revision"], 1), documentHashes: libraryArray(c["documentHashes"], 16, libraryHash), evidence: list(c["evidence"], item => { const e = object(item); return { id: libraryId(e["id"], "ev"), revision: libraryInteger(e["revision"], 1) }; }) }; }),
  };
}
export function manuscript(value: unknown): LibraryManuscript {
  const r = object(value); return { ...identity(r), title: text(r["title"]), markdown: libraryText(r["markdown"], 128_000), referenceIds: libraryStrings(r["referenceIds"], LIBRARY_MAX_REFERENCES, 80), taskIds: libraryStrings(r["taskIds"], LIBRARY_MAX_TASKS, 80), style: choice(r["style"], ["apa", "vancouver", "harvard1"]), deletedAt: nullableText(r["deletedAt"]) };
}
export function textHit(value: unknown): LibraryTextHit {
  const r = object(value); return { referenceId: libraryId(r["referenceId"], "ref"), documentId: libraryId(r["documentId"], "doc"), pdfSha256: text(r["pdfSha256"]), page: libraryInteger(r["page"], 1), excerpt: text(r["excerpt"]) };
}
export function download(value: unknown): { text: string; filename: string; mime: string } {
  const r = libraryObject(value, ["text", "filename", "mime"]); return { text: text(r["text"]), filename: text(r["filename"]), mime: text(r["mime"]) };
}
export function workbenchContextKey(context: WorkspacePanelContext): string {
  return JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id, context.workspace.path]);
}
/** One authority lifetime. Host render updates may replace peer wrappers without
 * changing authority; subsequent calls use the latest public binding. */
export class WorkbenchClient {
  private readonly abort = new AbortController();
  private readonly authority: string;
  constructor(private binding: WorkspacePanelContext) { this.authority = workbenchContextKey(binding); }
  get context(): WorkspacePanelContext { return this.binding; }
  get signal(): AbortSignal { return this.abort.signal; }
  rebind(context: WorkspacePanelContext): void {
    if (workbenchContextKey(context) !== this.authority) throw new Error("Cannot rebind a client to different workspace authority");
    this.binding = context;
  }
  dispose(): void { this.abort.abort(); }
  private assertActive(): void {
    this.signal.throwIfAborted();
    if (workbenchContextKey(this.binding) !== this.authority) throw new Error("Workspace authority changed; refresh the panel");
  }
  async request<T>(operation: string, payload: unknown, decode: (value: unknown) => T): Promise<T> {
    this.assertActive();
    const result = await researchRequest(this.context.peer, operation, payload, this.signal);
    this.assertActive();
    return decode(result);
  }
}
