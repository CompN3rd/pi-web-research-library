// Real browser + compiled package. The local public transport/session adapter is
// not a live PI WEB daemon. No user state, credentials or provider calls are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import plugin from "../dist/server-plugin.js";
import { nativeSmokeHost } from "./smoke-native-host.mjs";
import { smokeNative } from "./smoke-native.mjs";
import { syntheticPdf, syntheticReaderPdf } from "./synthetic-pdf.mjs";
import { smokeReader } from "./smoke-reader.mjs";
import { smokeReaderAnnotations } from "./smoke-reader-annotations.mjs";
import { smokeReaderTextComments } from "./smoke-reader-text-comments.mjs";

await mkdir(".smoke", { recursive: true });
await build({ entryPoints: ["src/server/fixture.testSupport.ts"], outfile: ".smoke/fixture.js", bundle: true, platform: "node", format: "esm" });
const { researchFixture } = await import("../.smoke/fixture.js");
const harness = `
import { html, svg, render } from 'lit';
import plugin from '../dist/browser/pi-web-plugin.js';
const activation = await plugin.activate({apiVersion:4,pluginId:'research-library',runtimePluginId:'research-library',html,svg,signal:new AbortController().signal,lifetimeSignal:new AbortController().signal});
const panels = activation.contributions.workspacePanels;
if (panels.length !== 2) throw Error('Only Library and Discover should be registered');
const panelIds = { native:'workspace.research-library.native', discovery:'workspace.research-library.discovery' };
const panel = panels.find(panel => panel.id === panelIds[new URL(location.href).searchParams.get('panel') ?? 'native']);
if (!panel) throw Error('Requested smoke panel is missing');
const peer = {request: async (operation,input,options={}) => { const response=await fetch('peer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,input}),signal:options.signal}); const value=await response.json(); if(!response.ok) throw Error(value.error); return value; }};
const context = {machine:{id:'local',name:'Test',kind:'local'},workspace:{id:'w',projectId:'p',path:'test',label:'Test',isMain:true},peer,
files:{capabilityVersion:1,maxInlinePreviewBytes:10485760,defaultUploadFolder:'.pi-web/uploads',readFile:async()=>{throw Error('No browser source discovery');},listFiles:async()=>{throw Error('No browser file listing');},writeFile:async()=>{throw Error('No browser writes');},deleteFile:async()=>{throw Error('No browser deletes');},moveFile:async()=>{throw Error('No browser moves');},previewUrl:()=>new URL('download',location.href).href,downloadUrl:()=>new URL('download',location.href).href,uploadFile:()=>{throw Error('No upload');}},prompt:{getText:()=>'',insertText:()=>{throw Error('No prompt injection');},getSelection:()=>null},terminal:{open(){},runCommand(){throw Error('No terminal');}},host:{requestRender:()=>renderPanel()}};
function renderPanel(){render(panel.render(context),document.body)}
window.researchPeer=peer;
renderPanel();
`;
await build({ stdin: { contents: harness, resolveDir: resolve(".smoke"), sourcefile: "harness-entry.js", loader: "js" }, outfile: ".smoke/harness.js", bundle: true, format: "esm", platform: "browser", external: ["../dist/browser/pi-web-plugin.js"] });
// Keep the compiled plugin separate so its module-relative assets are exercised.
const harnessJs = (await readFile(".smoke/harness.js", "utf8")).replace("../dist/browser/pi-web-plugin.js", "./plugin/pi-web-plugin.js");
const f = await researchFixture(syntheticPdf("Synthetic research paper", 12 * 1024 * 1024));
const lifetime = new AbortController();
const logs = [], operations = [];
const host = nativeSmokeHost(f.root);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error("Unexpected server network request in synthetic browser smoke"); };
const activation = await plugin.activate({ apiVersion: 3, pluginId: "research-library", packageRoot: process.cwd(), dataDirectory: join(f.root, "plugin-data"), settings: {}, signal: new AbortController().signal, lifetimeSignal: lifetime.signal, logger: { debug() {}, info() {}, warn: (...v) => logs.push(v), error: (...v) => logs.push(v) }, execFile: () => { throw Error("No shell capability used"); } });
const server = createServer((request, response) => { void serve(request, response).catch((error) => { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }); });
let browser;
try {
  await activation.start({ signal: new AbortController().signal, capabilities: { resolve(capability) {
    if (capability.id === "pi-sessions") return capability.parse(host.sessions);
    if (capability.id === "pi-session-events") return capability.parse(host.events);
    throw Error(`Unexpected public capability: ${capability.id}`);
  } } });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}/nested/`;
  browser = await chromium.launch(process.env.RESEARCH_BROWSER_CHANNEL ? { channel: process.env.RESEARCH_BROWSER_CHANNEL, headless: true } : {});
  const errors = [];
  browser.on("page", page => { page.on("console", message => { if (["error", "warning"].includes(message.type())) console.error("Browser console:", message.text()); }); });
  const page = await browser.newPage(); page.on("pageerror", error => errors.push(String(error)));
  await page.goto(url);
  await page.getByRole("link", { name: "citeproc-js implements the Citation Style Language", exact: true }).waitFor();
  for (const [label, required] of [["CSL engine source", "Copyright (c) 2009-2019 Frank Bennett"], ["CPAL license", "EXHIBIT B. Attribution Information"]]) {
    const href = await page.getByRole("link", { name: label, exact: true }).getAttribute("href");
    assert.equal(new URL(href).origin, new URL(url).origin);
    const asset = await page.request.get(href); assert(asset.ok()); assert((await asset.text()).includes(required));
  }
  await page.close();
  const checks = await smokeNative({ browser, url, fixture: f, host, errors });
  checks.push(...await smokeReader({ browser, url, errors }));
  checks.push(...await smokeReaderAnnotations({ browser, url, errors }));
  checks.push(...await smokeReaderTextComments({ browser, url, errors }));
  assert(operations.some(op => op.operation === "library.pdf.open"));
  assert(operations.some(op => op.operation === "library.text.index"));
  assert(operations.filter(op => op.operation === "discovery.search").every(op => op.input.payload.provider === "local"));
  assert(operations.every(op => /^(library|collections|evidence|tasks|writing|discovery)\./u.test(op.operation) || ["pdf.read", "pdf.close"].includes(op.operation)));
  const ranges = operations.filter(op => op.operation === "pdf.read"); assert(ranges.length > 0);
  for (const op of ranges) assert(op.input.payload.end - op.input.payload.begin <= 256 * 1024);
  assert(f.pdf.length > 10 * 1024 * 1024, "Exercise PDFs larger than the generic host preview limit");
  assert.deepEqual(errors, []); assert.deepEqual(logs, []);
  console.log(JSON.stringify({ status: "passed", browser: await browser.version(), pdfBytes: f.pdf.length, rangeRequests: ranges.length, checks: ["only Library/Discover panels", "compiled browser/server entries", "nested module assets", "visible CSL attribution and local source/license assets", ...checks], host: "synthetic public transport/session-events adapter; not a real daemon or model provider", network: "server fetch forbidden; discovery exercised locally only" }, null, 2));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  lifetime.abort(); await activation.dispose(new AbortController().signal);
  await host.dispose(); globalThis.fetch = originalFetch;
  await rm(f.root, { recursive: true, force: true });
}
async function serve(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  if (url.pathname === "/nested/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><style>:root{font:14px system-ui;--pi-bg:#fff;--pi-surface:#f5f6f8;--pi-text:#202530;--pi-text-secondary:#454b55;--pi-muted:#626974;--pi-border:#ccd0d7;--pi-border-muted:#ddd;--pi-accent:#2965cc;--pi-accent-border:#6790d3;--pi-bg-overlay-soft:#eef4ff;--pi-danger:#b42323;--pi-success:#1c6d38;--pi-success-border:#519d68;--pi-success-surface:#effbf3}body{margin:20px;max-width:1000px}</style></head><body><script type="module" src="harness.js"></script></body></html>'); return; }
  if (url.pathname === "/nested/harness.js") { response.setHeader("content-type", "text/javascript"); response.end(harnessJs); return; }
  if (url.pathname.startsWith("/nested/plugin/")) {
    const root = resolve("dist/browser"); const path = resolve(root, decodeURIComponent(url.pathname.slice("/nested/plugin/".length)));
    assert(path.startsWith(root + sep));
    response.setHeader("content-type", [".js", ".mjs"].includes(extname(path)) ? "text/javascript" : extname(path) === ".wasm" ? "application/wasm" : "application/octet-stream");
    response.end(await readFile(path)); return;
  }
  if (url.pathname === "/nested/reader-fixture.pdf") { response.setHeader("content-type", "application/pdf"); response.end(syntheticReaderPdf()); return; }
  if (url.pathname === "/nested/download") { response.setHeader("content-type", "application/pdf"); response.end(f.pdf); return; }
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/nested/peer") {
    let body = ""; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 256 * 1024) throw Error("Request too large"); }
    const input = JSON.parse(body); operations.push(input);
    const controller = new AbortController(); response.on("close", () => controller.abort());
    const result = await activation.peer.request({ project: { id: "p", name: "P", path: f.root }, workspace: { id: "w", projectId: "p", path: f.root, label: "W", isMain: true }, ...input, signal: controller.signal }); response.end(JSON.stringify(result)); return;
  }
  response.statusCode = 404; response.end('{}');
}
