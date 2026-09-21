import { vi } from "vitest";
import { annotationFilePath, parseResearchAnnotation } from "./annotationModel.js";
import { record } from "../domain/protocol.js";
import { toJson, type ResearchPeer } from "./peerClient.js";

/** Component boundary fake only. Real mutation semantics are tested against disk in server tests. */
export function annotationPeer(stored = new Map<string, string>()) {
  const request = vi.fn<ResearchPeer["request"]>((operation, envelope) => {
    const payload = record(envelope, ["version", "payload"])["payload"];
    if (operation === "annotations.list") return Promise.resolve(toJson({ annotations: [...stored.values()].map((text): unknown => JSON.parse(text)), warnings: [], nextOffset: null }));
    const input = record(payload, operation === "annotations.update" ? ["scope", "before", "after"] : ["scope", "annotation"]);
    const parsed = parseResearchAnnotation(input[operation === "annotations.update" ? "after" : "annotation"]);
    if (!parsed.ok) return Promise.reject(new Error(parsed.error));
    const annotation = parsed.annotation;
    const path = annotationFilePath(annotation.paperId, annotation.id);
    if (operation === "annotations.delete") { stored.delete(path); return Promise.resolve({ deleted: true }); }
    stored.set(path, JSON.stringify(annotation));
    return Promise.resolve(toJson(annotation));
  });
  return { request };
}

export function previewFiles() {
  return {
    capabilityVersion: 1 as const,
    maxInlinePreviewBytes: 10 * 1024 * 1024,
    defaultUploadFolder: ".pi-web/uploads",
    previewUrl: (path: string) => `https://pi.example.test/${encodeURIComponent(path)}`,
    downloadUrl: (path: string) => `https://pi.example.test/${encodeURIComponent(path)}`,
    uploadFile: vi.fn(),
  };
}
