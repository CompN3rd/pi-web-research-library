import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchClient, evidence, manuscript, object, page, reference, task, workbenchId } from "./workbenchClient.js";
import { syntheticEvidence, syntheticManuscript, syntheticReference, syntheticTask, workbenchHost } from "./workbench.testSupport.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("workbenchId", () => {
  it.each(["ref", "ev", "task", "ms", "col", "search"] as const)("generates %s IDs without secure-context-only randomUUID", prefix => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    expect(workbenchId(prefix)).toBe(`${prefix}-000102030405060708090a0b0c0d0e0f`);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
  });
  it("does not fall back to weak randomness when the cryptographic source fails", () => {
    vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("Cryptographic source unavailable"); } });
    expect(() => workbenchId("ref")).toThrow("Cryptographic source unavailable");
  });
});

describe("WorkbenchClient", () => {
  it("uses versioned public peers with cancellation and no workspace path payload", async () => {
    const host = workbenchHost();
    const client = new WorkbenchClient(host.context);
    await client.request("library.list", { offset: 0, trash: false }, page(reference));
    expect(host.request).toHaveBeenCalledWith("library.list", { version: 1, payload: { offset: 0, trash: false } }, { signal: client.signal });
    client.dispose();
    expect(client.signal.aborted).toBe(true);
  });
  it("suppresses late responses even when the peer ignores cancellation", async () => {
    const host = workbenchHost();
    let finish: (value: unknown) => void = () => { throw new Error("Not started"); };
    host.overrides.set("library.list", () => new Promise(resolve => { finish = resolve; }));
    const client = new WorkbenchClient(host.context);
    const pending = client.request("library.list", {}, object);
    client.dispose(); finish({ items: [] });
    await expect(pending).rejects.toThrow();
  });
  it("uses replacement peer/file bindings without confusing wrapper identity with authority", async () => {
    const first = workbenchHost(); const second = workbenchHost();
    const client = new WorkbenchClient(first.context);
    client.rebind(second.context);
    await client.request("library.list", { trash: false }, page(reference));
    expect(first.request).not.toHaveBeenCalled(); expect(second.request).toHaveBeenCalledTimes(1);
    expect(client.context.files).toBe(second.files);
    expect(() => { client.rebind({ ...second.context, workspace: { ...second.context.workspace, path: "/another-root" } }); }).toThrow("authority");
    // Model an invalid runtime mutation despite the host's readonly type contract.
    Object.defineProperty(second.context.workspace, "path", { value: "/mutated-root" });
    await expect(client.request("library.list", {}, object)).rejects.toThrow("authority");
    expect(second.request).toHaveBeenCalledTimes(1);
  });
  it("fails visibly without a paired server", async () => {
    const host = workbenchHost(); delete host.context.peer;
    await expect(new WorkbenchClient(host.context).request("library.list", {}, object)).rejects.toThrow("server is unavailable");
  });
  it("enforces cross-lane field, UTF-8 result and byte-bounded page limits", () => {
    expect(() => reference({ ...syntheticReference(), title: "x".repeat(1001) })).toThrow();
    expect(() => reference({ ...syntheticReference(), containerTitle: "x".repeat(1001) })).toThrow();
    expect(() => reference({ ...syntheticReference(), abstract: "x".repeat(16_001) })).toThrow();
    expect(() => evidence({ ...syntheticEvidence(), body: "x".repeat(16_001) })).toThrow();
    expect(() => manuscript({ ...syntheticManuscript(), markdown: "x".repeat(128_001) })).toThrow();
    expect(() => task({ ...syntheticTask(), goal: "x".repeat(8001) })).toThrow();
    expect(() => task({ ...syntheticTask(), result: { ...syntheticTask().result, markdown: "語".repeat(44_000) } })).toThrow("Oversized");
    const largeReference = { ...syntheticReference(), notes: "x".repeat(10_000) };
    expect(() => page(reference)({ items: Array.from({ length: 25 }, () => largeReference), total: 25, nextOffset: null })).toThrow("Oversized");
    expect(page(reference)({ items: [syntheticReference()], total: 30, nextOffset: 1 }).nextOffset).toBe(1);
  });
  it("accepts 1000 collection memberships and rejects count or ID-length overflow", () => {
    const value = { ...syntheticReference(), collectionIds: Array.from({ length: 1000 }, (_, index) => `col-${index.toString(16).padStart(32, "0")}`) };
    expect(reference(value)).toEqual(value);
    expect(() => reference({ ...value, collectionIds: [...value.collectionIds, `col-${"f".repeat(32)}`] })).toThrow();
    expect(() => reference({ ...value, collectionIds: ["c".repeat(81)] })).toThrow();
  });
  it("accepts shared manuscript binding maxima and rejects overflow", () => {
    const value = { ...syntheticManuscript(), referenceIds: Array.from({ length: 5000 }, (_, index) => `ref-${index.toString(16).padStart(32, "0")}`), taskIds: Array.from({ length: 200 }, (_, index) => `task-${index.toString(16).padStart(32, "0")}`) };
    expect(manuscript(value)).toEqual(value);
    expect(() => manuscript({ ...value, referenceIds: [...value.referenceIds, `ref-${"f".repeat(32)}`] })).toThrow();
    expect(() => manuscript({ ...value, taskIds: [...value.taskIds, `task-${"f".repeat(32)}`] })).toThrow();
  });
  it("decodes repeated bounded PDF hashes in a frozen corpus", () => {
    const value = syntheticTask();
    const binding = value.corpus[0]; if (binding === undefined) throw new Error("Missing corpus");
    binding.documentHashes.push(...binding.documentHashes);
    expect(task(value)).toEqual(value);
    binding.documentHashes = Array.from({ length: 17 }, () => "a".repeat(64));
    expect(() => task(value)).toThrow();
  });
  it("decodes native records and rejects malformed or oversized responses", () => {
    expect(reference(syntheticReference())).toEqual(syntheticReference());
    expect(evidence(syntheticEvidence())).toEqual(syntheticEvidence());
    expect(task(syntheticTask())).toEqual(syntheticTask());
    expect(() => reference({ ...syntheticReference(), revision: -1 })).toThrow();
    expect(() => evidence({ ...syntheticEvidence(), rect: { x: NaN, y: 0, width: 1, height: 1 } })).toThrow();
    expect(() => page(reference)({ items: new Array<unknown>(10_001).fill(null), total: 10_001, nextOffset: null })).toThrow("oversized");
    expect(workbenchId("ref")).toMatch(/^ref-[a-f0-9]{32}$/u);
  });
});
