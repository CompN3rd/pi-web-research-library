import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emptyLibrary, emptyReferenceFields, type LibraryRepository, type LibraryResearchResult, type LibraryState } from "../domain/workbench.js";

export const refId = `ref-${"1".repeat(32)}`;
export const docId = `doc-${"2".repeat(32)}`;
export const evId = `ev-${"3".repeat(32)}`;
export const taskId = `task-${"4".repeat(32)}`;
export const pdfHash = "a".repeat(64);
export const evidenceInput = { id: evId, expectedRevision: 0, referenceId: refId, documentId: docId, pdfSha256: pdfHash, page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, quote: "Synthetic source passage", body: "Check methods", kind: "question", status: "open", tags: ["methods"] };
export const researchResult: LibraryResearchResult = { markdown: "Synthetic synthesis", claims: [{ id: "claim-1", text: "A synthetic finding", referenceIds: [refId], evidenceIds: [evId], relationship: "supports" }], cells: [{ referenceId: refId, column: "method", value: "synthetic", evidenceIds: [evId] }], warnings: [] };
export function researchState(): LibraryState {
  const state = emptyLibrary();
  state.references.push({ ...emptyReferenceFields(), id: refId, citekey: "synthetic2026", title: "Synthetic methods", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null, aliases: ["old-key"], provenance: [], documents: [{ id: docId, path: "raw/synthetic.pdf", sha256: pdfHash, size: 100, label: "Synthetic PDF", sourceUrl: "", rights: "synthetic", addedAt: "2026-01-01T00:00:00.000Z" }] });
  return state;
}

/** Atomic synthetic repository: a rejected callback never changes the durable snapshot. */
export class ResearchMemoryStore implements LibraryRepository {
  private readonly states = new Map<string, LibraryState>();
  get state(): LibraryState { return this.stateFor("/synthetic"); }
  stateFor(root: string): LibraryState { let state = this.states.get(root); if (state === undefined) { state = researchState(); this.states.set(root, state); } return state; }
  failUpdates = false;
  updates = 0;
  private queue: Promise<unknown> = Promise.resolve();
  async read(root: string, signal?: AbortSignal): Promise<LibraryState> { await this.queue; signal?.throwIfAborted(); return structuredClone(this.stateFor(root)); }
  update<T>(root: string, change: (state: LibraryState) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    const work = this.queue.then(async () => {
      signal?.throwIfAborted();
      if (this.failUpdates) throw new Error("Synthetic disk full");
      const draft = structuredClone(this.stateFor(root));
      const result = await change(draft);
      signal?.throwIfAborted();
      draft.revision++; this.states.set(root, draft); this.updates++;
      return structuredClone(result);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
export function researchBus(): ExtensionAPI["events"] & { listenerCount: () => number } {
  const handlers = new Map<string, Set<(value: unknown) => void>>();
  return {
    on(channel, handler) { const set = handlers.get(channel) ?? new Set(); set.add(handler); handlers.set(channel, set); return () => { set.delete(handler); }; },
    emit(channel, value) { for (const handler of handlers.get(channel) ?? []) handler(value); },
    listenerCount() { return [...handlers.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (reason: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
