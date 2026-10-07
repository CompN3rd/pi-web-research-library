// Child-process probe loaded from a real extracted tarball outside node_modules.
// The runner imports only Node builtins and authored PDF bytes; all application
// operations, Citation.js/citeproc rendering and text extraction use the artifact.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { syntheticPdf } from "./synthetic-pdf.mjs";

const packageRoot = process.argv[2], root = join(process.cwd(), "synthetic-workspace");
const plugin = (await import(pathToFileURL(join(packageRoot, "dist/server-plugin.js")).href)).default;
const lifetime = new AbortController();
await mkdir(join(root, "raw"), { recursive: true });
await writeFile(join(root, "raw/packed.pdf"), syntheticPdf("Packed synthetic paper"));
globalThis.fetch = () => { throw Error("Packed artifact must not make network calls"); };
const activation = await plugin.activate({ apiVersion: 3, pluginId: "research-library", packageRoot, dataDirectory: join(root, "plugin-data"), settings: {}, signal: new AbortController().signal, lifetimeSignal: lifetime.signal, logger: { debug() {}, info() {}, warn(message) { throw Error(message); }, error(message) { throw Error(message); } }, execFile() { throw Error("No shell access"); } });
const scope = { project: { id: "p", name: "Synthetic", path: root }, workspace: { id: "w", projectId: "p", path: root, label: "Synthetic", isMain: true } };
const request = (operation, payload) => activation.peer.request({ ...scope, operation, input: { version: 1, payload }, signal: lifetime.signal });
try {
  await activation.start({ signal: lifetime.signal, capabilities: { resolve(capability) { return capability.parse(capability.id === "pi-sessions" ? { version: 1, run() { throw Error("No model calls"); }, create() { throw Error("No session creation"); } } : { version: 1, connect() { throw Error("No sessions"); } }); } } });
  const bibliography = JSON.stringify([{ id: "Packed2026", type: "article-journal", title: "Packed synthetic paper", author: [{ family: "Test", given: "Author" }], issued: { "date-parts": [[2026]] } }]);
  const preview = await request("library.import.preview", { format: "csl-json", text: bibliography });
  assert.equal(preview.references.length, 1);
  await request("library.import.commit", { format: "csl-json", text: bibliography, indices: [0] });
  let reference = (await request("library.list", {})).items[0];
  reference = await request("library.attach", { referenceId: reference.id, expectedRevision: reference.revision, path: "raw/packed.pdf", label: "Packed PDF", sourceUrl: "", rights: "Synthetic authored fixture" });
  const documentId = reference.documents[0].id;
  assert.equal((await request("library.text.index", { referenceId: reference.id, documentId })).pages, 1);
  const hits = await request("library.text.search", { query: "Packed synthetic", referenceIds: [reference.id] });
  assert.equal(hits.length, 1); assert(hits[0].excerpt.includes("Packed synthetic paper"));
  const id = `ms-${"d".repeat(32)}`;
  await request("writing.save", { id, expectedRevision: 0, title: "Packed draft", markdown: `A synthetic claim [@${reference.citekey}].`, referenceIds: [reference.id], taskIds: [], style: "apa" });
  const html = await request("writing.export", { id, format: "html" });
  assert(html.text.includes("Packed synthetic paper")); assert(!html.text.includes(`[@${reference.citekey}]`));
  for (const format of ["bibtex", "ris", "csl-json"]) assert((await request("library.export", { referenceIds: [reference.id], format })).text.includes("Packed synthetic paper"));
  assert((await readFile(join(root, ".pi-web/research-library/library.json"), "utf8")).includes("Packed synthetic paper"));
  console.log("Extracted artifact execution passed: store, portable codec/CSL and actual PDF worker; no repository devDependencies or network.");
} finally { lifetime.abort(); await activation.dispose(new AbortController().signal); }
