import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { libraryPath } from "../domain/workbench.js";

const MAX_TARGET_BYTES = 1024 * 1024;
const forbidden = /^(?:raw|source|sources|src|node_modules|dist|build|vendor|config|configuration|recovery|backups?|pilot|research-library)$/iu;
export function manuscriptTarget(value: unknown): string {
  const path = libraryPath(value);
  const parts = path.split("/");
  if (!/\.(?:md|markdown|txt)$/iu.test(path) || parts.some(part => part.startsWith(".") || forbidden.test(part) || /(?:\.deleted|\.backup|~$)/iu.test(part) || /[<>"|*]/u.test(part) || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))) throw new Error("Apply requires a non-config Markdown/text manuscript path outside protected directories");
  const basename = parts.at(-1) ?? "";
  if (/^(?:agents|claude|gemini|copilot-instructions|readme|license|notice|requirements|cmakelists)(?:\.|$)/iu.test(basename)) throw new Error("Apply cannot overwrite project instructions/configuration");
  return path;
}
export function manuscriptHash(text: string | Buffer): string { return createHash("sha256").update(text).digest("hex"); }
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function safeTarget(root: string, path: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  let target = canonicalRoot;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    target = join(target, parts[i] ?? "");
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()) || (i === parts.length - 1 && !stat.isFile())) throw new Error("Manuscript path must use real directories and a regular file, without symlinks");
      if (await realpath(target) !== target) throw new Error("Manuscript path changed or escapes workspace");
    } catch (error) {
      if (i !== parts.length - 1 || !missing(error)) throw error;
    }
  }
  return target;
}
async function boundedRead(target: string, signal: AbortSignal): Promise<Buffer | null> {
  let file: FileHandle;
  try { file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW | 0)); }
  catch (error) { if (missing(error)) return null; throw error; }
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > MAX_TARGET_BYTES || before.nlink > 1) throw new Error("Manuscript target must be a bounded regular file without hard links");
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw new Error("Manuscript changed while reading");
      offset += bytesRead;
    }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Manuscript changed while reading");
    // Reject binary/invalid UTF-8 rather than replacing it with a lossy backup preview.
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (decoded.includes("\0")) throw new Error("Manuscript target contains binary data");
    return buffer;
  } finally { await file.close(); }
}
export async function previewManuscriptFile(root: string, value: unknown, text: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Buffer.byteLength(text) > MAX_TARGET_BYTES) throw new Error("Manuscript export exceeds apply limit");
  const path = manuscriptTarget(value);
  const before = await boundedRead(await safeTarget(root, path), signal);
  const previous = before?.toString("utf8") ?? "";
  // A bounded whole-file diff deliberately shows all removals/additions, not a misleading partial preview.
  const diff = previous === text ? "No changes" : `--- ${before === null ? "/dev/null" : path}\n+++ ${path}\n${previous.split("\n").map(line => `-${line}`).join("\n")}\n${text.split("\n").map(line => `+${line}`).join("\n")}`;
  return { expectedHash: before === null ? null : manuscriptHash(before), text, diff };
}
async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory fsync through Node. Files/backups are still explicitly synced.
  if (process.platform === "win32") return;
  const directory = await open(path, constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function applyManuscriptFile(root: string, value: unknown, expectedHash: string | null, text: string, signal: AbortSignal) {
  const path = manuscriptTarget(value);
  if (Buffer.byteLength(text) > MAX_TARGET_BYTES) throw new Error("Manuscript export exceeds apply limit");
  const target = await safeTarget(root, path);
  const parent = await lstat(dirname(target));
  const checkParent = async () => {
    if (await safeTarget(root, path) !== target) throw new Error("Manuscript parent changed during apply");
    const current = await lstat(dirname(target));
    if (current.dev !== parent.dev || current.ino !== parent.ino || current.birthtimeMs !== parent.birthtimeMs) throw new Error("Manuscript parent identity changed during apply");
  };
  const before = await boundedRead(target, signal);
  const actualHash = before === null ? null : manuscriptHash(before);
  const sha256 = manuscriptHash(text);
  const backupPath = expectedHash === null ? null : `${path}.${expectedHash}.backup`;
  if (actualHash === sha256) {
    if (expectedHash === actualHash || expectedHash === null) return { path, backupPath: null, sha256 };
    if (backupPath !== null) {
      const backup = await boundedRead(await safeTarget(root, backupPath), signal);
      if (backup !== null && manuscriptHash(backup) === expectedHash) return { path, backupPath, sha256 };
    }
    throw new Error("Apply replay has no matching recovery backup");
  }
  if (actualHash !== expectedHash) throw new Error("Manuscript target changed since preview");
  signal.throwIfAborted();
  if (backupPath !== null && before !== null) {
    const backup = await safeTarget(root, backupPath);
    await checkParent();
    try {
      const file = await open(backup, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW | 0), 0o600);
      try { await file.writeFile(before); await file.sync(); } finally { await file.close(); }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const bytes = await boundedRead(await safeTarget(root, backupPath), signal);
    if (bytes === null || manuscriptHash(bytes) !== expectedHash) throw new Error("Recovery backup is missing or conflicts; apply stopped");
    await syncDirectory(dirname(target));
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  let created = false;
  try {
    await checkParent();
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW | 0), 0o600);
    created = true;
    try { await file.writeFile(text, "utf8"); await file.sync(); } finally { await file.close(); }
    signal.throwIfAborted();
    await checkParent();
    const current = await boundedRead(target, signal);
    if ((current === null ? null : manuscriptHash(current)) !== expectedHash) throw new Error("Manuscript target changed during apply; backup retained");
    await checkParent();
    if (expectedHash === null) {
      // link is an atomic no-overwrite publication; rename could clobber a concurrently created file.
      await link(temporary, target);
      await unlink(temporary);
    } else await rename(temporary, target);
    created = false;
    await syncDirectory(dirname(target));
    return { path, backupPath, sha256 };
  } catch (error) {
    if (created) {
      try { await unlink(temporary); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Apply failed and temporary-file cleanup failed; recovery backup retained", { cause: cleanupError }); }
    }
    throw error;
  }
}
