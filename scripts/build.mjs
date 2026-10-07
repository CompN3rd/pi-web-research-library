import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
// Bundle portable implementation libraries. Keep citeproc-js as byte-identical
// distributed source, with its CPAL notice/attribution, rather than transforming
// it into a mixed-license bundle. No repository devDependencies are needed at runtime.
const server = await build({
  entryPoints: ["src/server-plugin.ts", "src/companion.ts", "src/pdf-text-worker.ts"],
  outdir: "dist", bundle: true, platform: "node", target: "node22", format: "esm", metafile: true,
  external: ["@earendil-works/pi-ai"],
  plugins: [{ name: "preserve-citeproc-source", setup(build) { build.onResolve({ filter: /^citeproc$/ }, () => ({ path: "./vendor/citeproc.cjs", external: true })); } }],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
const browser = await build({ entryPoints: ["src/browser/pi-web-plugin.ts"], outdir: "dist/browser", bundle: true, platform: "browser", target: "es2022", format: "esm", metafile: true });
await mkdir("dist/browser/pdfjs", { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) await cp(`node_modules/pdfjs-dist/build/${file}`, `dist/browser/pdfjs/${file}`);
for (const path of ["cmaps", "standard_fonts", "wasm", "iccs", "LICENSE"]) await cp(`node_modules/pdfjs-dist/${path}`, `dist/browser/pdfjs/${path}`, { recursive: true });

const dependencies = new Map();
for (const input of [...Object.keys(server.metafile.inputs), ...Object.keys(browser.metafile.inputs)]) {
  const path = input.replaceAll("\\", "/");
  const match = [...path.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)].at(-1);
  if (!match) continue;
  const root = path.slice(0, match.index + match[0].length);
  dependencies.set(match[1], root);
}
dependencies.set("citeproc", "node_modules/citeproc");
await mkdir("dist/vendor", { recursive: true });
await mkdir("dist/browser/licenses/citeproc", { recursive: true });
await cp("node_modules/citeproc/citeproc_commonjs.js", "dist/vendor/citeproc.cjs");
await cp("node_modules/citeproc/citeproc_commonjs.js", "dist/browser/licenses/citeproc/source.txt");
await cp("third-party/citeproc/CPAL-1.0.txt", "dist/browser/licenses/citeproc/CPAL-1.0.txt");
const licenses = [];
for (const [name, root] of dependencies) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const directory = `dist/licenses/${name.replaceAll("/", "-")}`;
  await mkdir(directory, { recursive: true });
  const files = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(entry.name));
  for (const file of files) await cp(join(root, file.name), join(directory, file.name));
  const notices = files.map(file => file.name);
  if (notices.length === 0 && ["@citation-js/name", "@citation-js/date"].includes(name) && pkg.license === "MIT") {
    // These published helper packages omit a standalone license file. Preserve
    // their declaration/author metadata and the parent Citation.js MIT notice.
    await cp("node_modules/@citation-js/core/LICENSE.md", join(directory, "Citation-js-MIT.md"));
    await writeFile(join(directory, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    await writeFile(join(directory, "NOTICE.txt"), "This published Citation.js helper declares MIT but includes no standalone license file. Its package declaration/author and the Citation.js project MIT notice are retained verbatim here.\n");
    notices.push("Citation-js-MIT.md", "NOTICE.txt", "package.json");
  }
  if (name === "citeproc") {
    const provenance = JSON.parse(await readFile("third-party/citeproc/provenance.json", "utf8"));
    if (pkg.version !== provenance.version) throw Error("Recheck citeproc license/provenance for the new version");
    await cp("third-party/citeproc", directory, { recursive: true });
    notices.push("CPAL-1.0.txt", "provenance.json", "NOTICE.txt");
  }
  if (notices.length === 0) throw Error(`Missing bundled dependency notice: ${name}`);
  licenses.push({ name, version: pkg.version, license: pkg.license, ...(name === "citeproc" ? { selectedLicense: "CPAL-1.0" } : {}), author: pkg.author, files: notices.map(file => `${name.replaceAll("/", "-")}/${file}`) });
}
await mkdir("dist/licenses", { recursive: true });
await writeFile("dist/licenses/dependencies.json", JSON.stringify(licenses, null, 2) + "\n");
