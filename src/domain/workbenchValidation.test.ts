import { describe, expect, it } from "vitest";
import { completeState, testId } from "../server/workbench.testSupport.js";
import { validateLibraryResearchResult, validateReferenceFields, validateWorkbenchState } from "./workbenchValidation.js";
import { emptyReferenceFields } from "./workbench.js";

describe("workbench full-state validation", () => {
  it("round trips all supported nested content without stripping research or writing data", () => {
    const state = completeState();
    expect(validateWorkbenchState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it.each([
    ["reference", (s: ReturnType<typeof completeState>) => { Object.assign(s.references[0] ?? {}, { vendor: true }); }],
    ["document", (s: ReturnType<typeof completeState>) => { Object.assign(s.references[0]?.documents[0] ?? {}, { size: -1 }); }],
    ["collection", (s: ReturnType<typeof completeState>) => { Object.assign(s.collections[0] ?? {}, { parentId: testId("col") }); }],
    ["evidence", (s: ReturnType<typeof completeState>) => { Object.assign(s.evidence[0] ?? {}, { pdfSha256: "b".repeat(64) }); }],
    ["rectangle", (s: ReturnType<typeof completeState>) => { Object.assign(s.evidence[0]?.rect ?? {}, { width: 2 }); }],
    ["task", (s: ReturnType<typeof completeState>) => { Object.assign(s.tasks[0] ?? {}, { status: "invented" }); }],
    ["corpus", (s: ReturnType<typeof completeState>) => { Object.assign(s.tasks[0]?.corpus[0] ?? {}, { revision: 99 }); }],
    ["binding", (s: ReturnType<typeof completeState>) => { Object.assign(s.tasks[0]?.corpus[0]?.evidence[0] ?? {}, { extra: true }); }],
    ["result", (s: ReturnType<typeof completeState>) => { Object.assign(s.tasks[0]?.result ?? {}, { markdown: 42 }); }],
    ["claim", (s: ReturnType<typeof completeState>) => { Object.assign(s.tasks[0]?.result?.claims[0] ?? {}, { relationship: "verified" }); }],
    ["cell", (s: ReturnType<typeof completeState>) => { Object.assign(s.tasks[0]?.result?.cells[0] ?? {}, { referenceId: testId("ref", 9) }); }],
    ["manuscript", (s: ReturnType<typeof completeState>) => { Object.assign(s.manuscripts[0] ?? {}, { taskIds: [testId("task", 2)] }); }],
    ["search", (s: ReturnType<typeof completeState>) => { Object.assign(s.savedSearches[0] ?? {}, { provider: "vendor" }); }],
  ])("rejects corrupt nested %s", (_label, mutate) => {
    const state = completeState(); mutate(state); expect(() => validateWorkbenchState(state)).toThrow();
  });
  it.each(["claim", "cell"])("rejects %s evidence owned by another frozen reference", kind => {
    const state = completeState();
    const ref = state.references[0], ev = state.evidence[0], task = state.tasks[0];
    if (ref === undefined || ev === undefined || task?.result === null || task?.result === undefined) throw new Error("Missing fixture");
    const otherId = testId("ref", 2), otherEvidence = testId("ev", 2);
    state.references.push({ ...structuredClone(ref), id: otherId, citekey: "Other" });
    state.evidence.push({ ...structuredClone(ev), id: otherEvidence, referenceId: otherId });
    task.referenceIds.push(otherId);
    task.corpus.push({ referenceId: otherId, revision: 1, documentHashes: ref.documents.map(doc => doc.sha256), evidence: [{ id: otherEvidence, revision: 1 }] });
    expect(validateWorkbenchState(state)).toEqual(state);
    const attributed = kind === "claim" ? task.result.claims[0] : task.result.cells[0];
    if (attributed === undefined) throw new Error("Missing attribution");
    attributed.evidenceIds = [otherEvidence];
    expect(() => validateWorkbenchState(state)).toThrow(/outside its frozen source/u);
  });
  it("retains historical soft-deleted sources and stale frozen revisions", () => {
    const state = completeState();
    const ref = state.references[0]; const ev = state.evidence[0];
    if (ref === undefined || ev === undefined) throw new Error("Missing fixture");
    ref.revision = 2; ref.deletedAt = ref.updatedAt; ev.revision = 2; ev.deletedAt = ev.updatedAt;
    expect(validateWorkbenchState(state)).toEqual(state);
  });
  it("rejects duplicate IDs, active aliases and invalid temporal relationships", () => {
    const state = completeState(); const ref = state.references[0];
    if (ref === undefined) throw new Error("Missing fixture");
    state.references.push({ ...ref, id: testId("ref", 2), citekey: "Different", aliases: [ref.citekey] });
    expect(() => validateWorkbenchState(state)).toThrow(/collision/u);
    state.references.pop(); const ev = state.evidence[0]; if (ev === undefined) throw new Error("Missing fixture"); state.evidence.push(structuredClone(ev));
    expect(() => validateWorkbenchState(state)).toThrow(/Duplicate/u);
    state.evidence.pop(); ref.updatedAt = "2025-01-01T00:00:00.000Z";
    expect(() => validateWorkbenchState(state)).toThrow(/timestamps/u);
  });
  it("caps aggregate entity bytes independently of individual field maxima", () => {
    const state = completeState(); const manuscript = state.manuscripts[0];
    if (manuscript === undefined) throw new Error("Missing manuscript");
    manuscript.markdown = "文".repeat(128000);
    expect(() => validateWorkbenchState(state)).toThrow(/190KiB/u);
  });
  it("bounds text, result bytes, URLs and unknown fields", () => {
    const fields = { ...emptyReferenceFields(), title: "Synthetic", citekey: "Test" };
    expect(() => validateReferenceFields({ ...fields, abstract: "x".repeat(16001) })).toThrow();
    expect(() => validateReferenceFields({ ...fields, url: "javascript:alert(1)" })).toThrow();
    expect(() => validateReferenceFields({ ...fields, authors: ["x", "x"] })).toThrow();
    expect(() => validateReferenceFields({ ...fields, unexpected: null })).toThrow();
    expect(() => validateLibraryResearchResult({ markdown: "文".repeat(64000), claims: [], cells: [], warnings: [] })).toThrow(/128KiB/u);
  });
});
