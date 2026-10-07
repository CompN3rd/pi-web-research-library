// Synthetic public host boundaries around the actual compiled companion entry.
// This is not a daemon, session runtime, or model-provider integration.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import companion from "../dist/companion.js";

export function nativeSmokeHost(root) {
  const runs = [], errors = [], tools = new Map(), hooks = new Map(), listeners = new Map();
  const lifetime = new AbortController();
  let native;
  const bus = {
    on(channel, handler) {
      const handlers = listeners.get(channel) ?? new Set(); handlers.add(handler); listeners.set(channel, handlers);
      return () => handlers.delete(handler);
    },
    emit(channel, value) {
      for (const handler of listeners.get(channel) ?? []) {
        try { void Promise.resolve(handler(value)).catch(error => errors.push(String(error))); }
        catch (error) { errors.push(String(error)); }
      }
    },
  };
  companion({ events: bus, registerTool(tool) { assert(!tools.has(tool.name)); tools.set(tool.name, tool); }, registerCommand() {}, on(event, handler) { const handlers = hooks.get(event) ?? []; handlers.push(handler); hooks.set(event, handlers); } });
  assert.deepEqual([...tools.keys()].sort(), ["catalog_search", "get_evidence", "read_passage", "resolve_citations", "search_text", "submit_result"].map(name => `research_library_native_${name}`));
  assert(!hooks.has("session_start"), "No source discovery or legacy tool registration");
  const host = {
    runs, errors,
    sessions: {
      version: 1,
      create() { throw Error("No unprompted sessions allowed in smoke"); },
      async run(input) {
        runs.push(input);
        assert(input.prompt.includes("research_library_native_submit_result"), "Only structured catalog tasks are supported");
        assert.equal(native, undefined, "Smoke admits exactly one explicitly confirmed native task");
        let finish;
        const completion = new Promise(resolve => { finish = resolve; });
        native = { input, finish, sessionId: "synthetic-native-host-session", connection: new AbortController() };
        return { sessionId: native.sessionId, completion };
      },
    },
    events: {
      version: 1,
      async connect(input) {
        assert(native); assert.equal(input.sessionId, native.sessionId);
        assert.equal(input.projectId, "p"); assert.equal(input.workspaceId, "w");
        return { ...bus, signal: native.connection.signal, close() { native.connection.abort(); } };
      },
    },
    async tool(name, params) {
      const tool = tools.get(name); assert(tool, `Compiled companion tool missing: ${name}`);
      return tool.execute("synthetic-smoke-call", params, lifetime.signal, () => {}, { cwd: root, sessionManager: { getSessionId: () => "different-native-pi-session-id" } });
    },
    async submitResult(params) {
      assert(native, "Model consent must precede synthetic result delivery");
      assert(native.input.prompt.includes(params.taskId) && native.input.prompt.includes(params.corpusHash));
      const receipt = await host.tool("research_library_native_submit_result", params);
      const state = JSON.parse(await readFile(join(root, ".pi-web/research-library/library.json"), "utf8"));
      const task = state.tasks.find(task => task.id === params.taskId);
      assert.deepEqual(task.result, params.result, "Companion success must follow actual durable publication");
      assert.equal(task.status, "running"); assert.equal(task.review, "unreviewed");
      assert.equal(receipt.details.taskId, params.taskId);
      native.finish({ status: "completed" }); // Never fake completion before publication.
      return receipt.details;
    },
    async dispose() {
      native?.finish({ status: "cancelled" }); lifetime.abort();
      for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, { cwd: root });
      assert.deepEqual(errors, []);
    },
  };
  return host;
}
