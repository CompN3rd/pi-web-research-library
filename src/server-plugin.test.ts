import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ServerPluginPeerRequestContext } from "@jmfederico/pi-web/server-plugin-api";
import plugin from "./server-plugin.js";
import { researchFixture } from "./server/fixture.testSupport.js";
import { toJson } from "./browser/peerClient.js";

describe("public server plugin boundary", () => {
  it("uses host scope, rejects private scope/version/operations, and revokes on lifetime shutdown", async () => {
    const f = await researchFixture();
    const lifetime = new AbortController();
    const activation = await plugin.activate({
      apiVersion: 3, pluginId: "research-library", packageRoot: process.cwd(), dataDirectory: join(f.root, "plugin-data"), settings: {},
      signal: new AbortController().signal, lifetimeSignal: lifetime.signal,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      execFile: vi.fn(),
    });
    try {
      await activation.start?.({ signal: new AbortController().signal, capabilities: { resolve: () => { throw new Error("No host capability needed"); } } });
      const request = activation.peer?.request;
      if (request === undefined) throw new Error("Missing paired request handler");
      const context: ServerPluginPeerRequestContext = {
        project: { id: "p", name: "P", path: f.root },
        workspace: { id: "w", projectId: "p", label: "W", path: f.root, isMain: true },
        operation: "annotations.create", input: toJson({ version: 1, payload: { scope: f.scope, annotation: f.annotation } }), signal: new AbortController().signal,
      };
      expect(await request(context)).toEqual(f.annotation);
      await expect(request({ ...context, input: { version: 2, payload: {} } })).rejects.toThrow("version");
      await expect(request({ ...context, operation: "private.route" })).rejects.toThrow("Unknown");
      await expect(request({ ...context, input: toJson({ version: 1, payload: { scope: f.scope, annotation: f.annotation, root: "/elsewhere" } }) })).rejects.toThrow("field");
      const opened = await request({ ...context, operation: "pdf.open", input: toJson({ version: 1, payload: { scope: f.scope } }) });
      expect(opened).toMatchObject({ size: f.pdf.length });
      lifetime.abort();
      await expect(request(context)).rejects.toThrow();
    } finally {
      lifetime.abort();
      await activation.dispose?.(new AbortController().signal);
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
