import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchStore } from "../server/workbenchStore.js";
import { LibraryCatalog } from "../server/workbenchCatalog.js";
import { bibliographyCodec } from "../domain/bibliography.js";
import { completeState, reference as testReference } from "../server/workbench.testSupport.js";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWorkbenchTools, submitNativeResult } from "./workbenchTools.js";
import { parseResearchResult, WORKBENCH_ACK_CHANNEL, WORKBENCH_RESULT_CHANNEL } from "../domain/workbenchResearchProtocol.js";
import { docId, evId, pdfHash, refId, researchBus, researchResult, researchState, taskId } from "../server/workbenchResearch.testSupport.js";

afterEach(() => { vi.useRealTimers(); });
const signal = new AbortController().signal;
const request = { version: 1 as const, requestId: "a".repeat(32), taskId, corpusHash: "b".repeat(64), result: researchResult };
const context: ExtensionContext = {
  cwd: "/synthetic", mode: "json", hasUI: false, model: undefined, scopedModels: [], signal,
  get ui(): never { throw new Error("Read tools must not use UI"); },
  get sessionManager(): never { throw new Error("Read tools must not access the session"); },
  get modelRegistry(): never { throw new Error("Read tools must not invoke models"); },
  isIdle: () => true, isProjectTrusted: () => true, abort: () => undefined, hasPendingMessages: () => false, shutdown: () => undefined, getContextUsage: () => undefined, compact: () => undefined, getSystemPrompt: () => "",
};
function toolsFixture(events: ExtensionAPI["events"] = { on: () => { throw new Error("Read tools must not use hosted events"); }, emit: () => { throw new Error("Read tools must not use hosted events"); } }) {
  const tools = new Map<string, Pick<ToolDefinition, "execute">>();
  const registerTool: ExtensionAPI["registerTool"] = tool => { tools.set(tool.name, { execute: tool.execute }); };
  const on: ExtensionAPI["on"] = () => () => undefined;
  const state = researchState();
  const readState = vi.fn(() => Promise.resolve(structuredClone(state)));
  const text = { read: vi.fn(() => Promise.resolve({ page: 1, text: "Synthetic text" })), search: vi.fn(() => Promise.resolve([{ referenceId: refId, documentId: docId, pdfSha256: pdfHash, page: 1, excerpt: "Synthetic text" }])) };
  registerWorkbenchTools({ registerTool, on, events }, readState, text);
  const execute = async (name: string, params: unknown, ctx = context) => {
    const tool = tools.get(`research_library_native_${name}`);
    if (tool === undefined) throw new Error("Tool not registered");
    return tool.execute("call", params, signal, undefined, ctx);
  };
  return { tools, state, readState, text, execute };
}

describe("native companion tools", () => {
  it("registers unique native tools without a daemon and reads bounded catalog, text and citations", async () => {
    const f = toolsFixture();
    expect([...f.tools.keys()]).toEqual(["research_library_native_catalog_search", "research_library_native_read_passage", "research_library_native_search_text", "research_library_native_get_evidence", "research_library_native_resolve_citations", "research_library_native_submit_result"]);
    expect((await f.execute("catalog_search", { query: "methods" })).details).toMatchObject({ total: 1, nextOffset: null });
    expect((await f.execute("catalog_search", { offset: 25 })).details).toMatchObject({ items: [], total: 1 });
    expect((await f.execute("read_passage", { referenceId: refId, documentId: docId, page: 1 })).details).toMatchObject({ pdfSha256: pdfHash, text: "Synthetic text" });
    expect((await f.execute("search_text", { query: "synthetic", referenceIds: [refId] })).details).toHaveLength(1);
    expect((await f.execute("resolve_citations", { keys: ["old-key", "unknown"] })).details).toEqual([{ key: "old-key", status: "resolved", referenceIds: [refId] }, { key: "unknown", status: "unknown", referenceIds: [] }]);
    expect(f.readState).toHaveBeenCalledWith("/synthetic", signal);
  });
  it("atomically rejects merging active evidence and keeps native anchored evidence readable", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-merge-evidence-"));
    try {
      const store = new WorkbenchStore(); const state = completeState(); const survivor = testReference(2);
      const loser = state.references[0], evidence = state.evidence[0];
      if (loser === undefined || evidence === undefined) throw new Error("Missing fixture");
      state.references.push(survivor);
      await store.update(root, draft => { Object.assign(draft, state); });
      const f = toolsFixture(); f.readState.mockImplementation(() => store.read(root));
      const before = await store.read(root);
      const result = await f.execute("get_evidence", { evidenceIds: [evidence.id] });
      await expect(new LibraryCatalog(store, bibliographyCodec).handle(root, "library.merge", { keepId: survivor.id, removeId: loser.id, keepRevision: 1, removeRevision: 1 }, signal)).rejects.toThrow("active evidence");
      expect(await store.read(root)).toEqual(before);
      expect(await f.execute("get_evidence", { evidenceIds: [evidence.id] })).toEqual(result);
      expect(result.details).toEqual([evidence]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rejects extra fields, deleted sources, missing evidence and output overflow", async () => {
    const f = toolsFixture();
    await expect(f.execute("catalog_search", { path: "/other" })).rejects.toThrow("unsupported");
    await expect(f.execute("get_evidence", { evidenceIds: [evId] })).rejects.toThrow("missing");
    f.text.read.mockResolvedValueOnce({ page: 1, text: "x".repeat(70_000) });
    await expect(f.execute("read_passage", { referenceId: refId, documentId: docId, page: 1 })).rejects.toThrow("64 KiB");
    const reference = f.state.references[0]; if (reference === undefined) throw new Error("Missing fixture"); reference.deletedAt = "2026-01-01T00:00:00.000Z";
    await expect(f.execute("read_passage", { referenceId: refId, documentId: docId, page: 1 })).rejects.toThrow("not found");
    await expect(f.execute("search_text", { query: "synthetic", referenceIds: [refId] })).rejects.toThrow("not found");
  });
  it("matches shared result character/count bounds while enforcing the aggregate 128 KiB budget", () => {
    const large = { ...researchResult, markdown: "m".repeat(64_000), claims: [{ id: "large", text: "c".repeat(4_000), referenceIds: [refId], evidenceIds: [], relationship: "context" }], cells: [{ referenceId: refId, column: "large", value: "v".repeat(4_000), evidenceIds: [] }] };
    expect(parseResearchResult(large).markdown).toHaveLength(64_000);
    const matrix = { ...researchResult, cells: Array.from({ length: 500 }, (_, index) => ({ referenceId: refId, column: `column-${String(index)}`, value: "v", evidenceIds: [] })) };
    expect(parseResearchResult(matrix).cells).toHaveLength(500);
    expect(() => parseResearchResult({ ...matrix, cells: [...matrix.cells, { referenceId: refId, column: "overflow", value: "v", evidenceIds: [] }] })).toThrow("Too many");
    expect(() => parseResearchResult({ ...large, markdown: "m".repeat(64_001) })).toThrow("oversized");
    expect(() => parseResearchResult({ ...large, markdown: "界".repeat(64_000) })).toThrow("transport budget");
    expect(() => parseResearchResult({ ...large, cells: [{ referenceId: refId, column: "oversized", value: "v".repeat(4_001), evidenceIds: [] }] })).toThrow("oversized");
  });
  it("validates structured claims, duplicate cells, control characters and transport budget", () => {
    expect(parseResearchResult(researchResult)).toEqual(researchResult);
    for (const result of [{ ...researchResult, extra: true }, { ...researchResult, claims: [...researchResult.claims, ...researchResult.claims] }, { ...researchResult, cells: [...researchResult.cells, ...researchResult.cells] }, { ...researchResult, markdown: "bad\u0000" }, { ...researchResult, markdown: "界".repeat(64_000) }]) expect(() => parseResearchResult(result)).toThrow();
  });
});

describe("native session-local result protocol", () => {
  it("does not assume native session-manager IDs equal public host session IDs", async () => {
    const bus = researchBus(), f = toolsFixture(bus);
    const unused = (): never => { throw new Error("Unexpected session access"); };
    const sessionManager: ExtensionContext["sessionManager"] = { getSessionId: () => "different-native-id", getCwd: unused, getSessionDir: unused, getSessionFile: unused, getLeafId: unused, getLeafEntry: unused, getEntry: unused, getLabel: unused, getBranch: unused, buildContextEntries: unused, buildSessionProjection: unused, getHeader: unused, getEntries: unused, getTree: unused, getSessionName: unused };
    const ctx: ExtensionContext = { cwd: "/synthetic", mode: "json", hasUI: false, model: undefined, scopedModels: [], signal, sessionManager, get ui(): never { return unused(); }, get modelRegistry(): never { return unused(); }, isIdle: () => true, isProjectTrusted: () => true, abort: unused, hasPendingMessages: () => false, shutdown: unused, getContextUsage: () => undefined, compact: unused, getSystemPrompt: () => "" };
    const off = bus.on(WORKBENCH_RESULT_CHANNEL, value => {
      if (typeof value !== "object" || value === null || !("requestId" in value)) throw new Error("Invalid request");
      expect(value).not.toHaveProperty("sessionId");
      bus.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId: value.requestId, taskId, sessionId: "host-session-id", ok: true, revision: 3 });
    });
    const result = await f.execute("submit_result", { taskId, corpusHash: request.corpusHash, result: researchResult }, ctx);
    expect(result.details).toEqual({ taskId, revision: 3 });
    off(); expect(bus.listenerCount()).toBe(0);
  });
  it("subscribes before synchronous early replies and cleans listeners", async () => {
    const bus = researchBus();
    const off = bus.on(WORKBENCH_RESULT_CHANNEL, () => { bus.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId: request.requestId, taskId, sessionId: "host-session", ok: true, revision: 3 }); });
    await expect(submitNativeResult(bus, request, signal)).resolves.toEqual({ taskId, revision: 3 });
    off(); expect(bus.listenerCount()).toBe(0);
  });
  it("retries lost requests/acks with identical content and ignores mismatched identity", async () => {
    vi.useFakeTimers(); const bus = researchBus(); const received: unknown[] = [];
    const submission = submitNativeResult(bus, request, signal);
    await vi.advanceTimersByTimeAsync(500);
    const off = bus.on(WORKBENCH_RESULT_CHANNEL, value => {
      received.push(value);
      bus.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId: "wrong-request", taskId, sessionId: "host-session", ok: true, revision: 2 });
      if (received.length === 2) bus.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId: request.requestId, taskId, sessionId: "host-session", ok: true, revision: 4 });
    });
    await vi.advanceTimersByTimeAsync(500); await expect(submission).resolves.toMatchObject({ revision: 4 });
    expect(received).toEqual([request, request]); off(); expect(bus.listenerCount()).toBe(0);
  });
  it("fails missing backend visibly, bounds retries, and handles abort", async () => {
    vi.useFakeTimers(); const bus = researchBus();
    const failure = expect(submitNativeResult(bus, request, signal)).rejects.toThrow("No durable native backend");
    await vi.advanceTimersByTimeAsync(20_000); await failure; expect(bus.listenerCount()).toBe(0); expect(vi.getTimerCount()).toBe(0);
    const abort = new AbortController(); const aborted = expect(submitNativeResult(bus, request, abort.signal)).rejects.toThrow("aborted"); abort.abort(); await aborted; expect(bus.listenerCount()).toBe(0);
  });
  it("never treats negative or malformed acknowledgement as publication", async () => {
    const bus = researchBus();
    const off = bus.on(WORKBENCH_RESULT_CHANNEL, () => { bus.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId: request.requestId, taskId, sessionId: "host-session", ok: false, error: "Synthetic disk full" }); });
    await expect(submitNativeResult(bus, request, signal)).rejects.toThrow("disk full"); off();
    const malformed = bus.on(WORKBENCH_RESULT_CHANNEL, () => { bus.emit(WORKBENCH_ACK_CHANNEL, { version: 1, requestId: request.requestId, taskId, sessionId: "host-session", ok: true, revision: -1 }); });
    await expect(submitNativeResult(bus, request, signal)).rejects.toThrow("Invalid native"); malformed();
    expect(bus.listenerCount()).toBe(0);
  });
});
