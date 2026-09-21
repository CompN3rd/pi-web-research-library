import { randomUUID } from "node:crypto";
import { lstat, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ensureWorkspaceDirectory, writeJsonExclusive } from "../companion/storage.js";
import { annotationDirectoryPath, applyAnnotationChanges, MAX_RESEARCH_ANNOTATION_BYTES, MAX_RESEARCH_ANNOTATIONS_PER_PAPER, parseAnnotationText, parseResearchAnnotation, serializeAnnotation, type ResearchAnnotation } from "../domain/annotation.js";
import { ANNOTATION_PAGE_SIZE, type PaperScope } from "../domain/protocol.js";
import { openWorkspaceFile, readExactly } from "./files.js";
import { resolvePaper } from "./library.js";

export class AnnotationRepository {
  private readonly queues = new Map<string, Promise<unknown>>();
  private pending = 0;

  private async serialize<T>(root: string, scope: PaperScope, signal: AbortSignal, action: (root: string) => Promise<T>): Promise<T> {
    if (this.pending >= 64) throw new Error("Too many annotation requests");
    this.pending += 1;
    try {
      const canonicalRoot = await realpath(root);
      const key = JSON.stringify([canonicalRoot, scope.paperId]);
      const previous = this.queues.get(key) ?? Promise.resolve();
      const operation = previous.catch(() => undefined).then(async () => {
        signal.throwIfAborted();
        await resolvePaper(canonicalRoot, scope);
        signal.throwIfAborted();
        return action(canonicalRoot);
      });
      this.queues.set(key, operation);
      try { return await operation; }
      finally { if (this.queues.get(key) === operation) this.queues.delete(key); }
    } finally {
      this.pending -= 1;
    }
  }

  async list(root: string, scope: PaperScope, offset: number, signal: AbortSignal) {
    return this.serialize(root, scope, signal, async (cwd) => {
      const directory = annotationDirectoryPath(scope.paperId);
      let names: string[];
      try {
        // Validate the directory before listing; internal symlinks are not an escape authority.
        const resolved = await realpath(join(cwd, directory));
        if (resolved !== join(cwd, directory)) throw new Error("Annotation directories cannot traverse symlinks");
        names = (await readdir(resolved)).filter((name) => name.endsWith(".json")).sort();
      } catch (error) {
        if (missing(error)) return { annotations: [], warnings: [], nextOffset: null };
        throw error;
      }
      if (names.length > MAX_RESEARCH_ANNOTATIONS_PER_PAPER) throw new Error("Too many annotation records");
      const annotations: ResearchAnnotation[] = [];
      const warnings: string[] = [];
      for (const name of names.slice(offset, offset + ANNOTATION_PAGE_SIZE)) {
        signal.throwIfAborted();
        try {
          if (!/^ann-[a-f0-9]{32}\.json$/u.test(name)) throw new Error("Invalid annotation filename");
          annotations.push(await readAnnotation(cwd, scope, name.slice(0, -5)));
        } catch (error) {
          warnings.push(`${name.slice(0, 80)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { annotations, warnings, nextOffset: offset + ANNOTATION_PAGE_SIZE < names.length ? offset + ANNOTATION_PAGE_SIZE : null };
    });
  }

  async create(root: string, scope: PaperScope, value: unknown, signal: AbortSignal) {
    const annotation = validateAnnotation(value, scope);
    if (annotation.revision !== 1 || annotation.status !== "open" || annotation.createdAt !== annotation.updatedAt) throw new Error("Invalid new annotation");
    return this.serialize(root, scope, signal, async (cwd) => {
      const parts = annotationDirectoryPath(scope.paperId).split("/");
      const directory = await annotationDirectory(cwd, parts);
      // Deleted IDs are never reused, including after a lost create response.
      if (await exists(join(directory, `${annotation.id}.deleted`))) throw new Error("Annotation was deleted; refresh before creating another");
      try {
        const existing = await readAnnotation(cwd, scope, annotation.id);
        if (serializeAnnotation(existing) === serializeAnnotation(annotation)) return existing;
        throw new Error("Annotation identity already exists with different content");
      } catch (error) { if (!missing(error)) throw error; }
      if ((await readdir(directory)).filter((name) => name.endsWith(".json")).length >= MAX_RESEARCH_ANNOTATIONS_PER_PAPER) throw new Error("Too many annotation records");
      signal.throwIfAborted();
      if (!await writeJsonExclusive(cwd, parts, `${annotation.id}.json`, annotation)) throw new Error("Annotation identity already exists");
      return annotation;
    });
  }

  async update(root: string, scope: PaperScope, before: unknown, after: unknown, signal: AbortSignal) {
    const expected = validateAnnotation(before, scope);
    const updated = validateAnnotation(after, scope);
    const computed = applyAnnotationChanges(expected, { body: updated.body, kind: updated.kind, status: updated.status }, new Date(updated.updatedAt));
    if (serializeAnnotation(computed) !== serializeAnnotation(updated)) throw new Error("An edit cannot change the annotation anchor or identity");
    return this.serialize(root, scope, signal, async (cwd) => {
      const stored = await readAnnotation(cwd, scope, expected.id);
      if (serializeAnnotation(stored) === serializeAnnotation(updated)) return stored; // Exact retry.
      if (serializeAnnotation(stored) !== serializeAnnotation(expected)) throw new Error("This annotation changed elsewhere. Refresh before editing it again.");
      const parts = annotationDirectoryPath(scope.paperId).split("/");
      const directory = await annotationDirectory(cwd, parts);
      const temporary = join(directory, `.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        try { await handle.writeFile(serializeAnnotation(updated)); await handle.sync(); }
        finally { await handle.close(); }
        signal.throwIfAborted();
        await rename(temporary, join(directory, `${expected.id}.json`));
      } finally {
        await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; });
      }
      return updated;
    });
  }

  async delete(root: string, scope: PaperScope, value: unknown, signal: AbortSignal) {
    const expected = validateAnnotation(value, scope);
    return this.serialize(root, scope, signal, async (cwd) => {
      const directory = await annotationDirectory(cwd, annotationDirectoryPath(scope.paperId).split("/"));
      const tombstone = join(directory, `${expected.id}.deleted`);
      if (await exists(tombstone)) {
        if (await exists(join(directory, `${expected.id}.json`))) throw new Error("Conflicting active and recovery records; inspect before deleting");
        const deleted = await readAnnotation(cwd, scope, expected.id, ".deleted");
        if (serializeAnnotation(deleted) !== serializeAnnotation(expected)) throw new Error("Deleted annotation does not match the requested revision");
        return { deleted: true };
      }
      const stored = await readAnnotation(cwd, scope, expected.id);
      if (serializeAnnotation(stored) !== serializeAnnotation(expected)) throw new Error("This annotation changed elsewhere. Refresh before deleting it.");
      signal.throwIfAborted();
      // Atomic soft deletion preserves identity for retries and permits manual recovery.
      await rename(join(directory, `${expected.id}.json`), tombstone);
      return { deleted: true };
    });
  }
}

function validateAnnotation(value: unknown, scope: PaperScope): ResearchAnnotation {
  const parsed = parseResearchAnnotation(value);
  if (!parsed.ok) throw new Error(parsed.error);
  const annotation = parsed.annotation;
  if (annotation.paperId !== scope.paperId || annotation.libraryId !== scope.libraryId || annotation.pdfSha256 !== scope.pdfSha256) throw new Error("Annotation belongs to a different library, paper or PDF revision");
  return annotation;
}

async function readAnnotation(root: string, scope: PaperScope, id: string, suffix: ".json" | ".deleted" = ".json"): Promise<ResearchAnnotation> {
  const handle = await openWorkspaceFile(root, `${annotationDirectoryPath(scope.paperId)}/${id}${suffix}`, MAX_RESEARCH_ANNOTATION_BYTES);
  try {
    const stat = await handle.stat();
    const text = (await readExactly(handle, 0, stat.size)).toString("utf8");
    const parsed = parseAnnotationText(text, id);
    if (!parsed.ok) throw new Error(parsed.error);
    return validateAnnotation(parsed.annotation, scope);
  } finally { await handle.close(); }
}

async function annotationDirectory(root: string, parts: string[]): Promise<string> {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error("Annotation directories cannot traverse symlinks");
    } catch (error) { if (!missing(error)) throw error; }
  }
  return ensureWorkspaceDirectory(root, parts);
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
