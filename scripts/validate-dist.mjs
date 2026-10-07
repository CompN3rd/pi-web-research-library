import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isBuiltin } from "node:module";
import { createHash } from "node:crypto";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(pkg.name, "@compn3rd/pi-web-research-library");
const entry = pkg.piWeb.plugins[0];
assert.equal(entry.browserRoot, "dist/browser");
assert.equal(entry.machineSpecific, true);
assert.deepEqual(pkg.pi.extensions, ["dist/companion.js"]);
for (const path of [entry.module, entry.serverModule, ...pkg.pi.extensions, "dist/browser/pdfjs/pdf.min.mjs", "dist/browser/pdfjs/pdf.worker.min.mjs", "dist/browser/pdfjs/LICENSE", "dist/pdf-text-worker.js", "dist/vendor/citeproc.cjs", "dist/browser/licenses/citeproc/source.txt", "dist/browser/licenses/citeproc/CPAL-1.0.txt", "dist/licenses/dependencies.json"]) await stat(path);
const server = (await import(pathToFileURL(resolve(entry.serverModule)).href)).default;
assert.equal(server.apiVersion, 3);
assert.equal(typeof (await import(pathToFileURL(resolve(pkg.pi.extensions[0])).href)).default, "function");
const agentDirectory = await mkdtemp(join(tmpdir(), "research-companion-pack-"));
try {
  const loaded = await discoverAndLoadExtensions([resolve(pkg.pi.extensions[0])], process.cwd(), agentDirectory);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert(loaded.extensions[0].commands.has("research-library"), "Built companion command was not discovered");
  assert.deepEqual([...loaded.extensions[0].tools.keys()].sort(), ["catalog_search", "get_evidence", "read_passage", "resolve_citations", "search_text", "submit_result"].map(name => `research_library_native_${name}`));
  assert(!loaded.extensions[0].handlers.has("session_start"), "Companion must not discover retired sources");
} finally { await rm(agentDirectory, { recursive: true, force: true }); }
const dependencies = JSON.parse(await readFile("dist/licenses/dependencies.json", "utf8"));
for (const name of ["@citation-js/core", "@citation-js/plugin-bibtex", "@citation-js/plugin-ris", "@citation-js/plugin-csl", "unpdf", "citeproc"]) assert(dependencies.some(item => item.name === name), `Missing dependency notice: ${name}`);
for (const dependency of dependencies) { assert(dependency.files.length > 0); for (const file of dependency.files) await stat(join("dist/licenses", file)); }
const originalCiteproc = await readFile("node_modules/citeproc/citeproc_commonjs.js");
assert.deepEqual(await readFile("dist/vendor/citeproc.cjs"), originalCiteproc, "Do not transform citeproc source");
assert.deepEqual(await readFile("dist/browser/licenses/citeproc/source.txt"), originalCiteproc);
const licenseProvenance = JSON.parse(await readFile("dist/licenses/citeproc/provenance.json", "utf8"));
assert.equal(createHash("sha256").update(await readFile("dist/browser/licenses/citeproc/CPAL-1.0.txt")).digest("hex"), licenseProvenance.sha256);
let count = 0, bytes = 0;
for (const path of await files("dist")) {
  count += 1; bytes += (await stat(path)).size;
  assert(!/\.(?:test|testSupport)\./.test(path), `Test shipped: ${path}`);
  assert(!path.endsWith("example.synthetic.json"), "Retired demo must not ship");
  if (!/\.[cm]?js$/u.test(path) || path.includes("pdfjs")) continue;
  const text = await readFile(path, "utf8");
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const pending = [tree];
  function inspect(node) {
    let reference;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) reference = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ["require", "__require"].includes(node.expression.text))) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) reference = node.arguments[0].text;
    if (reference) {
      const companionEnum = path.replaceAll("\\", "/") === "dist/companion.js" && reference === "@earendil-works/pi-ai"
        && ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
        && node.importClause.namedBindings.elements.every((binding) => (binding.propertyName ?? binding.name).text === "StringEnum");
      assert(!reference.startsWith("@jmfederico/") && (!reference.startsWith("@earendil-works/") || companionEnum), `Unexpected host runtime import: ${path}: ${reference}`);
      assert(reference.startsWith(".") || isBuiltin(reference) || companionEnum, `Unbundled dependency: ${path}: ${reference}`);
      if (reference.startsWith(".")) assertContainedReference(path, reference);
      if (path.replaceAll("\\", "/").startsWith("dist/browser/")) {
        assert(reference.startsWith("."), `Browser bare import: ${reference}`);
        assert(resolve(dirname(path), reference).startsWith(resolve(entry.browserRoot) + "/") || resolve(dirname(path), reference).startsWith(resolve(entry.browserRoot) + "\\"), `Browser root escape: ${reference}`);
      }
    }
    // Bundled parsers contain deeply nested generated expressions. Walk iteratively.
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
  while (pending.length > 0) inspect(pending.pop());
  assert(!text.includes("pdfPreviewUrl") && !text.includes("@jmfederico/pi-web/src"), `Fork dependency in ${path}`);
  for (const retired of ["research-library-pilot", "research-library-runtime", "research-library.synthetic.json", '"annotations.create"', '"questions.ask"', '"synthetic.intent"']) assert(!text.includes(retired), `Retired runtime shipped in ${path}: ${retired}`);
}
assert(count <= 4096 && bytes < 16 * 1024 * 1024, "Distribution exceeds plugin discovery limits");
console.log(`Validated entries/imports and PDF assets: ${count} files, ${bytes} bytes.`);
function assertContainedReference(path, reference) {
  const target = resolve(dirname(path), reference);
  assert(target.startsWith(resolve("dist") + "/") || target.startsWith(resolve("dist") + "\\"), `Distribution module escape: ${reference}`);
}
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
