import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import {
  LIBRARY_MAX_PDF_BYTES, LIBRARY_MAX_REFERENCES, libraryId, libraryInteger, libraryObject,
  libraryPage, libraryPath, libraryText, type BibliographyCodec, type BibliographyFormat, type LibraryDocument,
  type LibraryReference, type LibraryRepository, type LibraryState, type ReferenceFields,
} from "../domain/workbench.js";
import { libraryBoolean, libraryEnum, libraryIds, libraryUrl, validateLibraryCollection, validateReferenceFields } from "../domain/workbenchValidation.js";
import { openWorkbenchFile, workbenchPath } from "./workbenchFiles.js";

const formats = ["bibtex", "ris", "csl-json"] as const;
const importLimit = 1024 * 1024;
function sha(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function revision(value: unknown): number { return libraryInteger(value, 0); }
function refById(state: LibraryState, id: string): LibraryReference {
  const ref = state.references.find(ref => ref.id === id);
  if (ref === undefined) throw new Error("Reference not found"); return ref;
}
function requireRevision(ref: { revision: number }, expected: number): void {
  if (ref.revision !== expected) throw new Error("Stale library revision; reload before editing");
}
function touch(ref: LibraryReference): void { ref.revision += 1; ref.updatedAt = new Date().toISOString(); }
function fieldsOf(ref: LibraryReference): ReferenceFields {
  return validateReferenceFields(Object.fromEntries(Object.entries(ref).filter(([key]) => !["id", "revision", "createdAt", "updatedAt", "deletedAt", "documents", "aliases", "provenance"].includes(key))));
}
function sameFields(left: ReferenceFields, right: ReferenceFields): boolean { return JSON.stringify(validateReferenceFields(left)) === JSON.stringify(validateReferenceFields(right)); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function checkKeys(state: LibraryState, candidate: Pick<LibraryReference, "id" | "citekey" | "aliases">, ignore: string[] = []): void {
  const keys = new Set([candidate.citekey, ...candidate.aliases]);
  if (state.references.some(ref => ref.deletedAt === null && ref.id !== candidate.id && !ignore.includes(ref.id) && [ref.citekey, ...ref.aliases].some(key => keys.has(key)))) throw new Error("Citation key or alias is already in use");
}
function checkCollections(state: LibraryState, fields: ReferenceFields): void {
  if (fields.collectionIds.some(id => !state.collections.some(c => c.id === id))) throw new Error("Unknown reference collection");
}
function newReference(id: string, fields: ReferenceFields, provenance: string[] = []): LibraryReference {
  const now = new Date().toISOString();
  return { ...fields, id, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, documents: [], aliases: [], provenance };
}
function normalizeTitle(title: string): string { return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function doiKey(doi: string): string { return doi.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "").replace(/^doi:\s*/u, ""); }
function duplicateKeys(ref: ReferenceFields): { key: string; reason: string }[] {
  const keys: { key: string; reason: string }[] = [];
  const doi = doiKey(ref.doi); const isbn = ref.isbn.replace(/[-\s]/gu, ""); const title = normalizeTitle(ref.title);
  if (doi !== "") keys.push({ key: `doi:${doi}`, reason: "Same DOI" });
  if (isbn !== "") keys.push({ key: `isbn:${isbn}`, reason: "Same ISBN" });
  if (title !== "") keys.push({ key: `title:${String(ref.year)}:${title}`, reason: "Same normalized title and year" });
  return keys;
}
function duplicateIndex(refs: LibraryReference[]): Map<string, LibraryReference[]> {
  const index = new Map<string, LibraryReference[]>();
  for (const ref of refs) for (const { key } of duplicateKeys(ref)) {
    const entries = index.get(key) ?? []; entries.push(ref); index.set(key, entries);
  }
  return index;
}
function duplicateMatches(field: ReferenceFields, index: Map<string, LibraryReference[]>): { referenceId: string; reason: string }[] {
  const found = new Map<string, string>();
  for (const { key, reason } of duplicateKeys(field)) for (const ref of index.get(key) ?? []) {
    if (!found.has(ref.id)) found.set(ref.id, reason);
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b)).map(([referenceId, reason]) => ({ referenceId, reason }));
}
function boundedPage<T>(items: T[], offset: number): { items: T[]; total: number; nextOffset: number | null } {
  const page = libraryPage(items, offset); const selected: T[] = []; let bytes = 128;
  for (const item of page.items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes + size > 192 * 1024) {
      if (selected.length === 0) throw new Error("Library record exceeds response budget; export a smaller selection");
      break;
    }
    selected.push(item); bytes += size;
  }
  return { items: selected, total: items.length, nextOffset: offset + selected.length < items.length ? offset + selected.length : null };
}

export class LibraryCatalog {
  constructor(private readonly store: LibraryRepository, private readonly codec: BibliographyCodec) {}
  async handle(root: string, operation: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    switch (operation) {
      case "library.list": return this.list(root, input, signal);
      case "library.get": {
        const v = libraryObject(input, ["id"]); const id = libraryId(v["id"], "ref");
        return refById(await this.store.read(root, signal), id);
      }
      case "library.save": return this.save(root, input, signal);
      case "library.delete": case "library.restore": return this.trash(root, input, operation === "library.delete", signal);
      case "library.duplicates": {
        libraryObject(input, []); const state = await this.store.read(root, signal);
        const refs = state.references.filter(r => r.deletedAt === null).sort((a, b) => a.id.localeCompare(b.id));
        const pairs: { leftId: string; rightId: string; reason: string }[] = [];
        const index = duplicateIndex(refs);
        for (const left of refs) {
          signal.throwIfAborted();
          for (const match of duplicateMatches(left, index)) {
            if (left.id.localeCompare(match.referenceId) >= 0) continue;
            pairs.push({ leftId: left.id, rightId: match.referenceId, reason: match.reason });
            if (pairs.length === 100) return { pairs };
          }
        }
        return { pairs };
      }
      case "library.merge": return this.merge(root, input, signal);
      case "library.import.preview": case "library.import.commit": return this.import(root, input, operation === "library.import.commit", signal);
      case "library.export": return this.export(root, input, signal);
      case "library.attach": return this.attach(root, input, signal);
      case "collections.list": {
        libraryObject(input, []); const state = await this.store.read(root, signal);
        return state.collections.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      }
      case "collections.save": return this.saveCollection(root, input, signal);
      case "collections.delete": return this.deleteCollection(root, input, signal);
      default: throw new Error("Unsupported library catalog operation");
    }
  }
  private async list(root: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const v = libraryObject(input, [], ["query", "offset", "collectionId", "tag", "readingStatus", "screening", "favorite", "trash"]);
    const query = v["query"] === undefined ? "" : libraryText(v["query"], 1000).trim().toLowerCase();
    const offset = v["offset"] === undefined ? 0 : libraryInteger(v["offset"], 0, LIBRARY_MAX_REFERENCES);
    const collection = v["collectionId"] === undefined ? undefined : libraryId(v["collectionId"], "col");
    const tag = v["tag"] === undefined ? undefined : libraryText(v["tag"], 256, false);
    const reading = v["readingStatus"] === undefined ? undefined : libraryEnum(v["readingStatus"], ["inbox", "reading", "read"]);
    const screening = v["screening"] === undefined ? undefined : libraryEnum(v["screening"], ["unscreened", "included", "excluded"]);
    const favorite = v["favorite"] === undefined ? undefined : libraryBoolean(v["favorite"]);
    const trash = v["trash"] === undefined ? false : libraryBoolean(v["trash"]);
    const state = await this.store.read(root, signal);
    const items = state.references.filter(ref => (ref.deletedAt !== null) === trash
      && (collection === undefined || ref.collectionIds.includes(collection)) && (tag === undefined || ref.tags.includes(tag))
      && (reading === undefined || ref.readingStatus === reading) && (screening === undefined || ref.screening === screening)
      && (favorite === undefined || ref.favorite === favorite)
      && (query === "" || [ref.title, ...ref.authors, ref.citekey, ...ref.aliases, ref.doi, ref.isbn, ref.containerTitle, ref.abstract, ref.notes, ...ref.tags, String(ref.year ?? "")].join("\n").toLowerCase().includes(query)))
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return boundedPage(items, offset);
  }
  private save(root: string, input: unknown, signal: AbortSignal): Promise<LibraryReference> {
    const v = libraryObject(input, ["id", "expectedRevision", "fields"]);
    const id = libraryId(v["id"], "ref"); const expected = revision(v["expectedRevision"]); const fields = validateReferenceFields(v["fields"]);
    return this.store.update(root, state => {
      const existing = state.references.find(r => r.id === id);
      checkCollections(state, fields);
      if (expected === 0) {
        if (existing !== undefined) {
          if (existing.deletedAt === null && existing.revision === 1 && sameFields(fieldsOf(existing), fields)) return existing;
          throw new Error("Reference ID already exists with different content or history");
        }
        if (state.references.length >= LIBRARY_MAX_REFERENCES) throw new Error("Library reference limit reached");
        const created = newReference(id, fields); checkKeys(state, created); state.references.push(created); return created;
      }
      if (existing?.deletedAt !== null) throw new Error("Active reference not found");
      requireRevision(existing, expected);
      const aliases = unique([...existing.aliases, ...(existing.citekey !== fields.citekey ? [existing.citekey] : [])]).filter(key => key !== fields.citekey);
      checkKeys(state, { id, citekey: fields.citekey, aliases });
      Object.assign(existing, fields, { aliases }); touch(existing); return existing;
    }, signal);
  }
  private trash(root: string, input: unknown, deleted: boolean, signal: AbortSignal): Promise<LibraryReference> {
    const v = libraryObject(input, ["id", "expectedRevision"]); const id = libraryId(v["id"], "ref"); const expected = revision(v["expectedRevision"]);
    return this.store.update(root, state => {
      const ref = refById(state, id); requireRevision(ref, expected);
      if ((ref.deletedAt !== null) === deleted) return ref;
      if (!deleted) checkKeys(state, ref);
      touch(ref); ref.deletedAt = deleted ? ref.updatedAt : null; return ref;
    }, signal);
  }
  private merge(root: string, input: unknown, signal: AbortSignal): Promise<LibraryReference> {
    const v = libraryObject(input, ["keepId", "removeId", "keepRevision", "removeRevision"]);
    const keepId = libraryId(v["keepId"], "ref"); const removeId = libraryId(v["removeId"], "ref");
    const keepRevision = revision(v["keepRevision"]); const removeRevision = revision(v["removeRevision"]);
    if (keepId === removeId) throw new Error("Cannot merge a reference into itself");
    return this.store.update(root, state => {
      const keep = refById(state, keepId); const remove = refById(state, removeId);
      requireRevision(keep, keepRevision); requireRevision(remove, removeRevision);
      if (keep.deletedAt !== null || remove.deletedAt !== null) throw new Error("Only active references can merge");
      if (state.evidence.some(item => item.referenceId === removeId && item.deletedAt === null)) throw new Error("Cannot merge a reference with active evidence into another reference; keep both references to preserve evidence and PDF backlinks.");
      const documents = [...keep.documents];
      for (const document of remove.documents) {
        const existing = documents.find(d => d.id === document.id);
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(document)) throw new Error("Conflicting document identity; merge cannot preserve evidence safely");
        if (existing === undefined) documents.push(document);
      }
      if (documents.length > 16) throw new Error("Merged reference would exceed 16 documents");
      const aliases = unique([...keep.aliases, remove.citekey, ...remove.aliases]).filter(key => key !== keep.citekey);
      checkKeys(state, { id: keepId, citekey: keep.citekey, aliases }, [removeId]);
      const notes = remove.notes === "" || remove.notes === keep.notes ? keep.notes : [keep.notes, `Merged notes (${remove.citekey}):\n${remove.notes}`].filter(Boolean).join("\n\n");
      // The retained loser preserves all original metadata and immutable evidence attribution.
      Object.assign(keep, { documents, aliases, notes, tags: unique([...keep.tags, ...remove.tags]),
        collectionIds: unique([...keep.collectionIds, ...remove.collectionIds]), provenance: unique([...keep.provenance, ...remove.provenance, `merge:${remove.id}`]) });
      validateReferenceFields(fieldsOf(keep));
      touch(keep); touch(remove); remove.deletedAt = remove.updatedAt; return keep;
    }, signal);
  }
  private async import(root: string, input: unknown, commit: boolean, signal: AbortSignal): Promise<unknown> {
    const v = libraryObject(input, commit ? ["format", "text", "indices"] : ["format", "text"]);
    const format = libraryEnum(v["format"], formats); const text = libraryText(v["text"], importLimit, false);
    if (Buffer.byteLength(text) > importLimit) throw new Error("Import exceeds 1MiB");
    const fingerprint = sha(`${format}\n${text}`); const parsed = this.codec.parse(text, format);
    if (parsed.references.length > LIBRARY_MAX_REFERENCES) throw new Error("Too many imported references");
    const fields = parsed.references.map(validateReferenceFields);
    const warnings = parsed.warnings.map(w => libraryText(w, 4000));
    if (warnings.length > 1000) throw new Error("Too many import warnings");
    signal.throwIfAborted();
    if (!commit) {
      const state = await this.store.read(root, signal);
      const duplicateCandidates: { index: number; referenceId: string; reason: string }[] = [];
      const active = state.references.filter(ref => ref.deletedAt === null);
      const duplicateLookup = duplicateIndex(active); const usedKeys = new Set(active.flatMap(ref => [ref.citekey, ...ref.aliases]));
      let candidatesLimited = false;
      for (const [index, field] of fields.entries()) {
        signal.throwIfAborted();
        const matches = duplicateCandidates.length < 100 ? duplicateMatches(field, duplicateLookup) : [];
        if (matches.length + duplicateCandidates.length >= 100) candidatesLimited = true;
        for (const match of matches.slice(0, Math.max(0, 100 - duplicateCandidates.length))) duplicateCandidates.push({ index, ...match });
        if (usedKeys.has(field.citekey)) warnings.push(`Row ${String(index + 1)}: citation key collision will receive a deterministic suffix on import.`);
        usedKeys.add(field.citekey);
      }
      if (candidatesLimited) warnings.push("Duplicate candidates limited to the first 100 matches; review selected records before importing.");
      const preview = { references: fields, warnings, duplicateCandidates, fingerprint };
      if (Buffer.byteLength(JSON.stringify(preview)) > 192 * 1024) throw new Error("Import preview exceeds response budget; split the file into smaller batches");
      return preview;
    }
    if (!Array.isArray(v["indices"]) || v["indices"].length > LIBRARY_MAX_REFERENCES) throw new Error("Invalid selected import rows");
    const indices = v["indices"].map((item: unknown) => libraryInteger(item, 0, fields.length - 1));
    if (new Set(indices).size !== indices.length) throw new Error("Repeated import row selection");
    return this.store.update(root, state => {
      const added: string[] = []; let skipped = 0;
      for (const index of indices) {
        signal.throwIfAborted();
        const field = fields[index]; if (field === undefined) throw new Error("Import row no longer exists");
        const token = `import:${fingerprint}:${String(index)}`; const rowHash = sha(token); const id = `ref-${rowHash.slice(0, 32)}`;
        const existing = state.references.find(r => r.id === id);
        if (existing !== undefined) {
          if (!existing.provenance.includes(token)) throw new Error("Import identity collision");
          skipped += 1; continue;
        }
        if (state.references.length >= LIBRARY_MAX_REFERENCES) throw new Error("Library reference limit reached");
        checkCollections(state, field);
        const ref = newReference(id, { ...field }, [token]);
        if (state.references.some(r => r.deletedAt === null && [r.citekey, ...r.aliases].includes(ref.citekey))) {
          ref.citekey = `${ref.citekey.slice(0, 110)}-${rowHash.slice(0, 8)}`;
          warnings.push(`Row ${String(index + 1)}: citation key changed to ${ref.citekey} to avoid collision.`);
        }
        checkKeys(state, ref); state.references.push(ref); added.push(id);
      }
      if (skipped > 0) warnings.push(`${String(skipped)} previously imported rows skipped (including retained trash records).`);
      return { added, skipped, warnings };
    }, signal);
  }
  private async export(root: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const v = libraryObject(input, ["referenceIds", "format"]); const ids = libraryIds(v["referenceIds"], "ref", LIBRARY_MAX_REFERENCES);
    const format = libraryEnum(v["format"], formats); const state = await this.store.read(root, signal);
    const refs = ids.map(id => refById(state, id)); const text = this.codec.export(refs, format); signal.throwIfAborted();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error("Bibliography export exceeds 2MiB; select fewer references");
    return { text, ...exportMetadata(format) };
  }
  private saveCollection(root: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const v = libraryObject(input, ["id", "expectedRevision", "name", "parentId"]);
    const id = libraryId(v["id"], "col"); const expected = revision(v["expectedRevision"]);
    const candidate = validateLibraryCollection({ id, name: v["name"], parentId: v["parentId"], revision: expected + 1 });
    return this.store.update(root, state => {
      const existing = state.collections.find(c => c.id === id);
      if (expected === 0 && existing !== undefined) {
        if (existing.revision === 1 && existing.name === candidate.name && existing.parentId === candidate.parentId) return existing;
        throw new Error("Collection ID already exists with different content");
      }
      if (expected > 0) { if (existing === undefined) throw new Error("Collection not found"); requireRevision(existing, expected); }
      if (state.collections.some(c => c.id !== id && c.parentId === candidate.parentId && c.name.trim().toLowerCase() === candidate.name.trim().toLowerCase())) throw new Error("Duplicate collection name");
      let parent = candidate.parentId; const seen = new Set([id]);
      while (parent !== null) {
        if (seen.has(parent)) throw new Error("Collection cycle"); seen.add(parent);
        const ancestor = state.collections.find(c => c.id === parent);
        if (ancestor === undefined) throw new Error("Parent collection not found"); parent = ancestor.parentId;
      }
      if (existing === undefined) { if (state.collections.length >= 1000) throw new Error("Collection limit reached"); state.collections.push(candidate); }
      else Object.assign(existing, candidate);
      return candidate;
    }, signal);
  }
  private deleteCollection(root: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const v = libraryObject(input, ["id", "expectedRevision"]); const id = libraryId(v["id"], "col"); const expected = revision(v["expectedRevision"]);
    return this.store.update(root, state => {
      const collection = state.collections.find(c => c.id === id); if (collection === undefined) throw new Error("Collection not found");
      requireRevision(collection, expected);
      if (state.collections.some(c => c.parentId === id)) throw new Error("Delete child collections first");
      state.collections = state.collections.filter(c => c.id !== id);
      for (const ref of state.references) if (ref.collectionIds.includes(id)) { ref.collectionIds = ref.collectionIds.filter(value => value !== id); touch(ref); }
      return { deleted: true };
    }, signal);
  }
  private async attach(root: string, input: unknown, signal: AbortSignal): Promise<LibraryReference> {
    const v = libraryObject(input, ["referenceId", "expectedRevision", "path", "label", "sourceUrl", "rights"]);
    const referenceId = libraryId(v["referenceId"], "ref"); const expected = revision(v["expectedRevision"]);
    const path = libraryPath(v["path"]); const label = libraryText(v["label"], 1000, false);
    const sourceUrl = libraryUrl(v["sourceUrl"]); const rights = libraryText(v["rights"], 4000);
    if (!path.toLowerCase().endsWith(".pdf")) throw new Error("Attachment must be a PDF path");
    const handle = await openWorkbenchFile(root, path, LIBRARY_MAX_PDF_BYTES);
    try {
      const before = await handle.stat();
      // Recheck the exact snapshot that bounds hashing, not only the earlier opening stat.
      if (!before.isFile() || before.size > LIBRARY_MAX_PDF_BYTES) throw new Error("Expected bounded regular PDF file");
      const hash = createHash("sha256"); const buffer = Buffer.alloc(65536); let offset = 0;
      let first = Buffer.alloc(0); let tail = Buffer.alloc(0);
      while (offset < before.size) {
        signal.throwIfAborted(); const chunk = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
        if (chunk.bytesRead === 0) throw new Error("PDF changed during verification");
        const bytes = buffer.subarray(0, chunk.bytesRead); if (offset === 0) first = Buffer.from(bytes.subarray(0, 8));
        tail = Buffer.from(Buffer.concat([tail, bytes]).subarray(-1024)); hash.update(bytes); offset += chunk.bytesRead;
      }
      if (!/^%PDF-\d\.\d/u.test(first.toString("ascii")) || !tail.includes(Buffer.from("%%EOF"))) throw new Error("Attachment is not a complete PDF");
      const sha256 = hash.digest("hex");
      const unchanged = async (): Promise<void> => {
        signal.throwIfAborted(); const after = await handle.stat(); const pathStat = await lstat(await workbenchPath(root, path));
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.ino !== pathStat.ino || after.dev !== pathStat.dev || after.size !== pathStat.size || after.mtimeMs !== pathStat.mtimeMs || after.ctimeMs !== pathStat.ctimeMs) throw new Error("PDF source changed during admission");
      };
      await unchanged();
      return await this.store.update(root, async state => {
        await unchanged(); const ref = refById(state, referenceId);
        if (ref.deletedAt !== null) throw new Error("Cannot attach to a trashed reference");
        const matching = ref.documents.find(d => d.path === path && d.sha256 === sha256 && d.label === label && d.sourceUrl === sourceUrl && d.rights === rights);
        if (matching !== undefined && (ref.revision === expected || ref.revision === expected + 1)) return ref;
        requireRevision(ref, expected);
        if (ref.documents.some(d => d.path === path)) throw new Error("Path is already attached with different content or metadata; choose a new immutable path");
        if (ref.documents.length >= 16) throw new Error("Reference already has 16 documents");
        const doc: LibraryDocument = { id: `doc-${sha(`${referenceId}\n${path}\n${sha256}`).slice(0, 32)}`, path, sha256, size: before.size, label, sourceUrl, rights, addedAt: new Date().toISOString() };
        ref.documents.push(doc); touch(ref); return ref;
      }, signal);
    } finally { await handle.close(); }
  }
}
function exportMetadata(format: BibliographyFormat): { filename: string; mime: string } {
  switch (format) {
    case "bibtex": return { filename: "library.bib", mime: "application/x-bibtex" };
    case "ris": return { filename: "library.ris", mime: "application/x-research-info-systems" };
    case "csl-json": return { filename: "library.json", mime: "application/json" };
  }
}
