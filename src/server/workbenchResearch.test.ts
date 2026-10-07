import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebHostPiSessionRunCompletion, PiWebHostPiSessionRunInput, PiWebHostPiSessionEventsV1, ServerPluginPeerRequestContext } from "@jmfederico/pi-web/server-plugin-api";
import { LibraryResearch } from "./workbenchResearch.js";
import { libraryTaskKinds, type LibraryTask } from "../domain/workbench.js";
import { assertResearchTaskBudget, freezeCorpus, parseEvidence, parseTaskInput, researchHash, researchPreview, validateTaskResult } from "./workbenchResearchData.js";
import { WORKBENCH_ACK_CHANNEL, WORKBENCH_RESULT_CHANNEL } from "../domain/workbenchResearchProtocol.js";
import { submitNativeResult } from "../companion/workbenchTools.js";
import { deferred, docId, evidenceInput, evId, refId, researchBus, ResearchMemoryStore, researchResult, taskId } from "./workbenchResearch.testSupport.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });
function setup(store = new ResearchMemoryStore()) {
  const signal = new AbortController().signal, lifetime = new AbortController(), disconnected = new AbortController();
  const completion = deferred<PiWebHostPiSessionRunCompletion>(), bus = researchBus();
  const run = vi.fn((input: PiWebHostPiSessionRunInput) => { expect(input.prompt.length).toBeGreaterThan(0); return Promise.resolve({ sessionId: "native-session", completion: completion.promise }); });
  const close = vi.fn(() => { disconnected.abort(); });
  const events: PiWebHostPiSessionEventsV1 = { version: 1, connect: vi.fn(() => Promise.resolve({ signal: disconnected.signal, on: (channel: string, handler: (data: unknown) => void | Promise<void>) => bus.on(channel, value => { void handler(value); }), emit: bus.emit, close })) };
  const text = { read: vi.fn((_root: string, _ref: string, _doc: string, page: number) => Promise.resolve({ page, text: "Synthetic source passage" })), search: vi.fn(() => Promise.resolve([])) };
  const log = vi.fn();
  const service = new LibraryResearch(store, { sessions: { version: 1, run, create: vi.fn() }, events, lifetime: lifetime.signal, log, text });
  const context: Pick<ServerPluginPeerRequestContext, "project" | "workspace"> = { project: { id: "host-project", name: "Synthetic", path: "/synthetic" }, workspace: { id: "host-workspace", projectId: "host-project", path: "/synthetic", label: "Synthetic", isMain: true } };
  const call = (operation: string, input: unknown) => service.handle(context, operation, input, signal);
  const start = async (id = taskId) => {
    const input = { id, kind: "summary", goal: "Explain synthetic methods", referenceIds: [refId] };
    const preview = researchPreview(store.state, parseTaskInput({ kind: input.kind, goal: input.goal, referenceIds: input.referenceIds }, false));
    return call("tasks.start", { ...input, expectedCorpusHash: preview.corpusHash });
  };
  const current = (): LibraryTask => { const task = store.state.tasks[0]; if (task === undefined) throw new Error("Task missing"); return task; };
  const ready = async () => { await vi.waitFor(() => { expect(bus.listenerCount()).toBe(1); }); };
  const submit = (result: unknown = researchResult) => submitNativeResult(bus, { version: 1, requestId: "b".repeat(32), taskId, corpusHash: current().corpusHash, result }, signal);
  cleanup.push(() => service.dispose());
  return { service, store, call, start, current, ready, submit, run, context, completion, bus, signal, lifetime, disconnected, close, text, log, events };
}

describe("native evidence", () => {
  it("matches shared 16000-character evidence and 8000-character task-goal bounds", () => {
    const evidence = { ...evidenceInput, quote: "q".repeat(16_000), body: "b".repeat(16_000) };
    expect(parseEvidence(evidence).fields.quote).toHaveLength(16_000);
    expect(parseEvidence(evidence).fields.body).toHaveLength(16_000);
    expect(() => parseEvidence({ ...evidence, quote: "q".repeat(16_001) })).toThrow("oversized");
    expect(() => parseEvidence({ ...evidence, body: "b".repeat(16_001) })).toThrow("oversized");
    const input = { kind: "summary", goal: "g".repeat(8_000), referenceIds: [refId] };
    expect(parseTaskInput(input, false).goal).toHaveLength(8_000);
    expect(() => parseTaskInput({ ...input, goal: "g".repeat(8_001) }, false)).toThrow("oversized");
  });
  it("validates source identity/pages, saves immutable anchors, checks revisions and tombstones", async () => {
    const f = setup();
    await expect(f.call("evidence.save", evidenceInput)).resolves.toMatchObject({ revision: 1 });
    expect(f.text.read).toHaveBeenCalledWith("/synthetic", refId, docId, 1, f.signal);
    await expect(f.call("evidence.save", evidenceInput)).resolves.toMatchObject({ revision: 1 });
    await expect(f.call("evidence.save", { ...evidenceInput, expectedRevision: 1, quote: "changed" })).rejects.toThrow("immutable");
    await expect(f.call("evidence.save", { ...evidenceInput, expectedRevision: 1, body: "Edited", status: "resolved" })).resolves.toMatchObject({ revision: 2 });
    await expect(f.call("evidence.delete", { id: evId, expectedRevision: 1 })).rejects.toThrow("Stale");
    await expect(f.call("evidence.delete", { id: evId, expectedRevision: 2 })).resolves.toMatchObject({ revision: 3 });
    await expect(f.call("evidence.save", evidenceInput)).rejects.toThrow("Deleted");
    await expect(f.call("evidence.list", {})).resolves.toMatchObject({ total: 0 });
    await expect(f.call("evidence.list", { trash: true, query: "Edited" })).resolves.toMatchObject({ total: 1 });
  });
  it("allows honest unanchored notes and rejects malformed or mismatched anchors", async () => {
    const f = setup();
    for (const patch of [{ page: 0 }, { rect: { x: 0.9, y: 0, width: 0.3, height: 0.1 } }, { pdfSha256: "b".repeat(64) }, { extra: true }, { documentId: null }, { tags: ["x", "x"] }]) await expect(f.call("evidence.save", { ...evidenceInput, ...patch })).rejects.toThrow();
    f.text.read.mockRejectedValueOnce(new Error("Page out of range"));
    await expect(f.call("evidence.save", evidenceInput)).rejects.toThrow("Page out");
    await expect(f.call("evidence.save", { ...evidenceInput, documentId: null, pdfSha256: null, page: null, rect: null, quote: "", kind: "note" })).resolves.toMatchObject({ documentId: null, revision: 1 });
    expect(f.store.state.evidence).toHaveLength(1);
  });
  it("rechecks source identity after asynchronous text verification", async () => {
    const f = setup();
    f.text.read.mockImplementationOnce(() => { f.store.state.references[0]?.documents.splice(0); return Promise.resolve({ page: 1, text: "Synthetic" }); });
    await expect(f.call("evidence.save", evidenceInput)).rejects.toThrow("PDF identity");
    expect(f.store.state.evidence).toHaveLength(0);
  });
});

describe("native research lifecycle", () => {
  it("provides every recipe, frozen preview, untrusted separation and prompt bounds without execution", async () => {
    const f = setup();
    for (const kind of libraryTaskKinds) {
      const preview = researchPreview(f.store.state, parseTaskInput({ kind, goal: "Synthetic task", referenceIds: [refId] }, false));
      expect(preview.prompt).toContain("UNTRUSTED CORPUS"); expect(preview.prompt).toContain("research_library_native_submit_result");
      expect(preview.warnings.join(" ")).toContain("not a tool sandbox");
    }
    expect(f.run).not.toHaveBeenCalled();
    const reference = f.store.state.references[0]; if (reference === undefined) throw new Error("Missing fixture");
    reference.notes = "é".repeat(40_000);
    await expect(f.call("tasks.preview", { kind: "summary", goal: "Synthetic", referenceIds: [refId] })).rejects.toThrow("budget");
  });
  it("publishes before acknowledging, handles identical replay, waits for completion then explicit review", async () => {
    const f = setup(); await f.call("evidence.save", evidenceInput);
    await f.start(); await f.ready();
    expect(f.run.mock.calls[0]?.[0]).toMatchObject({ projectId: "host-project", workspaceId: "host-workspace" });
    expect(f.run.mock.calls[0]?.[0].prompt).not.toContain("/synthetic");
    expect(await f.submit()).toMatchObject({ taskId });
    expect(f.current()).toMatchObject({ status: "running", review: "unreviewed", result: researchResult });
    const revision = f.current().revision; await f.submit(); expect(f.current().revision).toBe(revision);
    await expect(f.submit({ ...researchResult, markdown: "different" })).rejects.toThrow("different result");
    await expect(f.call("tasks.review", { id: taskId, expectedRevision: revision, decision: "accepted" })).rejects.toThrow("completed");
    f.completion.resolve({ status: "completed" });
    await vi.waitFor(() => { expect(f.current().status).toBe("completed"); });
    await expect(f.call("tasks.review", { id: taskId, expectedRevision: f.current().revision, decision: "accepted" })).resolves.toMatchObject({ review: "accepted" });
    expect(f.store.state.evidence[0]?.status).toBe("open");
    await f.start(); expect(f.run).toHaveBeenCalledOnce();
  });
  it("does not equate result submission with final success or accept stale results", async () => {
    const f = setup(); await f.call("evidence.save", evidenceInput); await f.start(); await f.ready(); await f.submit();
    f.completion.resolve({ status: "failed", error: "Final provider failure" });
    await vi.waitFor(() => { expect(f.current().status).toBe("failed"); });
    await expect(f.call("tasks.review", { id: taskId, expectedRevision: f.current().revision, decision: "accepted" })).rejects.toThrow("completed");
    expect(f.current().message).toContain("provider failure");
  });
  it("fails visibly when a companion result is missing and retains cancelled outcomes", async () => {
    for (const status of ["completed", "cancelled"] as const) {
      const f = setup(); await f.start(); await f.ready(); f.completion.resolve({ status });
      await vi.waitFor(() => { expect(f.current().status).toBe(status === "completed" ? "failed" : "cancelled"); });
      if (status === "completed") expect(f.current().message).toContain("Companion");
    }
  });
  it("validates session identities, claim/cell attribution, frozen revisions and accepted freshness", async () => {
    const f = setup(); await f.call("evidence.save", evidenceInput); await f.start(); await f.ready();
    const acks: unknown[] = []; const off = f.bus.on(WORKBENCH_ACK_CHANNEL, data => { acks.push(data); });
    f.bus.emit(WORKBENCH_RESULT_CHANNEL, { version: 1, requestId: "f".repeat(32), taskId: `task-${"9".repeat(32)}`, corpusHash: f.current().corpusHash, result: researchResult });
    await vi.waitFor(() => { expect(acks).toHaveLength(1); }); expect(acks[0]).toMatchObject({ ok: false }); off();
    const invalid = structuredClone(researchResult); const claim = invalid.claims[0]; if (claim === undefined) throw new Error("Missing claim"); claim.evidenceIds = [`ev-${"9".repeat(32)}`];
    await expect(f.submit(invalid)).rejects.toThrow("outside");
    await f.submit(); f.completion.resolve({ status: "completed" }); await vi.waitFor(() => { expect(f.current().status).toBe("completed"); });
    await f.call("evidence.save", { ...evidenceInput, expectedRevision: 1, body: "Now changed" });
    await expect(f.call("tasks.review", { id: taskId, expectedRevision: f.current().revision, decision: "accepted" })).rejects.toThrow("stale");
  });
  it("persists admission once, enforces concurrency, and recovers restart without resubmission", async () => {
    const f = setup(); await f.start(); await f.ready(); await f.start(); expect(f.run).toHaveBeenCalledOnce();
    await expect(f.start(`task-${"5".repeat(32)}`)).rejects.toThrow("already running");
    f.disconnected.abort(); await vi.waitFor(() => { expect(f.current().status).toBe("interrupted"); });
    // Simulate an abrupt process loss leaving the last durable running receipt.
    f.current().status = "running";
    const restarted = setup(f.store);
    await expect(restarted.call("tasks.get", { id: taskId })).resolves.toMatchObject({ status: "interrupted" });
    await restarted.start(); expect(restarted.run).not.toHaveBeenCalled();
    await expect(restarted.call("tasks.start", { id: taskId, kind: "summary", goal: "changed", referenceIds: [refId], expectedCorpusHash: f.current().corpusHash })).rejects.toThrow("different content");
  });
  it("does not invoke sessions on failed storage or stale consent; failed result write is never acknowledged as success", async () => {
    const f = setup(); f.store.failUpdates = true;
    await expect(f.start()).rejects.toThrow("disk full"); expect(f.run).not.toHaveBeenCalled(); f.store.failUpdates = false;
    await expect(f.call("tasks.start", { id: taskId, kind: "summary", goal: "Synthetic", referenceIds: [refId], expectedCorpusHash: "0".repeat(64) })).rejects.toThrow("changed since preview");
    await f.call("evidence.save", evidenceInput); await f.start(); await f.ready(); f.store.failUpdates = true;
    await expect(f.submit()).rejects.toThrow("disk full"); expect(f.current().result).toBeNull(); f.store.failUpdates = false;
    await f.submit(); expect(f.current().result).not.toBeNull();
  });
  it("rejects an individually valid result when its frozen task cannot fit the entity budget", async () => {
    const f = setup(); await f.call("evidence.save", evidenceInput); await f.start(); await f.ready();
    // Model an existing durable running receipt with a large, valid frozen corpus.
    // Admission's prompt bound is independent of this publication boundary.
    const original = f.store.state.evidence[0]; if (original === undefined) throw new Error("Missing evidence");
    for (let i = 0; i < 2_500; i++) f.store.state.evidence.push({ ...original, id: `ev-${i.toString(16).padStart(32, "0")}` });
    f.current().corpus = freezeCorpus(f.store.state, [refId]);
    f.current().corpusHash = researchHash(JSON.stringify(f.current().corpus));
    expect(() => { assertResearchTaskBudget(f.current()); }).not.toThrow();
    const largeResult = { ...researchResult, markdown: "m".repeat(64_000) };
    expect(validateTaskResult(largeResult, f.store.state, f.current()).markdown).toHaveLength(64_000);
    await expect(f.submit(largeResult)).rejects.toThrow("190 KiB task budget");
    expect(f.current().result).toBeNull();
    await expect(f.submit()).resolves.toMatchObject({ taskId });
    expect(f.current().result).toEqual(researchResult);
  });
  it("supports result calls before connection subscription and survives lost acknowledgement", async () => {
    vi.useFakeTimers(); const f = setup(); await f.call("evidence.save", evidenceInput);
    const connecting = deferred<Awaited<ReturnType<PiWebHostPiSessionEventsV1["connect"]>>>();
    const connection = await f.events.connect({ projectId: "host-project", workspaceId: "host-workspace", sessionId: "native-session" });
    vi.spyOn(f.events, "connect").mockImplementation(() => connecting.promise);
    await f.start(); await vi.advanceTimersByTimeAsync(0);
    const submitted = f.submit();
    connecting.resolve(connection);
    await vi.advanceTimersByTimeAsync(250);
    await expect(submitted).resolves.toMatchObject({ taskId });
  });
  it("bounds global concurrency and releases capacity on disposal without stopping sessions", async () => {
    const f = setup();
    for (let i = 0; i < 4; i++) {
      const context = { ...f.context, workspace: { ...f.context.workspace, id: `workspace-${String(i)}`, path: `/synthetic-${String(i)}` } };
      await f.service.handle(context, "tasks.start", { id: `task-${String(i).repeat(32)}`, kind: "summary", goal: "Synthetic", referenceIds: [refId], expectedCorpusHash: researchPreview(f.store.state, parseTaskInput({ kind: "summary", goal: "Synthetic", referenceIds: [refId] }, false)).corpusHash }, f.signal);
    }
    await expect(f.start()).rejects.toThrow("Global");
  });
  it("keeps admitted tracking independent of browser cancellation and rejects stale publication", async () => {
    const f = setup(); await f.call("evidence.save", evidenceInput);
    const requestSignal = new AbortController();
    const preview = researchPreview(f.store.state, parseTaskInput({ kind: "summary", goal: "Synthetic", referenceIds: [refId] }, false));
    await f.service.handle(f.context, "tasks.start", { id: taskId, kind: "summary", goal: "Synthetic", referenceIds: [refId], expectedCorpusHash: preview.corpusHash }, requestSignal.signal);
    requestSignal.abort(); await f.ready();
    await f.call("evidence.save", { ...evidenceInput, expectedRevision: 1, body: "New revision" });
    await expect(f.submit()).rejects.toThrow("stale"); expect(f.current().result).toBeNull();
  });
  it("bounds stalled initial turns and closes connections without cancelling user sessions", async () => {
    vi.useFakeTimers(); const f = setup(); await f.start(); await vi.advanceTimersByTimeAsync(0);
    expect(f.current().status).toBe("running");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(f.current().status).toBe("interrupted"); expect(f.current().message).toContain("timed out");
    expect(f.close).toHaveBeenCalledOnce(); expect(f.bus.listenerCount()).toBe(0);
  });
  it("validates recipe matrix and warning semantics deterministically", async () => {
    const f = setup(); await f.call("evidence.save", evidenceInput); await f.start();
    const task = { ...f.current(), kind: "comparison" as const };
    expect(() => validateTaskResult({ ...researchResult, cells: [] }, f.store.state, task)).toThrow("matrix");
    expect(() => validateTaskResult({ ...researchResult, claims: [] }, f.store.state, task)).toThrow("attributed");
    const result = structuredClone(researchResult); for (const claim of result.claims) claim.evidenceIds = [];
    expect(validateTaskResult(result, f.store.state, task).warnings.join(" ")).toContain("human verification");
  });
});
