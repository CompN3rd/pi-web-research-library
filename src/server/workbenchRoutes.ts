import type { PiWebHostPiSessionEventsV1, PiWebHostPiSessionsV1, PluginCapability, ServerPluginPeerRequestContext } from "@jmfederico/pi-web/server-plugin-api";
import { bibliographyCodec } from "../domain/bibliography.js";
import { libraryId, libraryInteger, libraryObject, libraryStrings, libraryText } from "../domain/workbench.js";
import { LibraryDiscovery } from "./discovery.js";
import { PdfReaders } from "./pdfReaders.js";
import { LibraryCatalog } from "./workbenchCatalog.js";
import { LibraryResearch } from "./workbenchResearch.js";
import { WorkbenchStore } from "./workbenchStore.js";
import { WorkbenchText } from "./workbenchText.js";
import { LibraryWriting } from "./workbenchWriting.js";

/** Structural public tokens keep the distributed backend free of host runtime imports. */
export const piSessionsCapability: PluginCapability<PiWebHostPiSessionsV1, 1> = {
  pluginId: "pi-web.host", id: "pi-sessions", version: 1,
  parse(value: unknown): PiWebHostPiSessionsV1 {
    if (!isSessions(value)) throw new Error("Research Library requires the public pi-sessions@1 capability");
    return value;
  },
};
function isSessions(value: unknown): value is PiWebHostPiSessionsV1 {
  return typeof value === "object" && value !== null && "version" in value && value.version === 1
    && "run" in value && typeof value.run === "function" && "create" in value && typeof value.create === "function";
}

export const piSessionEventsCapability: PluginCapability<PiWebHostPiSessionEventsV1, 1> = {
  pluginId: "pi-web.host", id: "pi-session-events", version: 1,
  parse(value: unknown): PiWebHostPiSessionEventsV1 {
    if (!isSessionEvents(value)) throw new Error("Native Research Library requires public pi-session-events@1");
    return value;
  },
};
function isSessionEvents(value: unknown): value is PiWebHostPiSessionEventsV1 {
  return typeof value === "object" && value !== null && "version" in value && value.version === 1 && "connect" in value && typeof value.connect === "function";
}

/** A single native repository authority shared by all peer services. */
export class NativeWorkbench {
  private readonly store = new WorkbenchStore();
  private readonly catalog = new LibraryCatalog(this.store, bibliographyCodec);
  private readonly writing = new LibraryWriting(this.store, bibliographyCodec);
  private readonly text = new WorkbenchText(this.store);
  private readonly discovery = new LibraryDiscovery(this.store);
  private research: LibraryResearch | undefined;

  start(sessions: PiWebHostPiSessionsV1, events: PiWebHostPiSessionEventsV1, lifetime: AbortSignal, log: (message: string) => void): void {
    this.research = new LibraryResearch(this.store, { sessions, events, lifetime, log, text: this.text });
  }

  async handle(context: ServerPluginPeerRequestContext, input: unknown, readers: PdfReaders, authority: string, signal: AbortSignal): Promise<unknown> {
    const root = context.workspace.path;
    const operation = context.operation;
    if (operation === "library.pdf.open") {
      const value = libraryObject(input, ["referenceId", "documentId"]);
      const document = await this.text.document(root, libraryId(value["referenceId"], "ref"), libraryId(value["documentId"], "doc"), signal);
      return readers.openDocument(root, authority, document, signal);
    }
    if (operation === "library.text.index" || operation === "library.text.page") {
      const value = libraryObject(input, ["referenceId", "documentId", ...(operation === "library.text.page" ? ["page"] : [])], operation === "library.text.index" ? ["rebuild"] : []);
      const referenceId = libraryId(value["referenceId"], "ref"), documentId = libraryId(value["documentId"], "doc");
      if (value["rebuild"] !== undefined && typeof value["rebuild"] !== "boolean") throw new Error("Invalid text-index rebuild flag");
      return operation === "library.text.index" ? this.text.index(root, referenceId, documentId, signal, value["rebuild"] === true) : this.text.read(root, referenceId, documentId, libraryInteger(value["page"], 1, 2_000), signal);
    }
    if (operation === "library.text.search") {
      const value = libraryObject(input, ["query", "referenceIds"]);
      return this.text.search(root, libraryText(value["query"], 300, false), libraryStrings(value["referenceIds"], 100, 80).map(id => libraryId(id, "ref")), signal);
    }
    if (operation.startsWith("discovery.") || operation === "library.graph") return this.discovery.handle(root, operation, input, signal);
    if (operation.startsWith("library.") || operation.startsWith("collections.")) return this.catalog.handle(root, operation, input, signal);
    if (operation.startsWith("writing.")) return this.writing.handle(root, operation, input, signal);
    if (operation.startsWith("evidence.") || operation.startsWith("tasks.")) {
      if (this.research === undefined) throw new Error("Native research service has not started");
      return this.research.handle(context, operation, input, signal);
    }
    throw new Error("Unknown native library operation");
  }

  async dispose(): Promise<void> { await Promise.all([this.text.dispose(), this.research?.dispose()]); }
}
