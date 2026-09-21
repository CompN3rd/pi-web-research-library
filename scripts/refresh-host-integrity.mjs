import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// The pinned source is reproducible; its platform-built tarball is not promised
// byte-identical. Refresh this one local artifact hash, never registry resolutions.
const source = "file:.host-package/pi-web.tgz";
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const host = lock.packages?.["node_modules/@jmfederico/pi-web"];
if (manifest.devDependencies?.["@jmfederico/pi-web"] !== source
  || lock.packages?.[""]?.devDependencies?.["@jmfederico/pi-web"] !== source
  || host?.resolved !== source) {
  throw new Error("Expected the pinned-source local PI WEB artifact in manifest and lockfile");
}
const artifact = await readFile(".host-package/pi-web.tgz");
host.integrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;
await writeFile("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
console.log("Refreshed only the local PI WEB artifact integrity; registry dependency resolutions retained.");
