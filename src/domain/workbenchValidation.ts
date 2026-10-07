import {
  LIBRARY_MAX_BYTES, LIBRARY_MAX_EVIDENCE, LIBRARY_MAX_MANUSCRIPTS, LIBRARY_MAX_PDF_BYTES, LIBRARY_MAX_REFERENCES,
  LIBRARY_MAX_TASKS, LIBRARY_VERSION, libraryId, libraryInteger, libraryObject, libraryPath,
  libraryStrings, libraryTaskKinds, libraryText, referenceTypes,
  type CorpusBinding, type LibraryCollection, type LibraryDocument, type LibraryEvidence,
  type LibraryManuscript, type LibraryReference, type LibraryResearchResult, type LibraryState,
  type LibraryTask, type ReferenceFields, type ResearchCell, type ResearchClaim, type SavedLibrarySearch,
} from "./workbench.js";
import { assertResultAttribution } from "./workbenchResearchProtocol.js";
import type { PdfRect } from "./pdf.js";

export function libraryEnum<T extends string>(value: unknown, values: readonly T[]): T {
  const found = values.find(item => item === value);
  if (found === undefined) throw new Error("Invalid library enum value");
  return found;
}
export function libraryBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid library boolean");
  return value;
}
export function libraryHash(value: unknown): string {
  const hash = libraryText(value, 64, false);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid library SHA-256");
  return hash;
}
export function libraryTimestamp(value: unknown): string {
  const text = libraryText(value, 24, false);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) throw new Error("Invalid library timestamp");
  return text;
}
export function libraryIds(value: unknown, prefix: string, max: number): string[] {
  return libraryStrings(value, max, 80).map(id => libraryId(id, prefix));
}
export function libraryArray<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid or oversized library array");
  return value.map(item => parse(item));
}
export function libraryCitekey(value: unknown): string {
  const key = libraryText(value, 128, false);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:+-]*$/u.test(key)) throw new Error("Invalid citation key");
  return key;
}
export function libraryUrl(value: unknown): string {
  const text = libraryText(value, 2048);
  if (text === "") return text;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("Invalid reference URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") throw new Error("Expected an HTTP(S) URL without credentials");
  return text;
}
const fieldKeys = ["type", "citekey", "title", "authors", "year", "containerTitle", "volume", "issue", "pages", "publisher", "doi", "isbn", "url", "abstract", "language", "tags", "collectionIds", "readingStatus", "screening", "screeningReason", "favorite", "notes"];
function referenceFields(input: Record<string, unknown>): ReferenceFields {
  return {
    type: libraryEnum(input["type"], referenceTypes), citekey: libraryCitekey(input["citekey"]),
    title: libraryText(input["title"], 1000, false), authors: libraryStrings(input["authors"], 100, 256),
    year: input["year"] === null ? null : libraryInteger(input["year"], 1, 9999),
    containerTitle: libraryText(input["containerTitle"], 1000), volume: libraryText(input["volume"], 256),
    issue: libraryText(input["issue"], 256), pages: libraryText(input["pages"], 256), publisher: libraryText(input["publisher"], 1000),
    doi: libraryText(input["doi"], 512), isbn: libraryText(input["isbn"], 128), url: libraryUrl(input["url"]),
    abstract: libraryText(input["abstract"], 16000), language: libraryText(input["language"], 128),
    tags: libraryStrings(input["tags"], 100, 256), collectionIds: libraryIds(input["collectionIds"], "col", 1000),
    readingStatus: libraryEnum(input["readingStatus"], ["inbox", "reading", "read"]),
    screening: libraryEnum(input["screening"], ["unscreened", "included", "excluded"]),
    screeningReason: libraryText(input["screeningReason"], 4000), favorite: libraryBoolean(input["favorite"]), notes: libraryText(input["notes"], 32000),
  };
}
export function validateReferenceFields(value: unknown): ReferenceFields {
  return referenceFields(libraryObject(value, fieldKeys));
}
export function validateLibraryDocument(value: unknown): LibraryDocument {
  const v = libraryObject(value, ["id", "path", "sha256", "size", "label", "sourceUrl", "rights", "addedAt"]);
  return { id: libraryId(v["id"], "doc"), path: libraryPath(v["path"]), sha256: libraryHash(v["sha256"]),
    size: libraryInteger(v["size"], 5, LIBRARY_MAX_PDF_BYTES), label: libraryText(v["label"], 1000, false),
    sourceUrl: libraryUrl(v["sourceUrl"]), rights: libraryText(v["rights"], 4000), addedAt: libraryTimestamp(v["addedAt"]) };
}
function dated(v: Record<string, unknown>): { createdAt: string; updatedAt: string; deletedAt: string | null } {
  const createdAt = libraryTimestamp(v["createdAt"]); const updatedAt = libraryTimestamp(v["updatedAt"]);
  const deletedAt = v["deletedAt"] === null ? null : libraryTimestamp(v["deletedAt"]);
  if (updatedAt < createdAt || (deletedAt !== null && (deletedAt < createdAt || deletedAt > updatedAt))) throw new Error("Inconsistent library timestamps");
  return { createdAt, updatedAt, deletedAt };
}
function boundedEntity<T>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 190 * 1024) throw new Error("Library entity exceeds 190KiB; reduce content before saving");
  return value;
}
export function validateLibraryReference(value: unknown): LibraryReference {
  const v = libraryObject(value, [...fieldKeys, "id", "revision", "createdAt", "updatedAt", "deletedAt", "documents", "aliases", "provenance"]);
  const documents = libraryArray(v["documents"], 16, validateLibraryDocument); uniqueIds(documents);
  const aliases = libraryStrings(v["aliases"], 100, 128).map(libraryCitekey);
  const fields = referenceFields(v);
  if (aliases.includes(fields.citekey)) throw new Error("Citation key is also an alias");
  return boundedEntity({ ...fields, id: libraryId(v["id"], "ref"), revision: libraryInteger(v["revision"], 1), ...dated(v), documents, aliases,
    provenance: libraryStrings(v["provenance"], 100, 2048) });
}
export function validateLibraryCollection(value: unknown): LibraryCollection {
  const v = libraryObject(value, ["id", "name", "parentId", "revision"]);
  return { id: libraryId(v["id"], "col"), name: libraryText(v["name"], 256, false), parentId: v["parentId"] === null ? null : libraryId(v["parentId"], "col"), revision: libraryInteger(v["revision"], 1) };
}
export function validateLibraryRect(value: unknown): PdfRect {
  const v = libraryObject(value, ["x", "y", "width", "height"]);
  const fraction = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid page rectangle");
    return value;
  };
  const rect = { x: fraction(v["x"]), y: fraction(v["y"]), width: fraction(v["width"]), height: fraction(v["height"]) };
  if (rect.width === 0 || rect.height === 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw new Error("Rectangle is outside the page");
  return rect;
}
export function validateLibraryEvidence(value: unknown): LibraryEvidence {
  const v = libraryObject(value, ["id", "revision", "referenceId", "documentId", "pdfSha256", "page", "rect", "quote", "body", "kind", "status", "tags", "createdAt", "updatedAt", "deletedAt"]);
  const documentId = v["documentId"] === null ? null : libraryId(v["documentId"], "doc");
  const pdfSha256 = v["pdfSha256"] === null ? null : libraryHash(v["pdfSha256"]);
  const page = v["page"] === null ? null : libraryInteger(v["page"], 1, 10000);
  const rect = v["rect"] === null ? null : validateLibraryRect(v["rect"]);
  if (documentId === null ? (pdfSha256 !== null || page !== null || rect !== null) : (pdfSha256 === null || page === null)) throw new Error("Incomplete evidence anchor");
  return boundedEntity<LibraryEvidence>({ id: libraryId(v["id"], "ev"), revision: libraryInteger(v["revision"], 1), referenceId: libraryId(v["referenceId"], "ref"),
    documentId, pdfSha256, page, rect, quote: libraryText(v["quote"], 16000), body: libraryText(v["body"], 16000),
    kind: libraryEnum(v["kind"], ["quote", "note", "question"]), status: libraryEnum(v["status"], ["open", "resolved"]),
    tags: libraryStrings(v["tags"], 100, 256), ...dated(v) });
}
function corpusBinding(value: unknown): CorpusBinding {
  const v = libraryObject(value, ["referenceId", "revision", "documentHashes", "evidence"]);
  const evidence = libraryArray(v["evidence"], LIBRARY_MAX_EVIDENCE, item => {
    const e = libraryObject(item, ["id", "revision"]);
    return { id: libraryId(e["id"], "ev"), revision: libraryInteger(e["revision"], 1) };
  }); uniqueIds(evidence);
  return { referenceId: libraryId(v["referenceId"], "ref"), revision: libraryInteger(v["revision"], 1),
    documentHashes: libraryArray(v["documentHashes"], 16, libraryHash), evidence };
}
function researchClaim(value: unknown): ResearchClaim {
  const v = libraryObject(value, ["id", "text", "referenceIds", "evidenceIds", "relationship"]);
  return { id: libraryText(v["id"], 128, false), text: libraryText(v["text"], 4000, false),
    referenceIds: libraryIds(v["referenceIds"], "ref", 20), evidenceIds: libraryIds(v["evidenceIds"], "ev", 100),
    relationship: libraryEnum(v["relationship"], ["supports", "contrasts", "context", "uncertain"]) };
}
function researchCell(value: unknown): ResearchCell {
  const v = libraryObject(value, ["referenceId", "column", "value", "evidenceIds"]);
  return { referenceId: libraryId(v["referenceId"], "ref"), column: libraryText(v["column"], 256, false),
    value: libraryText(v["value"], 4000), evidenceIds: libraryIds(v["evidenceIds"], "ev", 100) };
}
export function validateLibraryResearchResult(value: unknown): LibraryResearchResult {
  const v = libraryObject(value, ["markdown", "claims", "cells", "warnings"]);
  const result = { markdown: libraryText(v["markdown"], 64000), claims: libraryArray(v["claims"], 100, researchClaim),
    cells: libraryArray(v["cells"], 500, researchCell), warnings: libraryStrings(v["warnings"], 100, 1000) };
  uniqueIds(result.claims);
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128 * 1024) throw new Error("Research result exceeds 128KiB");
  return result;
}
export function validateLibraryTask(value: unknown): LibraryTask {
  const v = libraryObject(value, ["id", "revision", "kind", "goal", "referenceIds", "corpus", "corpusHash", "createdAt", "updatedAt", "sessionId", "status", "message", "result", "review", "reviewedAt"]);
  const createdAt = libraryTimestamp(v["createdAt"]); const updatedAt = libraryTimestamp(v["updatedAt"]);
  const reviewedAt = v["reviewedAt"] === null ? null : libraryTimestamp(v["reviewedAt"]);
  const result = v["result"] === null ? null : validateLibraryResearchResult(v["result"]);
  const status = libraryEnum(v["status"], ["starting", "running", "completed", "failed", "cancelled", "interrupted"]);
  const review = libraryEnum(v["review"], ["unreviewed", "accepted", "rejected"]);
  if (updatedAt < createdAt || (reviewedAt !== null && (reviewedAt < createdAt || reviewedAt > updatedAt))) throw new Error("Inconsistent task timestamps");
  if ((review === "unreviewed") !== (reviewedAt === null) || (review !== "unreviewed" && (result === null || status !== "completed"))) throw new Error("Invalid task review");
  const referenceIds = libraryIds(v["referenceIds"], "ref", 20);
  const corpus = libraryArray(v["corpus"], 20, corpusBinding);
  if (new Set(corpus.map(c => c.referenceId)).size !== corpus.length || corpus.length !== referenceIds.length || corpus.some(c => !referenceIds.includes(c.referenceId))) throw new Error("Task corpus does not match references");
  if (result !== null) assertResultAttribution(result, corpus);
  return boundedEntity<LibraryTask>({ id: libraryId(v["id"], "task"), revision: libraryInteger(v["revision"], 1), kind: libraryEnum(v["kind"], libraryTaskKinds),
    goal: libraryText(v["goal"], 8000, false), referenceIds, corpus, corpusHash: libraryHash(v["corpusHash"]), createdAt, updatedAt,
    sessionId: libraryText(v["sessionId"], 512), status, message: libraryText(v["message"], 4000), result, review, reviewedAt });
}
export function validateLibraryManuscript(value: unknown): LibraryManuscript {
  const v = libraryObject(value, ["id", "revision", "title", "markdown", "referenceIds", "taskIds", "style", "createdAt", "updatedAt", "deletedAt"]);
  return boundedEntity<LibraryManuscript>({ id: libraryId(v["id"], "ms"), revision: libraryInteger(v["revision"], 1), title: libraryText(v["title"], 1000, false),
    markdown: libraryText(v["markdown"], 128000), referenceIds: libraryIds(v["referenceIds"], "ref", LIBRARY_MAX_REFERENCES),
    taskIds: libraryIds(v["taskIds"], "task", LIBRARY_MAX_TASKS), style: libraryEnum(v["style"], ["apa", "vancouver", "harvard1"]), ...dated(v) });
}
function savedSearch(value: unknown): SavedLibrarySearch {
  const v = libraryObject(value, ["id", "name", "query", "provider", "checkedAt"]);
  return { id: libraryId(v["id"], "search"), name: libraryText(v["name"], 256, false), query: libraryText(v["query"], 4000, false),
    provider: libraryEnum(v["provider"], ["local", "crossref", "openalex"]), checkedAt: v["checkedAt"] === null ? null : libraryTimestamp(v["checkedAt"]) };
}
function uniqueIds(values: { id: string }[]): void {
  if (new Set(values.map(value => value.id)).size !== values.length) throw new Error("Duplicate library identity");
}
/** Parse every nested entity, retaining all supported content; unknown fields fail closed. */
export function validateWorkbenchState(value: unknown): LibraryState {
  const v = libraryObject(value, ["version", "revision", "references", "collections", "evidence", "tasks", "manuscripts", "savedSearches"]);
  if (v["version"] !== LIBRARY_VERSION) throw new Error("Unsupported library version");
  const state: LibraryState = { version: LIBRARY_VERSION, revision: libraryInteger(v["revision"]),
    references: libraryArray(v["references"], LIBRARY_MAX_REFERENCES, validateLibraryReference),
    collections: libraryArray(v["collections"], 1000, validateLibraryCollection), evidence: libraryArray(v["evidence"], LIBRARY_MAX_EVIDENCE, validateLibraryEvidence),
    tasks: libraryArray(v["tasks"], LIBRARY_MAX_TASKS, validateLibraryTask), manuscripts: libraryArray(v["manuscripts"], LIBRARY_MAX_MANUSCRIPTS, validateLibraryManuscript),
    savedSearches: libraryArray(v["savedSearches"], 100, savedSearch) };
  for (const entities of [state.references, state.collections, state.evidence, state.tasks, state.manuscripts, state.savedSearches]) uniqueIds(entities);
  validateLinks(state);
  if (new TextEncoder().encode(JSON.stringify(state)).length > LIBRARY_MAX_BYTES) throw new Error("Library state exceeds 16MiB");
  return state;
}
function validateLinks(state: LibraryState): void {
  const refs = new Map(state.references.map(r => [r.id, r]));
  const collections = new Map(state.collections.map(c => [c.id, c]));
  const evidence = new Map(state.evidence.map(e => [e.id, e]));
  const tasks = new Set(state.tasks.map(t => t.id));
  const keys = new Set<string>();
  for (const ref of state.references) {
    if (ref.collectionIds.some(id => !collections.has(id))) throw new Error("Unknown reference collection");
    if (ref.deletedAt === null) for (const key of [ref.citekey, ...ref.aliases]) {
      if (keys.has(key)) throw new Error("Citation key or alias collision");
      keys.add(key);
    }
  }
  const names = new Set<string>();
  for (const collection of state.collections) {
    const name = JSON.stringify([collection.parentId, collection.name.trim().toLowerCase()]);
    if (names.has(name)) throw new Error("Duplicate collection name"); names.add(name);
    let parent: string | null = collection.parentId; const seen = new Set([collection.id]);
    while (parent !== null) {
      if (seen.has(parent)) throw new Error("Collection cycle"); seen.add(parent);
      const item = collections.get(parent); if (item === undefined) throw new Error("Unknown parent collection"); parent = item.parentId;
    }
  }
  for (const item of state.evidence) {
    const ref = refs.get(item.referenceId); if (ref === undefined) throw new Error("Unknown evidence reference");
    if (item.documentId !== null) {
      const doc = ref.documents.find(d => d.id === item.documentId);
      if (doc?.sha256 !== item.pdfSha256) throw new Error("Evidence PDF identity mismatch");
    }
  }
  for (const task of state.tasks) for (const binding of task.corpus) {
    const ref = refs.get(binding.referenceId);
    if (ref === undefined || ref.revision < binding.revision || binding.documentHashes.some(hash => !ref.documents.some(d => d.sha256 === hash))) throw new Error("Invalid frozen reference binding");
    for (const item of binding.evidence) {
      const ev = evidence.get(item.id);
      if (ev?.referenceId !== ref.id || ev.revision < item.revision) throw new Error("Invalid frozen evidence binding");
    }
  }
  for (const manuscript of state.manuscripts) {
    if (manuscript.referenceIds.some(id => !refs.has(id)) || manuscript.taskIds.some(id => !tasks.has(id))) throw new Error("Unknown manuscript source");
  }
}
