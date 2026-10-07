import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY, PI_WEB_HOST_PI_SESSIONS_CAPABILITY, type PiWebHostPiSessionRunCompletion, type ServerPluginPeerRequestContext } from "@jmfederico/pi-web/server-plugin-api";
import plugin from "./server-plugin.js";
import { emptyReferenceFields, libraryObject } from "./domain/workbench.js";
import { submitNativeResult } from "./companion/workbenchTools.js";
import { researchFixture } from "./server/fixture.testSupport.js";
import { piSessionsCapability, piSessionEventsCapability } from "./server/workbenchRoutes.js";
import { task as decodeTask } from "./browser/workbenchClient.js";
import { toJson } from "./browser/peerClient.js";

/** Actual services/storage/codec/result protocol behind the public peer contract;
 * only host session execution/events are synthetic. No model or live daemon. */
describe("integrated native research and writing boundary", () => {
  it("declares the exact published sessions and session-events capabilities", () => {
    for (const [actual, published] of [[piSessionsCapability, PI_WEB_HOST_PI_SESSIONS_CAPABILITY], [piSessionEventsCapability, PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY]] as const) {
      expect(actual).toMatchObject({ pluginId: published.pluginId, id: published.id, version: published.version });
    }
    expect(() => piSessionsCapability.parse({ version: 2, create: vi.fn(), run: vi.fn() })).toThrow("pi-sessions");
    expect(() => piSessionEventsCapability.parse({ version: 2, connect: vi.fn() })).toThrow("pi-session-events");
  });

  it("persists reference → evidence → validated result → human acceptance → previewed manuscript, preserving source PDFs", async () => {
    const f = await researchFixture();
    const lifetime = new AbortController();
    const handlers = new Map<string, Set<(value: unknown) => void | Promise<void>>>();
    const errors: unknown[] = [];
    const events = {
      on(channel: string, handler: (value: unknown) => void | Promise<void>) { const listeners = handlers.get(channel) ?? new Set(); listeners.add(handler); handlers.set(channel, listeners); return () => { listeners.delete(handler); }; },
      emit(channel: string, value: unknown) { for (const handler of handlers.get(channel) ?? []) void Promise.resolve(handler(value)).catch((error: unknown) => errors.push(error)); },
    };
    const connection = new AbortController();
    let finishHost: ((value: PiWebHostPiSessionRunCompletion) => void) | undefined;
    const completion = new Promise<PiWebHostPiSessionRunCompletion>(resolve => { finishHost = resolve; });
    const run = vi.fn(() => Promise.resolve({ sessionId: "synthetic-public-host-session", completion }));
    const connect = vi.fn(() => Promise.resolve({ signal: connection.signal, ...events, close() { connection.abort(); } }));
    const activation = await plugin.activate({ apiVersion: 3, pluginId: "research-library", packageRoot: process.cwd(), dataDirectory: join(f.root, "plugin-data"), settings: {}, signal: new AbortController().signal, lifetimeSignal: lifetime.signal, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, execFile: vi.fn() });
    try {
      await activation.start?.({ signal: new AbortController().signal, capabilities: { resolve: capability => capability.parse(capability.id === "pi-sessions" ? { version: 1, run, create: vi.fn() } : { version: 1, connect }) } });
      const request = activation.peer?.request; if (request === undefined) throw new Error("Missing public peer");
      const scope: Pick<ServerPluginPeerRequestContext, "project" | "workspace"> = { project: { id: "p", name: "Synthetic", path: f.root }, workspace: { id: "w", projectId: "p", path: f.root, label: "Synthetic", isMain: true } };
      const call = async (operation: string, payload: unknown) => await request({ ...scope, operation, input: toJson({ version: 1, payload }), signal: new AbortController().signal });
      expect(await call("library.list", {})).toEqual({ items: [], total: 0, nextOffset: null });
      await expect(readFile(join(f.root, ".pi-web/research-library/library.json"))).rejects.toThrow("ENOENT");
      const referenceId = `ref-${"a".repeat(32)}`, evidenceId = `ev-${"b".repeat(32)}`, taskId = `task-${"c".repeat(32)}`, manuscriptId = `ms-${"d".repeat(32)}`;
      const fields = { ...emptyReferenceFields(), title: "Synthetic integration paper", citekey: "Integration2026", authors: ["Test Author"], year: 2026 };
      await call("library.save", { id: referenceId, expectedRevision: 0, fields });
      // Distinct immutable paths may legitimately hold identical PDF bytes.
      const pdf = `%PDF-1.7
Synthetic attachment admission only
%%EOF
`;
      await writeFile(join(f.root, "first.pdf"), pdf); await writeFile(join(f.root, "second.pdf"), pdf);
      await call("library.attach", { referenceId, expectedRevision: 1, path: "first.pdf", label: "First", sourceUrl: "", rights: "Synthetic" });
      const attached = object(await call("library.attach", { referenceId, expectedRevision: 2, path: "second.pdf", label: "Second", sourceUrl: "", rights: "Synthetic" }));
      const documents = attached["documents"]; if (!Array.isArray(documents)) throw new Error("Missing attached documents");
      expect(documents).toHaveLength(2);
      expect(object(documents[0])["id"]).not.toBe(object(documents[1])["id"]);
      await call("evidence.save", { id: evidenceId, expectedRevision: 0, referenceId, documentId: null, pdfSha256: null, page: null, rect: null, quote: "", body: "Synthetic human-authored note, not a verified PDF quotation", kind: "note", status: "open", tags: [] });
      expect(run).not.toHaveBeenCalled();
      const preview = libraryObject(await call("tasks.preview", { kind: "summary", goal: "Summarize the synthetic metadata and note only", referenceIds: [referenceId] }), ["corpusHash", "prompt", "referenceIds", "warnings"]);
      expect(run).not.toHaveBeenCalled();
      const start = { id: taskId, kind: "summary", goal: "Summarize the synthetic metadata and note only", referenceIds: [referenceId], expectedCorpusHash: preview["corpusHash"] };
      await call("tasks.start", start);
      await vi.waitFor(() => { expect(connect).toHaveBeenCalledTimes(1); });
      const corpusHash = preview["corpusHash"]; if (typeof corpusHash !== "string") throw new Error("Missing frozen corpus hash");
      await submitNativeResult(events, { version: 1, requestId: "e".repeat(32), taskId, corpusHash, result: { markdown: "Synthetic bounded note summary [@Integration2026].", claims: [{ id: "claim-test", text: "The human note is synthetic test data.", referenceIds: [referenceId], evidenceIds: [evidenceId], relationship: "context" }], cells: [], warnings: ["Synthetic transport test; no actual agent or provider result."] } }, lifetime.signal);
      const submitted = await call("tasks.get", { id: taskId });
      const hashes = decodeTask(submitted).corpus[0]?.documentHashes;
      expect(hashes).toHaveLength(2); expect(hashes?.[0]).toBe(hashes?.[1]);
      expect(submitted).toMatchObject({ status: "running", review: "unreviewed", result: { claims: [{ id: "claim-test" }] } });
      finishHost?.({ status: "completed" });
      await vi.waitFor(async () => { expect(await call("tasks.get", { id: taskId })).toMatchObject({ status: "completed", review: "unreviewed" }); });
      const completed = object(await call("tasks.get", { id: taskId }));
      await call("tasks.review", { id: taskId, expectedRevision: completed["revision"], decision: "accepted" });
      await call("tasks.start", start);
      expect(run).toHaveBeenCalledTimes(1);
      const manuscript = { id: manuscriptId, expectedRevision: 0, title: "Synthetic manuscript", markdown: "# Draft\n\nA synthetic statement [@Integration2026].", referenceIds: [referenceId], taskIds: [taskId], style: "apa" };
      await call("writing.save", manuscript);
      const audit = object(await call("writing.audit", { id: manuscriptId }));
      expect(audit["citationKeys"]).toEqual(["Integration2026"]);
      expect(audit["bibliography"]).toEqual(expect.stringContaining("Synthetic integration paper"));
      const exported = object(await call("writing.export", { id: manuscriptId, format: "html" }));
      expect(exported["mime"]).toContain("html");
      expect(exported["text"]).toContain("Synthetic integration paper");
      await mkdir(join(f.root, "drafts"));
      const target = "drafts/manuscript.md";
      const applyPreview = object(await call("writing.apply.preview", { id: manuscriptId, path: target }));
      await expect(readFile(join(f.root, target))).rejects.toThrow("ENOENT");
      const applied = object(await call("writing.apply", { id: manuscriptId, expectedRevision: 1, path: target, expectedHash: applyPreview["expectedHash"], previewToken: applyPreview["previewToken"] }));
      expect(applied["backupPath"]).toBeNull();
      expect(await readFile(join(f.root, target), "utf8")).toBe(applyPreview["text"]);
      await call("writing.save", { ...manuscript, expectedRevision: 1, markdown: "# Revised draft\n\nAnother synthetic statement [@Integration2026]." });
      const secondPreview = object(await call("writing.apply.preview", { id: manuscriptId, path: target }));
      const second = object(await call("writing.apply", { id: manuscriptId, expectedRevision: 2, path: target, expectedHash: secondPreview["expectedHash"], previewToken: secondPreview["previewToken"] }));
      const backup = second["backupPath"]; if (typeof backup !== "string") throw new Error("Missing preserved manuscript backup");
      expect(await readFile(join(f.root, backup), "utf8")).toBe(applyPreview["text"]);
      await call("evidence.delete", { id: evidenceId, expectedRevision: 1 });
      expect(await readdir(join(f.root, ".pi-web/research-library/evidence"))).toEqual([`${evidenceId}.1.json.deleted`]);
      const afterDelete = object(await call("writing.audit", { id: manuscriptId }));
      expect(JSON.stringify(afterDelete["issues"])).toMatch(/stale|deleted|changed/iu);
      expect(await readFile(f.pdfPath)).toEqual(f.pdf);
      expect(await readFile(join(f.root, "first.pdf"), "utf8")).toBe(pdf);
      expect(await readFile(join(f.root, "second.pdf"), "utf8")).toBe(pdf);
      expect(errors).toEqual([]);
    } finally {
      lifetime.abort(); finishHost?.({ status: "cancelled" });
      await activation.dispose?.(new AbortController().signal);
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected native integration response"); return Object.fromEntries(Object.entries(value)); }
