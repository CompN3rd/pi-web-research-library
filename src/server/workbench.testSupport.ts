import { emptyLibrary, emptyReferenceFields, type LibraryEvidence, type LibraryReference, type LibraryState } from "../domain/workbench.js";

export const date = "2026-01-01T00:00:00.000Z";
export function testId(prefix: string, number = 1): string { return `${prefix}-${number.toString(16).padStart(32, "0")}`; }
export function reference(number = 1): LibraryReference {
  return { ...emptyReferenceFields(), id: testId("ref", number), citekey: `Test${String(number)}`, title: `Synthetic reference ${String(number)}`, revision: 1,
    createdAt: date, updatedAt: date, deletedAt: null, documents: [], aliases: [], provenance: [] };
}
export function evidence(): LibraryEvidence {
  return { id: testId("ev"), referenceId: testId("ref"), revision: 1, documentId: null, pdfSha256: null, page: null, rect: null,
    quote: "", body: "Synthetic note", kind: "note", status: "open", tags: [], createdAt: date, updatedAt: date, deletedAt: null };
}
export function completeState(): LibraryState {
  const state = emptyLibrary(); const ref = reference();
  ref.documents.push({ id: testId("doc"), path: "raw/synthetic.pdf", sha256: "a".repeat(64), size: 100, label: "Synthetic PDF", sourceUrl: "https://example.invalid/source", rights: "Synthetic test", addedAt: date });
  ref.collectionIds.push(testId("col"));
  state.references.push(ref);
  state.collections.push({ id: testId("col"), name: "Synthetic", parentId: null, revision: 1 });
  state.evidence.push({ ...evidence(), documentId: testId("doc"), pdfSha256: "a".repeat(64), page: 1, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, quote: "Synthetic excerpt" });
  state.tasks.push({ id: testId("task"), revision: 1, kind: "summary", goal: "Summarize synthetic data", referenceIds: [ref.id],
    corpus: [{ referenceId: ref.id, revision: 1, documentHashes: ["a".repeat(64)], evidence: [{ id: testId("ev"), revision: 1 }] }],
    corpusHash: "b".repeat(64), createdAt: date, updatedAt: date, sessionId: "synthetic-session", status: "completed", message: "Done",
    result: { markdown: "Synthetic result", claims: [{ id: "claim-1", text: "Synthetic claim", referenceIds: [ref.id], evidenceIds: [testId("ev")], relationship: "uncertain" }],
      cells: [{ referenceId: ref.id, column: "Method", value: "Synthetic", evidenceIds: [testId("ev")] }], warnings: ["Synthetic only"] }, review: "accepted", reviewedAt: date });
  state.manuscripts.push({ id: testId("ms"), revision: 1, title: "Synthetic manuscript", markdown: "Claim [@Test1].", referenceIds: [ref.id], taskIds: [testId("task")], style: "apa", createdAt: date, updatedAt: date, deletedAt: null });
  state.savedSearches.push({ id: testId("search"), name: "Synthetic query", query: "synthetic", provider: "local", checkedAt: null });
  return state;
}
