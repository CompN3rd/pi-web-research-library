import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/** Workspace authority comes from the host, never from the peer's input. */
export async function openWorkspaceFile(rootPath: string, path: string, maxBytes: number): Promise<FileHandle> {
  const root = await realpath(rootPath);
  if (path === "" || path.includes("\\") || path.includes(":")) throw new Error("Invalid workspace-relative path");
  let target = root;
  for (const part of path.split("/")) {
    if (part === "" || part === "." || part === "..") throw new Error("Invalid workspace-relative path");
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error("Research files cannot traverse symlinks");
  }
  const resolved = await realpath(target);
  const delta = relative(root, resolved);
  if (isAbsolute(delta) || delta === ".." || delta.startsWith(`..${sep}`)) throw new Error("Research file escapes workspace");
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW | 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Research file is not a bounded regular file");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readExactly(handle: FileHandle, start: number, size: number, signal?: AbortSignal): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    signal?.throwIfAborted();
    const read = await handle.read(bytes, offset, size - offset, start + offset);
    if (read.bytesRead === 0) throw new Error("Research file changed while reading");
    offset += read.bytesRead;
  }
  signal?.throwIfAborted();
  return bytes;
}
