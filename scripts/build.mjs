import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({ entryPoints: ["src/server-plugin.ts", "src/companion.ts"], outdir: "dist", bundle: true, platform: "node", target: "node22", format: "esm", packages: "external" });
await build({ entryPoints: ["src/browser/pi-web-plugin.ts"], outdir: "dist/browser", bundle: true, platform: "browser", target: "es2022", format: "esm" });
await mkdir("dist/browser/pdfjs", { recursive: true });
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) await cp(`node_modules/pdfjs-dist/build/${file}`, `dist/browser/pdfjs/${file}`);
for (const path of ["cmaps", "standard_fonts", "wasm", "iccs", "LICENSE"]) await cp(`node_modules/pdfjs-dist/${path}`, `dist/browser/pdfjs/${path}`, { recursive: true });
await cp("src/browser/example.synthetic.json", "dist/browser/example.synthetic.json");
