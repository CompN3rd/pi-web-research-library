import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { libraryPath } from "../domain/workbench.js";

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function contained(root: string, path: string): void {
  const delta = relative(root, path);
  if (isAbsolute(delta) || delta === ".." || delta.startsWith(`..${sep}`)) throw new Error("Library path escapes workspace");
}
/** Inspect every component, including junctions. Never create through a symlink. */
export async function workbenchPath(root: string, path: string, createDirectories = false): Promise<string> {
  libraryPath(path);
  const authority = await realpath(root);
  let current = authority;
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) throw new Error("Missing path component");
    current = join(current, part);
    const directory = index < parts.length - 1;
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (!isMissingFile(error)) throw error;
      if (directory && createDirectories) {
        try { await mkdir(current, { mode: 0o700 }); }
        catch (mkdirError) { if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")) throw mkdirError; }
        stat = await lstat(current);
      } else if (!directory) { return current; }
      else { throw error; }
    }
    if (stat.isSymbolicLink() || (directory && !stat.isDirectory())) throw new Error("Library path cannot traverse symlinks or non-directories");
    contained(authority, await realpath(current));
  }
  return current;
}
export async function openWorkbenchFile(root: string, path: string, maxBytes: number): Promise<FileHandle> {
  const target = await workbenchPath(root, path);
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("Expected bounded regular library file");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW | 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.size > maxBytes || before.dev !== after.dev || before.ino !== after.ino) throw new Error("Library file changed while opening");
    await workbenchPath(root, path);
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
export async function readWorkbenchBytes(root: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const handle = await openWorkbenchFile(root, path, maxBytes);
  try {
    const before = await handle.stat();
    // The file can grow after open-time validation; bound the snapshot used for allocation.
    if (!before.isFile() || before.size > maxBytes) throw new Error("Expected bounded regular library file");
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const chunk = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (chunk.bytesRead === 0) throw new Error("Library file changed while reading");
      offset += chunk.bytesRead;
    }
    const after = await handle.stat();
    const pathStat = await lstat(await workbenchPath(root, path));
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.dev !== pathStat.dev || after.ino !== pathStat.ino || after.size !== pathStat.size || after.mtimeMs !== pathStat.mtimeMs || after.ctimeMs !== pathStat.ctimeMs) throw new Error("Library file changed while reading");
    signal?.throwIfAborted(); return bytes;
  } finally { await handle.close(); }
}
