import { describe, expect, it, vi } from "vitest";
import { applyAnnotationChanges, createAnnotationRecord } from "./annotationModel.js";
import { createPaperAnnotation, deleteAnnotationRecord, loadPaperAnnotations, saveAnnotationChanges } from "./annotationsClient.js";
import { annotationPeer } from "./peer.testSupport.js";
import { toJson, type ResearchPeer } from "./peerClient.js";

const scope = { libraryId: "pilot-demo", paperId: "pilot-paper", pdfSha256: "b".repeat(64) };
const input = { ...scope, page: 1, rect: { x: 0, y: 0, width: 0.1, height: 0.1 }, quote: "quote", body: "question", kind: "question" as const };

describe("annotation peer client", () => {
  it("fails visibly without a paired server", async () => {
    expect(await loadPaperAnnotations(undefined, scope)).toMatchObject({ kind: "unavailable" });
    await expect(createPaperAnnotation(undefined, input)).rejects.toThrow("server is unavailable");
  });
  it("creates, lists, edits and deletes exclusively through scoped peer requests", async () => {
    const peer = annotationPeer();
    const annotation = await createPaperAnnotation(peer, input);
    expect(await loadPaperAnnotations(peer, scope)).toMatchObject({ kind: "loaded", annotations: [annotation] });
    const changed = await saveAnnotationChanges(peer, annotation, { body: "edited" });
    expect(changed.revision).toBe(2);
    await deleteAnnotationRecord(peer, changed);
    expect(await loadPaperAnnotations(peer, scope)).toMatchObject({ kind: "loaded", annotations: [] });
    expect(peer.request.mock.calls[0]).toMatchObject(["annotations.create", { version: 1, payload: { scope } }, {}]);
  });
  it("rejects foreign records, invalid pagination and malformed pages", async () => {
    const foreign = createAnnotationRecord({ ...input, libraryId: "pilot-other" });
    for (const page of [
      { annotations: [foreign], warnings: [], nextOffset: null },
      { annotations: [], warnings: [], nextOffset: 1 },
      { annotations: [], warnings: [42], nextOffset: null },
    ]) {
      const peer = { request: vi.fn<ResearchPeer["request"]>().mockResolvedValue(toJson(page)) };
      expect(await loadPaperAnnotations(peer, scope)).toMatchObject({ kind: "unavailable" });
    }
  });
  it("sends the expected snapshot and immutable-anchor-preserving edit", async () => {
    const annotation = createAnnotationRecord(input);
    const now = new Date();
    const peer = annotationPeer();
    await saveAnnotationChanges(peer, annotation, { status: "resolved" }, { now });
    expect(peer.request.mock.calls[0]).toMatchObject(["annotations.update", { version: 1, payload: {
      before: annotation, after: applyAnnotationChanges(annotation, { status: "resolved" }, now),
    } }, {}]);
  });
});
