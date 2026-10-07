import type { PiWebServerPlugin, ServerPluginPeerRequestContext, JsonValue } from "@jmfederico/pi-web/server-plugin-api";
import { join } from "node:path";
import { PdfReaders } from "./server/pdfReaders.js";
import { boundedString, integer, record, RESEARCH_PROTOCOL_VERSION } from "./domain/protocol.js";
import { LIBRARY_MAX_PDF_BYTES } from "./domain/workbench.js";
import { NativeWorkbench, piSessionsCapability, piSessionEventsCapability } from "./server/workbenchRoutes.js";

const plugin: PiWebServerPlugin = {
  apiVersion: 3,
  name: "Research Library",
  requires: [piSessionsCapability, piSessionEventsCapability],
  activate(context) {
    const workbench = new NativeWorkbench();
    const readers = new PdfReaders(join(context.dataDirectory, "pdf-cache"));
    let sweep: ReturnType<typeof setInterval> | undefined;
    const stopTimer = () => { if (sweep !== undefined) clearInterval(sweep); };
    context.lifetimeSignal.addEventListener("abort", stopTimer, { once: true });
    return {
      async start({ capabilities }) {
        workbench.start(capabilities.resolve(piSessionsCapability), capabilities.resolve(piSessionEventsCapability), context.lifetimeSignal, message => { context.logger.error(message); });
        await readers.start();
        context.lifetimeSignal.throwIfAborted();
        sweep = setInterval(() => {
          void readers.expire().catch((error: unknown) => { context.logger.error("PDF reader cleanup failed", { error: String(error) }); });
        }, 10_000);
        sweep.unref();
      },
      peer: { request: request => dispatch(request, readers, workbench, context.lifetimeSignal) },
      async dispose() {
        stopTimer();
        context.lifetimeSignal.removeEventListener("abort", stopTimer);
        await Promise.all([readers.dispose(), workbench.dispose()]);
      },
    };
  },
};
export default plugin;

async function dispatch(context: ServerPluginPeerRequestContext, readers: PdfReaders, workbench: NativeWorkbench, lifetime: AbortSignal): Promise<JsonValue> {
  const signal = AbortSignal.any([context.signal, lifetime]);
  signal.throwIfAborted();
  const envelope = record(context.input, ["version", "payload"]);
  if (envelope["version"] !== RESEARCH_PROTOCOL_VERSION) throw new Error("Unsupported research protocol version");
  const input = envelope["payload"];
  const authority = JSON.stringify([context.project.id, context.workspace.id, context.workspace.path]);
  // All filesystem scope is host-resolved. No caller-supplied project/root is accepted.
  switch (context.operation) {
    case "pdf.read": {
      const value = record(input, ["id", "begin", "end"]);
      return readers.read(authority, readerId(value["id"]), integer(value["begin"], 0, LIBRARY_MAX_PDF_BYTES), integer(value["end"], 1, LIBRARY_MAX_PDF_BYTES), signal);
    }
    case "pdf.close": {
      const value = record(input, ["id"]);
      await readers.close(authority, readerId(value["id"]));
      return null;
    }
    default: return json(await workbench.handle(context, input, readers, authority, signal));
  }
}
function readerId(value: unknown): string { return boundedString(value, /^[a-f0-9-]{36}$/u); }
function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  throw new Error("Research response must be JSON");
}
