import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const directory = await mkdtemp(join(tmpdir(), "research-pack-"));
try {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "pack", "--json", "--ignore-scripts", "--pack-destination", directory], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const names = new Set(pack.files.map((file) => file.path));
  for (const file of ["dist/browser/pi-web-plugin.js", "dist/server-plugin.js", "dist/companion.js", "dist/pdf-text-worker.js", "dist/vendor/citeproc.cjs", "dist/licenses/dependencies.json", "dist/licenses/citeproc/CPAL-1.0.txt", "dist/browser/licenses/citeproc/source.txt", "dist/browser/pdfjs/pdf.worker.min.mjs", "README.md", "LICENSE", "NOTICE"]) assert(names.has(file), `Missing ${file}`);
  for (const file of names) assert(/^(dist\/|docs\/|package.json$|README.md$|LICENSE$|NOTICE$)/.test(file), `Unexpected packed file ${file}`);
  assert(!names.has("dist/browser/example.synthetic.json"), "Retired demo must not be packaged");
  assert(pack.unpackedSize < 16 * 1024 * 1024 && pack.entryCount < 4096, "Package exceeds host discovery bounds");
  const tar = gunzipSync(await readFile(join(directory, pack.filename)));
  const entries = new Set();
  for (let position = 0; position + 512 <= tar.length;) {
    const header = tar.subarray(position, position + 512);
    const leaf = header.subarray(0, 100).toString().split("\0")[0];
    if (!leaf) break;
    const prefix = header.subarray(345, 500).toString().split("\0")[0];
    const name = prefix ? `${prefix}/${leaf}` : leaf;
    assert(name.startsWith("package/") && !name.includes("\\"));
    const target = resolve(directory, name);
    assert(target.startsWith(resolve(directory, "package") + sep), `Unsafe archive name: ${name}`);
    assert(header[156] === 0 || header[156] === 48, `Nonregular archive member: ${name}`);
    entries.add(name);
    const size = Number.parseInt(header.subarray(124, 136).toString().replaceAll("\0", "").trim(), 8);
    assert(Number.isSafeInteger(size) && size >= 0 && position + 512 + size <= tar.length);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, tar.subarray(position + 512, position + 512 + size), { flag: "wx" });
    position += 512 + Math.ceil(size / 512) * 512;
  }
  for (const file of names) assert(entries.has(`package/${file}`), `Archive missing ${file}`);
  const probe = spawnSync(process.execPath, [resolve("scripts/smoke-packed.mjs"), join(directory, "package")], { cwd: directory, encoding: "utf8", timeout: 120_000, env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}\n${probe.error ?? ""}`);
  console.log(probe.stdout.trim());
  console.log(`Real tarball validated: ${pack.entryCount} entries; ${pack.unpackedSize} unpacked bytes.`);
} finally { await rm(directory, { recursive: true, force: true }); }
