import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ServerPluginPeerRequestContext } from "@jmfederico/pi-web/server-plugin-api";
import plugin from "./server-plugin.js";
import { researchFixture } from "./server/fixture.testSupport.js";
import { emptyReferenceFields, libraryObject } from "./domain/workbench.js";
import { validateLibraryReference } from "./domain/workbenchValidation.js";
import { toJson } from "./browser/peerClient.js";

async function fixture() {
  const f = await researchFixture();
  const lifetime = new AbortController();
  const run = vi.fn(() => { throw new Error("No model calls in boundary tests"); });
  const activation = await plugin.activate({
    apiVersion: 3, pluginId: "research-library", packageRoot: process.cwd(), dataDirectory: join(f.root, "plugin-data"), settings: {},
    signal: new AbortController().signal, lifetimeSignal: lifetime.signal,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, execFile: vi.fn(),
  });
  const start = () => activation.start?.({ signal: new AbortController().signal, capabilities: { resolve: capability => capability.parse(capability.id === "pi-session-events" ? { version: 1, connect: vi.fn(() => { throw new Error("No session events in boundary tests"); }) } : { version: 1, create: vi.fn(), run }) } });
  const request = activation.peer?.request;
  if (request === undefined) throw new Error("Missing paired request handler");
  const context: ServerPluginPeerRequestContext = {
    project: { id: "p", name: "P", path: f.root }, workspace: { id: "w", projectId: "p", label: "W", path: f.root, isMain: true },
    operation: "library.list", input: { version: 1, payload: {} }, signal: new AbortController().signal,
  };
  const call = (operation: string, payload: unknown) => request({ ...context, operation, input: toJson({ version: 1, payload }) });
  const dispose = async () => { lifetime.abort(); await activation.dispose?.(new AbortController().signal); await rm(f.root, { recursive: true, force: true }); };
  return { ...f, lifetime, run, start, request, context, call, dispose };
}

describe("public server plugin boundary", () => {
  it("uses host scope, rejects caller authority/version, and revokes on lifetime shutdown", async () => {
    const f = await fixture();
    try {
      await f.start();
      expect(await f.call("library.list", {})).toEqual({ items: [], total: 0, nextOffset: null });
      await expect(f.request({ ...f.context, input: { version: 2, payload: {} } })).rejects.toThrow("version");
      await expect(f.call("private.route", {})).rejects.toThrow("Unknown");
      await expect(f.call("library.list", { root: "/elsewhere" })).rejects.toThrow("field");
      const id = `ref-${"a".repeat(32)}`;
      await f.call("library.save", { id, expectedRevision: 0, fields: { ...emptyReferenceFields(), title: "Synthetic source", citekey: "Source2026" } });
      const attached = validateLibraryReference(await f.call("library.attach", { referenceId: id, expectedRevision: 1, path: f.source.path, label: "Synthetic PDF", sourceUrl: "", rights: "Synthetic test" }));
      const document = attached.documents[0];
      if (document === undefined) throw new Error("Missing PDF");
      const payload = { referenceId: id, documentId: document.id };
      await expect(f.call("library.pdf.open", { ...payload, path: f.source.path, sha256: f.source.sha256 })).rejects.toThrow("field");
      const opened = libraryObject(await f.call("library.pdf.open", payload), ["id", "size", "sha256", "chunkBytes"]);
      expect(opened).toMatchObject({ size: f.pdf.length, sha256: f.source.sha256 });
      await expect(f.request({ ...f.context, workspace: { ...f.context.workspace, id: "other" }, operation: "pdf.read", input: toJson({ version: 1, payload: { id: opened["id"], begin: 0, end: 5 } }) })).rejects.toThrow("another workspace");
      f.lifetime.abort();
      await expect(f.call("library.list", {})).rejects.toThrow();
      expect(f.run).not.toHaveBeenCalled();
    } finally { await f.dispose(); }
  });

  it("has no retired operations or startup migration, and leaves old files and receipts untouched", async () => {
    const f = await fixture();
    const retired = ["raw/_processed/research-library-pilot/library.json", ".pi-web/research-library.synthetic.json", ".pi-web/research-library-runtime/annotations/pilot-paper/ann-test.deleted", "plugin-data/questions/old/receipt.json"];
    const contents = "Archived synthetic sentinel: do not parse, rewrite or delete.\n";
    try {
      for (const path of retired) { await mkdir(dirname(join(f.root, path)), { recursive: true }); await writeFile(join(f.root, path), contents); }
      await f.start();
      expect(await f.call("library.list", {})).toEqual({ items: [], total: 0, nextOffset: null });
      for (const operation of ["annotations.list", "annotations.create", "annotations.update", "annotations.delete", "questions.ask", "questions.list", "pdf.open", "synthetic.intent"]) {
        await expect(f.call(operation, {})).rejects.toThrow("Unknown");
      }
      await expect(readFile(join(f.root, ".pi-web/research-library/library.json"))).rejects.toThrow("ENOENT");
      await f.call("library.save", { id: `ref-${"b".repeat(32)}`, expectedRevision: 0, fields: { ...emptyReferenceFields(), title: "New catalog", citekey: "New2026" } });
      for (const path of retired) expect(await readFile(join(f.root, path), "utf8")).toBe(contents);
      expect(await readdir(join(f.root, "plugin-data"))).toEqual(["pdf-cache", "questions"]);
      expect(f.run).not.toHaveBeenCalled();
    } finally { await f.dispose(); }
  });
});
