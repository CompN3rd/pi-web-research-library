import type { PluginPeer } from "@jmfederico/pi-web/plugin-api";
import { applyAnnotationChanges, createAnnotationRecord, MAX_RESEARCH_ANNOTATIONS_PER_PAPER, parseResearchAnnotation, sortAnnotations, type NewResearchAnnotationInput, type ResearchAnnotation, type ResearchAnnotationChanges } from "./annotationModel.js";
import { ANNOTATION_PAGE_SIZE, integer, record, type PaperScope } from "../domain/protocol.js";
import { researchRequest } from "./peerClient.js";

export type PaperAnnotationsLoadResult =
  | { kind: "loaded"; annotations: ResearchAnnotation[]; warnings: string[] }
  | { kind: "unavailable"; error: string };
export interface AnnotationWriteOptions { now?: Date; randomBytes?: (target: Uint8Array<ArrayBuffer>) => void }

export async function loadPaperAnnotations(peer: PluginPeer | undefined, scope: PaperScope, signal?: AbortSignal): Promise<PaperAnnotationsLoadResult> {
  const annotations: ResearchAnnotation[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  try {
    for (let offset = 0; offset < MAX_RESEARCH_ANNOTATIONS_PER_PAPER; offset += ANNOTATION_PAGE_SIZE) {
      const page = record(await researchRequest(peer, "annotations.list", { scope, offset }, signal), ["annotations", "warnings", "nextOffset"]);
      if (!Array.isArray(page["annotations"]) || page["annotations"].length > ANNOTATION_PAGE_SIZE || !Array.isArray(page["warnings"]) || page["warnings"].length > ANNOTATION_PAGE_SIZE) throw new Error("Invalid annotation page");
      for (const item of page["annotations"]) {
        const annotation = responseAnnotation(item, scope);
        if (ids.has(annotation.id)) throw new Error("Annotation listing changed during pagination. Refresh.");
        ids.add(annotation.id);
        annotations.push(annotation);
      }
      for (const warning of page["warnings"]) {
        if (typeof warning !== "string" || warning.length > 1024) throw new Error("Invalid annotation warning");
        warnings.push(warning);
      }
      if (page["nextOffset"] === null) return { kind: "loaded", annotations: sortAnnotations(annotations), warnings };
      if (integer(page["nextOffset"], 1, MAX_RESEARCH_ANNOTATIONS_PER_PAPER - 1) !== offset + ANNOTATION_PAGE_SIZE) throw new Error("Invalid annotation pagination");
    }
    throw new Error("Too many annotation records");
  } catch (error) {
    return { kind: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createPaperAnnotation(peer: PluginPeer | undefined, input: NewResearchAnnotationInput, options: AnnotationWriteOptions = {}): Promise<ResearchAnnotation> {
  return publishPaperAnnotation(peer, createAnnotationRecord(input, options));
}

/** Keep this exact record for retry/reconciliation if a response is lost. */
export async function publishPaperAnnotation(peer: PluginPeer | undefined, annotation: ResearchAnnotation): Promise<ResearchAnnotation> {
  const scope = scopeOf(annotation);
  return responseAnnotation(await researchRequest(peer, "annotations.create", { scope, annotation }), scope);
}

export async function saveAnnotationChanges(peer: PluginPeer | undefined, annotation: ResearchAnnotation, changes: ResearchAnnotationChanges, options: AnnotationWriteOptions = {}): Promise<ResearchAnnotation> {
  const updated = applyAnnotationChanges(annotation, changes, options.now ?? new Date());
  const scope = scopeOf(annotation);
  return responseAnnotation(await researchRequest(peer, "annotations.update", { scope, before: annotation, after: updated }), scope);
}

export async function deleteAnnotationRecord(peer: PluginPeer | undefined, annotation: ResearchAnnotation): Promise<void> {
  const result = record(await researchRequest(peer, "annotations.delete", { scope: scopeOf(annotation), annotation }), ["deleted"]);
  if (result["deleted"] !== true) throw new Error("Deletion was not confirmed");
}
function scopeOf(annotation: ResearchAnnotation): PaperScope {
  return { libraryId: annotation.libraryId, paperId: annotation.paperId, pdfSha256: annotation.pdfSha256 };
}
function responseAnnotation(value: unknown, scope: PaperScope): ResearchAnnotation {
  const parsed = parseResearchAnnotation(value);
  if (!parsed.ok) throw new Error(parsed.error);
  const annotation = parsed.annotation;
  if (annotation.libraryId !== scope.libraryId || annotation.paperId !== scope.paperId || annotation.pdfSha256 !== scope.pdfSha256) throw new Error("Annotation belongs to a different library, paper or PDF revision");
  return annotation;
}
