import { vi } from "vitest";
import type { WorkspacePanelContext, WorkspaceFilesCapabilityV1 } from "@jmfederico/pi-web/plugin-api";
import type { LibraryEvidence, LibraryManuscript, LibraryReference, LibraryTask } from "../domain/workbench.js";
import { emptyReferenceFields } from "../domain/workbench.js";
import { object } from "./workbenchClient.js";
import { toJson, type ResearchPeer } from "./peerClient.js";

export const refId = `ref-${"1".repeat(32)}`;
export const secondRefId = `ref-${"2".repeat(32)}`;
export const docId = `doc-${"3".repeat(32)}`;
export const evId = `ev-${"4".repeat(32)}`;
export const taskId = `task-${"5".repeat(32)}`;
export const msId = `ms-${"6".repeat(32)}`;
export const sha = "a".repeat(64);
export const now = "2026-01-01T00:00:00.000Z";
export function syntheticReference(id = refId, title = "Synthetic paper"): LibraryReference {
  return { ...emptyReferenceFields(), id, title, citekey: id === refId ? "Synthetic2026" : "Other2026", authors: ["Example, A."], year: 2026, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, aliases: [], provenance: ["Synthetic UI fixture"], documents: [{ id: docId, path: "raw/research-library/synthetic.pdf", size: 100, sha256: sha, label: "Synthetic PDF", sourceUrl: "https://example.test/paper", rights: "Synthetic fixture", addedAt: now }] };
}
export function syntheticEvidence(): LibraryEvidence {
  return { id: evId, revision: 1, referenceId: refId, documentId: docId, pdfSha256: sha, page: 3, rect: { x: .1, y: .2, width: .3, height: .1 }, quote: "Synthetic passage", body: "Check this claim", kind: "question", status: "open", tags: [], createdAt: now, updatedAt: now, deletedAt: null };
}
export function syntheticTask(review: LibraryTask["review"] = "unreviewed"): LibraryTask {
  return { id: taskId, revision: 1, kind: "summary", goal: "Summarize synthetic evidence", referenceIds: [refId], corpus: [{ referenceId: refId, revision: 1, documentHashes: [sha], evidence: [{ id: evId, revision: 1 }] }], corpusHash: sha, sessionId: "synthetic-host-session", status: "completed", message: "Structured result validated", createdAt: now, updatedAt: now, review, reviewedAt: null, result: { markdown: "Synthetic result [@Synthetic2026]", warnings: ["Human review required"], claims: [{ id: "claim-1", text: "Synthetic claim", referenceIds: [refId], evidenceIds: [evId], relationship: "uncertain" }], cells: [{ referenceId: refId, column: "Method", value: "Synthetic method", evidenceIds: [evId] }] } };
}
export function syntheticManuscript(): LibraryManuscript {
  return { id: msId, revision: 1, title: "Synthetic draft", markdown: "A claim [@Synthetic2026]", referenceIds: [refId], taskIds: [], style: "apa", createdAt: now, updatedAt: now, deletedAt: null };
}

/** Public host boundaries only; domain storage semantics belong to server tests. */
export function workbenchHost(workspaceId = "synthetic-workspace") {
  const refs = [syntheticReference(), syntheticReference(secondRefId, "Other synthetic paper")];
  const notes: LibraryEvidence[] = [];
  const tasks: LibraryTask[] = [];
  const manuscripts: LibraryManuscript[] = [];
  const overrides = new Map<string, (payload: Record<string, unknown>) => unknown>();
  const request = vi.fn<ResearchPeer["request"]>(async (operation, envelope) => {
    const input = object(envelope);
    if (input["version"] !== 1) throw new Error("Unexpected protocol version");
    const payload = object(input["payload"]);
    const override = overrides.get(operation);
    if (override !== undefined) return toJson(await override(payload));
    const paged = (items: unknown[]) => ({ items, total: items.length, nextOffset: null });
    switch (operation) {
      case "library.list": return toJson(paged(refs.filter(ref => Boolean(ref.deletedAt) === payload["trash"])));
      case "library.get": { const ref = refs.find(ref => ref.id === payload["id"]); if (ref === undefined) throw new Error("Reference not found"); return toJson(ref); }
      case "collections.list": return [];
      case "evidence.list": return toJson(paged(notes));
      case "tasks.list": return toJson(paged(tasks));
      case "tasks.get": { const task = tasks.find(task => task.id === payload["id"]); if (task === undefined) throw new Error("Task not found"); return toJson(task); }
      case "writing.list": return toJson(paged(manuscripts));
      default: throw new Error(`Unexpected operation: ${operation}`);
    }
  });
  const uploadCancel = vi.fn();
  const files: WorkspaceFilesCapabilityV1 = {
    capabilityVersion: 1, maxInlinePreviewBytes: 10 * 1024 * 1024, defaultUploadFolder: ".pi-web/uploads",
    previewUrl: path => `http://localhost:3000/${path}`, downloadUrl: path => `http://localhost:3000/${path}`,
    readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn(),
    uploadFile: vi.fn((file: File) => ({ path: `raw/research-library/${file.name}`, completed: Promise.resolve({ path: `raw/research-library/${file.name}`, size: file.size, modifiedAt: now, created: true }), cancel: uploadCancel })),
  };
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Synthetic local", kind: "local" },
    workspace: { id: workspaceId, projectId: "synthetic-project", path: "/synthetic", label: workspaceId, isMain: true },
    files, peer: { request }, prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null }, terminal: { open: vi.fn(), runCommand: vi.fn() }, host: { requestRender: vi.fn() },
  };
  const payloads = (operation: string): Record<string, unknown>[] => request.mock.calls.filter(call => call[0] === operation).map(call => object(object(call[1])["payload"]));
  return { context, request, refs, notes, tasks, manuscripts, overrides, files, uploadCancel, payloads };
}
