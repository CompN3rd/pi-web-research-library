import { randomUUID } from "node:crypto";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyLibrary, LIBRARY_MAX_BYTES, LIBRARY_ROOT, LIBRARY_STATE_PATH, type LibraryRepository, type LibraryState } from "../domain/workbench.js";
import { validateWorkbenchState } from "../domain/workbenchValidation.js";
import { isMissingFile, readWorkbenchBytes, workbenchPath } from "./workbenchFiles.js";

interface Queue { tail: Promise<void>; pending: number }
// All store instances and companion reads cooperate, including Windows open/rename ordering.
const queues = new Map<string, Queue>();
let pending = 0;
async function serialized<T>(root: string, signal: AbortSignal | undefined, action: (root: string) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  // Count admission itself: a flood must not launch unbounded realpath IO before reaching the queue.
  if (pending >= 256) throw new Error("Too many pending library operations");
  pending += 1;
  try {
    const authority = await realpath(root);
    const key = process.platform === "win32" ? authority.toLowerCase() : authority;
    const queue = queues.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    if (queue.pending >= 64) throw new Error("Too many pending library operations");
    queues.set(key, queue); queue.pending += 1;
    const task = queue.tail.then(() => { signal?.throwIfAborted(); return action(authority); });
    // This tail handles rejection only for queue continuity; the caller receives the original failure.
    queue.tail = task.then(() => undefined, () => undefined);
    try { return await task; }
    finally { queue.pending -= 1; if (queue.pending === 0) queues.delete(key); }
  } finally { pending -= 1; }
}
async function readSnapshot(root: string, signal?: AbortSignal): Promise<{ state: LibraryState; bytes: Buffer | null }> {
  try { await lstat(await workbenchPath(root, LIBRARY_STATE_PATH)); }
  catch (error) { if (isMissingFile(error)) return { state: emptyLibrary(), bytes: null }; throw error; }
  // Once observed, disappearance is corruption/concurrent change, not a new empty library.
  const bytes = await readWorkbenchBytes(root, LIBRARY_STATE_PATH, LIBRARY_MAX_BYTES, signal);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) { throw new Error("Library state is corrupt; restore a verified backup before writing", { cause: error }); }
  return { state: validateWorkbenchState(value), bytes };
}
async function syncDirectory(directory: string): Promise<void> {
  // Node/Windows does not support opening directory handles for fsync. File contents are still fsynced before rename.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
async function removeTemporary(path: string): Promise<void> {
  try { await unlink(path); } catch (error) { if (!isMissingFile(error)) throw error; }
}
async function publish(root: string, path: string, bytes: Buffer, exclusive: boolean, signal?: AbortSignal): Promise<void> {
  const destination = await workbenchPath(root, path, true);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const temporary = await workbenchPath(root, temporaryPath);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    signal?.throwIfAborted();
    if (await workbenchPath(root, path) !== destination || await workbenchPath(root, temporaryPath) !== temporary) throw new Error("Library directory changed before publication");
    if (exclusive) {
      try { await link(temporary, destination); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        const previous = await readWorkbenchBytes(root, path, LIBRARY_MAX_BYTES, signal);
        if (!previous.equals(bytes)) throw new Error("Evidence recovery file already exists with different content", { cause: error });
      }
    } else { await rename(temporary, destination); }
    await syncDirectory(dirname(destination));
  } finally {
    await removeTemporary(temporary);
  }
}

export class WorkbenchStore implements LibraryRepository {
  read(root: string, signal?: AbortSignal): Promise<LibraryState> {
    return serialized(root, signal, async authority => (await readSnapshot(authority, signal)).state);
  }
  update<T>(root: string, change: (state: LibraryState) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    return serialized(root, signal, async authority => {
      const before = await readSnapshot(authority, signal);
      const draft = structuredClone(before.state);
      const result = await change(draft);
      signal?.throwIfAborted();
      if (draft.revision !== before.state.revision) throw new Error("Library state revision is owned by the store");
      const next = validateWorkbenchState(draft);
      if (JSON.stringify(next) === JSON.stringify(before.state)) return structuredClone(result);
      next.revision += 1;
      const bytes = Buffer.from(`${JSON.stringify(validateWorkbenchState(next))}\n`);
      if (bytes.length > LIBRARY_MAX_BYTES) throw new Error("Library state exceeds 16MiB");
      for (const [oldRecords, newRecords] of [[before.state.references, next.references], [before.state.evidence, next.evidence], [before.state.tasks, next.tasks], [before.state.manuscripts, next.manuscripts]]) {
        if (oldRecords === undefined || newRecords === undefined) throw new Error("Missing state records");
        const ids = new Set(newRecords.map(item => item.id));
        if (oldRecords.some(item => !ids.has(item.id))) throw new Error("Library history cannot be removed; use tombstones");
      }
      const recovery: { path: string; bytes: Buffer }[] = [];
      for (const old of before.state.evidence) {
        const item = next.evidence.find(e => e.id === old.id);
        if (item === undefined) throw new Error("Evidence history cannot be removed");
        if (["referenceId", "documentId", "pdfSha256", "page", "rect", "quote"].some(key => JSON.stringify(Reflect.get(old, key)) !== JSON.stringify(Reflect.get(item, key)))) throw new Error("Evidence anchors are immutable");
        if (old.deletedAt === null && item.deletedAt !== null) recovery.push({ path: `${LIBRARY_ROOT}/evidence/${old.id}.${String(old.revision)}.json.deleted`, bytes: Buffer.from(`${JSON.stringify(old)}\n`) });
      }
      // Detect non-cooperating external edits rather than silently replacing their data.
      const current = await readSnapshot(authority, signal);
      if (before.bytes === null ? current.bytes !== null : current.bytes === null || !before.bytes.equals(current.bytes)) throw new Error("Library changed externally; reload before retrying");
      // Recovery publication precedes state publication. An interrupted update may leave an extra recovery copy, never lost evidence.
      for (const item of recovery) await publish(authority, item.path, item.bytes, true, signal);
      await publish(authority, LIBRARY_STATE_PATH, bytes, false, signal);
      return structuredClone(result);
    });
  }
}
const reader = new WorkbenchStore();
export function readWorkbenchState(root: string, signal?: AbortSignal): Promise<LibraryState> { return reader.read(root, signal); }
