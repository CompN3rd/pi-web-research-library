import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
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
for (const path of [entry.module, entry.serverModule, ...pkg.pi.extensions, "dist/browser/pdfjs/pdf.min.mjs", "dist/browser/pdfjs/pdf.worker.min.mjs", "dist/browser/pdfjs/LICENSE"]) await stat(path);
const server = (await import(pathToFileURL(resolve(entry.serverModule)).href)).default;
assert.equal(server.apiVersion, 3);
assert.equal(typeof (await import(pathToFileURL(resolve(pkg.pi.extensions[0])).href)).default, "function");
const agentDirectory = await mkdtemp(join(tmpdir(), "research-companion-pack-"));
try {
  const loaded = await discoverAndLoadExtensions([resolve(pkg.pi.extensions[0])], process.cwd(), agentDirectory);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert(loaded.extensions[0].commands.has("research-library"), "Built companion command was not discovered");
} finally { await rm(agentDirectory, { recursive: true, force: true }); }
let count = 0, bytes = 0;
for (const path of await files("dist")) {
  count += 1; bytes += (await stat(path)).size;
  assert(!/\.(?:test|testSupport)\./.test(path), `Test shipped: ${path}`);
  if (!path.endsWith(".js")) continue;
  const text = await readFile(path, "utf8");
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  function inspect(node) {
    let reference;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) reference = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) reference = node.arguments[0].text;
    if (reference) {
      const companionEnum = path.replaceAll("\\", "/") === "dist/companion.js" && reference === "@earendil-works/pi-ai"
        && ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
        && node.importClause.namedBindings.elements.every((binding) => (binding.propertyName ?? binding.name).text === "StringEnum");
      assert(!reference.startsWith("@jmfederico/") && (!reference.startsWith("@earendil-works/") || companionEnum), `Unexpected host runtime import: ${path}: ${reference}`);
      if (path.replaceAll("\\", "/").startsWith("dist/browser/")) {
        assert(reference.startsWith("."), `Browser bare import: ${reference}`);
        assert(resolve(dirname(path), reference).startsWith(resolve(entry.browserRoot) + "/") || resolve(dirname(path), reference).startsWith(resolve(entry.browserRoot) + "\\"), `Browser root escape: ${reference}`);
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  assert(!text.includes("pdfPreviewUrl") && !text.includes("@jmfederico/pi-web/src"), `Fork dependency in ${path}`);
}
assert(count <= 4096 && bytes < 16 * 1024 * 1024, "Distribution exceeds plugin discovery limits");
console.log(`Validated entries/imports and PDF assets: ${count} files, ${bytes} bytes.`);
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
