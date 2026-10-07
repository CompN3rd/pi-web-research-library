import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyLibrary, LIBRARY_MAX_BYTES, LIBRARY_STATE_PATH } from "../domain/workbench.js";
import { completeState, evidence, reference } from "./workbench.testSupport.js";
import { readWorkbenchState, WorkbenchStore } from "./workbenchStore.js";

let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "native-library-store-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const store = new WorkbenchStore();

describe("WorkbenchStore", () => {
  it("does not create directories for missing read or unchanged update", async () => {
    expect(await readWorkbenchState(root)).toEqual(emptyLibrary());
    await store.update(root, () => undefined);
    expect(await readdir(root)).toEqual([]);
  });
  it("persists all nested data and publishes only valid state", async () => {
    const complete = completeState(); await store.update(root, state => Object.assign(state, complete));
    expect(await new WorkbenchStore().read(root)).toEqual({ ...complete, revision: 1 });
    const original = await readFile(join(root, LIBRARY_STATE_PATH));
    await expect(store.update(root, state => { const ref = state.references[0]; if (ref !== undefined) ref.title = ""; })).rejects.toThrow();
    expect(await readFile(join(root, LIBRARY_STATE_PATH))).toEqual(original);
    expect((await readdir(join(root, ".pi-web/research-library"))).filter(f => f.endsWith(".tmp"))).toEqual([]);
  });
  it("serializes reads and writes across instances; callback failures do not poison queue", async () => {
    let release = (): void => { throw new Error("Not initialized"); };
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = (): void => { throw new Error("Not initialized"); };
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = store.update(root, async state => { entered(); await gate; state.references.push(reference()); });
    await started;
    let secondEntered = (): void => { throw new Error("Not initialized"); };
    const secondStarted = new Promise<void>(resolve => { secondEntered = resolve; });
    let releaseSecond = (): void => { throw new Error("Not initialized"); };
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
    const second = new WorkbenchStore().update(root, async state => {
      expect(state.references).toHaveLength(1); state.references.push(reference(2)); secondEntered(); await secondGate;
    });
    release(); await first; await secondStarted;
    const read = readWorkbenchState(root); releaseSecond(); await second;
    expect((await read).references).toHaveLength(2);
    await expect(store.update(root, () => { throw new Error("Synthetic failure"); })).rejects.toThrow("Synthetic failure");
    expect((await store.read(root)).revision).toBe(2);
  });
  it("aborts before publication and rejects excessive pending work", async () => {
    const abort = new AbortController();
    await expect(store.update(root, state => { state.references.push(reference()); abort.abort(); }, abort.signal)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    let release = (): void => { throw new Error("Not initialized"); };
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = (): void => { throw new Error("Not initialized"); };
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = store.update(root, async () => { entered(); await gate; }); await started;
    const requests = Array.from({ length: 70 }, () => store.read(root).then(() => "read", (error: unknown) => error instanceof Error ? error.message : "error"));
    expect(await Promise.race(requests)).toContain("Too many pending"); release(); await first;
    const outcomes = await Promise.all(requests);
    expect(outcomes.some(result => result.includes("Too many pending"))).toBe(true);
  });
  it("honors abort while waiting for serialized access without invoking the mutation", async () => {
    let release = (): void => { throw new Error("Not initialized"); };
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = (): void => { throw new Error("Not initialized"); };
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = store.update(root, async () => { entered(); await gate; }); await started;
    const abort = new AbortController(); let mutated = false;
    const queued = store.update(root, () => { mutated = true; }, abort.signal);
    const rejected = expect(queued).rejects.toThrow();
    abort.abort(); release(); await first; await rejected;
    expect(mutated).toBe(false); expect(await readdir(root)).toEqual([]);
    await expect(store.read(root, abort.signal)).rejects.toThrow();
  });
  it("writes an exact .deleted recovery copy before evidence tombstone and retains history", async () => {
    const original = evidence();
    await store.update(root, state => { state.references.push(reference()); state.evidence.push(original); });
    await store.update(root, state => {
      const item = state.evidence[0]; if (item === undefined) throw new Error("Missing evidence");
      item.deletedAt = item.updatedAt; item.revision += 1;
    });
    const recovery = join(root, `.pi-web/research-library/evidence/${original.id}.1.json.deleted`);
    expect(JSON.parse(await readFile(recovery, "utf8"))).toEqual(original);
    expect((await store.read(root)).evidence[0]?.deletedAt).not.toBeNull();
    await expect(store.update(root, state => { state.evidence = []; })).rejects.toThrow(/history/u);
    await expect(store.update(root, state => { const item = state.evidence[0]; if (item !== undefined) item.quote = "rewritten"; })).rejects.toThrow(/immutable/u);
  });
  it("fails closed on corrupt JSON, oversized state and state symlinks", async () => {
    const directory = join(root, ".pi-web/research-library"); await mkdir(directory, { recursive: true });
    const path = join(root, LIBRARY_STATE_PATH); await writeFile(path, "{corrupt");
    await expect(store.read(root)).rejects.toThrow(/corrupt/u);
    await expect(store.update(root, state => { state.references.push(reference()); })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{corrupt");
    await writeFile(path, " ".repeat(LIBRARY_MAX_BYTES + 1)); await expect(store.read(root)).rejects.toThrow(/bounded/u);
    await rm(path); await writeFile(join(root, "other.json"), JSON.stringify(emptyLibrary()));
    // Junctions work without developer-mode privileges on Windows and still must fail as non-regular state.
    await symlink(root, path, "junction"); await expect(store.read(root)).rejects.toThrow(/symlink/u);
  });
  it("rejects directory junction traversal without writing outside the catalog", async () => {
    const outside = await mkdtemp(join(tmpdir(), "native-library-outside-"));
    try {
      await symlink(outside, join(root, ".pi-web"), "junction");
      await expect(store.update(root, state => { state.references.push(reference()); })).rejects.toThrow(/symlink/u);
      expect(await readdir(outside)).toEqual([]);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
  it("detects external replacement during callback and keeps recovery conflicts visible", async () => {
    await store.update(root, state => { state.references.push(reference()); state.evidence.push(evidence()); });
    const external = { ...await store.read(root), revision: 50 };
    await expect(store.update(root, async state => {
      state.references.push(reference(2)); await writeFile(join(root, LIBRARY_STATE_PATH), JSON.stringify(external));
    })).rejects.toThrow(/externally/u);
    expect((await store.read(root)).revision).toBe(50);
    const ev = evidence(); await mkdir(join(root, ".pi-web/research-library/evidence"));
    await writeFile(join(root, `.pi-web/research-library/evidence/${ev.id}.1.json.deleted`), "conflicting recovery");
    await expect(store.update(root, state => { const item = state.evidence[0]; if (item !== undefined) { item.deletedAt = item.updatedAt; item.revision += 1; } })).rejects.toThrow(/different content/u);
    expect((await store.read(root)).evidence[0]?.deletedAt).toBeNull();
  });
});
