import type { PiWebServerPlugin, ServerPluginPeerRequestContext, JsonValue } from "@jmfederico/pi-web/server-plugin-api";
import { join } from "node:path";
import { AnnotationRepository } from "./server/annotations.js";
import { PdfReaders } from "./server/pdfReaders.js";
import { boundedString, integer, paperScope, record, RESEARCH_PROTOCOL_VERSION } from "./domain/protocol.js";
import { MAX_RESEARCH_LIBRARY_PILOT_PDF_BYTES } from "./domain/pilot.js";
import { publishSyntheticIntent } from "./companion/core.js";

const plugin: PiWebServerPlugin = {
  apiVersion: 3,
  name: "Research Library",
  activate(context) {
    const annotations = new AnnotationRepository();
    const readers = new PdfReaders(join(context.dataDirectory, "pdf-cache"));
    let sweep: ReturnType<typeof setInterval> | undefined;
    const stopTimer = () => { if (sweep !== undefined) clearInterval(sweep); };
    context.lifetimeSignal.addEventListener("abort", stopTimer, { once: true });
    return {
      async start() {
        await readers.start();
        context.lifetimeSignal.throwIfAborted();
        sweep = setInterval(() => {
          void readers.expire().catch((error: unknown) => { context.logger.error("PDF reader cleanup failed", { error: String(error) }); });
        }, 10_000);
        sweep.unref();
      },
      peer: { request: (request) => dispatch(request, annotations, readers, context.lifetimeSignal) },
      async dispose() {
        stopTimer();
        context.lifetimeSignal.removeEventListener("abort", stopTimer);
        await readers.dispose();
      },
    };
  },
};
export default plugin;

async function dispatch(context: ServerPluginPeerRequestContext, annotations: AnnotationRepository, readers: PdfReaders, lifetime: AbortSignal): Promise<JsonValue> {
  const signal = AbortSignal.any([context.signal, lifetime]);
  signal.throwIfAborted();
  const envelope = record(context.input, ["version", "payload"]);
  if (envelope["version"] !== RESEARCH_PROTOCOL_VERSION) throw new Error("Unsupported research protocol version");
  const input = envelope["payload"];
  const root = context.workspace.path;
  const authority = JSON.stringify([context.project.id, context.workspace.id, root]);
  // All filesystem scope is host-resolved. No caller-supplied project/root is accepted.
  switch (context.operation) {
    case "annotations.list": {
      const value = record(input, ["scope", "offset"]);
      return json(await annotations.list(root, paperScope(value["scope"]), integer(value["offset"], 0, 500), signal));
    }
    case "annotations.create": {
      const value = record(input, ["scope", "annotation"]);
      return json(await annotations.create(root, paperScope(value["scope"]), value["annotation"], signal));
    }
    case "annotations.update": {
      const value = record(input, ["scope", "before", "after"]);
      return json(await annotations.update(root, paperScope(value["scope"]), value["before"], value["after"], signal));
    }
    case "annotations.delete": {
      const value = record(input, ["scope", "annotation"]);
      return json(await annotations.delete(root, paperScope(value["scope"]), value["annotation"], signal));
    }
    case "pdf.open": {
      const value = record(input, ["scope"]);
      return json(await readers.open(root, authority, paperScope(value["scope"]), signal));
    }
    case "pdf.read": {
      const value = record(input, ["id", "begin", "end"]);
      return readers.read(authority, readerId(value["id"]), integer(value["begin"], 0, MAX_RESEARCH_LIBRARY_PILOT_PDF_BYTES), integer(value["end"], 1, MAX_RESEARCH_LIBRARY_PILOT_PDF_BYTES), signal);
    }
    case "pdf.close": {
      const value = record(input, ["id"]);
      await readers.close(authority, readerId(value["id"]));
      return null;
    }
    case "synthetic.intent": {
      const value = record(input, ["intent"]);
      await publishSyntheticIntent(root, value["intent"], signal);
      return null;
    }
    default: throw new Error("Unknown research operation");
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
