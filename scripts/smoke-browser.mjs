// Real browser + compiled package. Host transport/authority are a local test adapter,
// not a live PI WEB daemon. No user state, credentials or provider calls are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import plugin from "../dist/server-plugin.js";

await mkdir(".smoke", { recursive: true });
await build({ entryPoints: ["src/server/fixture.testSupport.ts"], outfile: ".smoke/fixture.js", bundle: true, platform: "node", format: "esm" });
const { researchFixture } = await import("../.smoke/fixture.js");
const harness = `
import { html, svg, render } from 'lit';
import plugin from '../dist/browser/pi-web-plugin.js';
const activation = await plugin.activate({apiVersion:4,pluginId:'research-library',runtimePluginId:'research-library',html,svg,signal:new AbortController().signal,lifetimeSignal:new AbortController().signal});
const panel = activation.contributions.workspacePanels[0];
const peer = {request: async (operation,input,options={}) => { const response=await fetch('peer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,input}),signal:options.signal}); const value=await response.json(); if(!response.ok) throw Error(value.error); return value; }};
const context = {machine:{id:'local',name:'Test',kind:'local'},workspace:{id:'w',projectId:'p',path:'test',label:'Test',isMain:true},peer,
files:{capabilityVersion:1,maxInlinePreviewBytes:10485760,defaultUploadFolder:'.pi-web/uploads',readFile:async path=>{const r=await fetch('read?path='+encodeURIComponent(path));const v=await r.json();if(!r.ok)throw Error(v.error);return v;},listFiles:async()=>{throw Error('No browser annotation listing');},writeFile:async()=>{throw Error('No browser writes');},deleteFile:async()=>{throw Error('No browser deletes');},moveFile:async()=>{throw Error('No browser moves');},previewUrl:()=>new URL('download',location.href).href,downloadUrl:()=>new URL('download',location.href).href,uploadFile:()=>{throw Error('No upload');}},prompt:{getText:()=>'',insertText:()=>{throw Error('No prompt injection');},getSelection:()=>null},terminal:{open(){},runCommand(){throw Error('No terminal');}},host:{requestRender:()=>renderPanel()}};
function renderPanel(){render(panel.render(context),document.body)}
window.researchPeer=peer;
renderPanel();
`;
await build({ stdin: { contents: harness, resolveDir: resolve(".smoke"), sourcefile: "harness-entry.js", loader: "js" }, outfile: ".smoke/harness.js", bundle: true, format: "esm", platform: "browser", external: ["../dist/browser/pi-web-plugin.js"] });
// Keep the compiled plugin separate so its module-relative assets are exercised.
let harnessJs = await readFile(".smoke/harness.js", "utf8");
harnessJs = harnessJs.replace("../dist/browser/pi-web-plugin.js", "./plugin/pi-web-plugin.js");
const f = await researchFixture(makePdf());
const lifetime = new AbortController();
const logs = [], operations = [];
const activation = await plugin.activate({ apiVersion: 3, pluginId: "research-library", packageRoot: process.cwd(), dataDirectory: join(f.root, "plugin-data"), settings: {}, signal: new AbortController().signal, lifetimeSignal: lifetime.signal, logger: { debug() {}, info() {}, warn: (...v) => logs.push(v), error: (...v) => logs.push(v) }, execFile: () => { throw Error("No shell capability used"); } });
const server = createServer((request, response) => { void serve(request, response).catch((error) => { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }); });
let browser;
try {
  await activation.start({ signal: new AbortController().signal, capabilities: { resolve() { throw Error("No session capability used"); } } });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}/nested/`;
  browser = await chromium.launch(process.env.RESEARCH_BROWSER_CHANNEL ? { channel: process.env.RESEARCH_BROWSER_CHANNEL, headless: true } : {});
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = []; page.on("pageerror", (error) => { errors.push(String(error)); console.error("Browser error:", error); });
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console.error("Browser console:", message.text()); });
  await page.goto(url);
  try { await page.getByText("Page 1 of 1 · 100%", { exact: true }).waitFor({ timeout: 30_000 }); }
  catch (error) {
    console.error("Panel:", await page.locator("pi-web-research-library-panel").evaluate((element) => element.shadowRoot?.textContent));
    console.error("Reader:", await page.locator("pi-web-research-library-pdf-viewer").evaluate((element) => element.shadowRoot?.textContent).catch(() => "missing"));
    console.error("Operations:", operations.map((operation) => operation.operation));
    throw error;
  }
  const canvas = page.locator("canvas");
  const pixels = await canvas.evaluate((element) => { const ctx=element.getContext('2d');const image=ctx.getImageData(0,0,element.width,element.height);return image.data.some((value,index)=>index%4!==3&&value<100); });
  assert(pixels, "PDF text must actually paint, not just allocate a canvas");
  await page.getByRole("button", { name: "Mark region", exact: true }).click();
  const box = await canvas.boundingBox(); assert(box);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 140, { steps: 10 }); await page.mouse.up();
  await page.locator("textarea[data-annotation-body]").fill("Browser smoke question");
  await page.getByRole("button", { name: "Save annotation", exact: true }).click();
  await page.getByText("1 total · 1 open", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("1 total · 1 open", { exact: true }).waitFor();
  await page.getByText("Page 1 of 1 · 100%", { exact: true }).waitFor();
  const second = await browser.newPage(); await second.goto(url);
  await second.getByText("1 total · 1 open", { exact: true }).waitFor();
  await page.locator('[data-annotation-action="edit"]').click();
  await second.locator('[data-annotation-action="edit"]').click();
  await page.locator('[data-annotation-edit-body]').fill("First tab edit");
  await page.locator('[data-annotation-action="edit-save"]').click();
  await page.getByText("Annotation updated.", { exact: true }).waitFor();
  await second.locator('[data-annotation-edit-body]').fill("Stale second tab edit");
  await second.locator('[data-annotation-action="edit-save"]').click();
  await second.getByText("This annotation changed elsewhere. Refresh before editing it again.", { exact: true }).waitFor();
  assert(operations.some((op) => op.operation === "pdf.read"));
  for (const op of operations.filter((op) => op.operation === "pdf.read")) assert(op.input.payload.end - op.input.payload.begin <= 256 * 1024);
  assert(f.pdf.length > 10 * 1024 * 1024, "Exercise PDFs larger than the generic host preview limit");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: ".smoke/research-library.png", fullPage: true });
  console.log(JSON.stringify({ status: "passed", browser: await browser.version(), pdfBytes: f.pdf.length, rangeRequests: operations.filter((op) => op.operation === "pdf.read").length, checks: ["compiled browser/server entries", "nested module assets", "PDF.js worker rendering", "12 MiB PDF", "region marking", "annotation persistence across reload", "two-tab revision conflict"], host: "test transport adapter; not a real daemon" }, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  lifetime.abort(); await activation.dispose(new AbortController().signal);
  await rm(f.root, { recursive: true, force: true });
}
async function serve(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/nested/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><body style="margin:20px;max-width:1000px"><script type="module" src="harness.js"></script></body></html>'); return; }
  if (url.pathname === "/nested/harness.js") { response.setHeader("content-type", "text/javascript"); response.end(harnessJs); return; }
  if (url.pathname.startsWith("/nested/plugin/")) {
    const root = resolve("dist/browser"); const path = resolve(root, decodeURIComponent(url.pathname.slice("/nested/plugin/".length)));
    assert(path.startsWith(root + sep));
    response.setHeader("content-type", [".js", ".mjs"].includes(extname(path)) ? "text/javascript" : extname(path) === ".wasm" ? "application/wasm" : "application/octet-stream");
    response.end(await readFile(path)); return;
  }
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/nested/read") {
    if (url.searchParams.get("path") !== "raw/_processed/research-library-pilot/library.json") { response.statusCode=404; response.end(JSON.stringify({error:"Path does not exist"})); return; }
    const content = await readFile(f.manifestPath,"utf8"); response.end(JSON.stringify({path:url.searchParams.get("path"),content,size:Buffer.byteLength(content),encoding:"utf8",modifiedAt:new Date().toISOString(),truncated:false,binary:false}));return;
  }
  if (url.pathname === "/nested/peer") {
    let body = ""; for await (const chunk of request) { body += chunk; if(Buffer.byteLength(body)>256*1024)throw Error("Request too large"); }
    const input=JSON.parse(body);operations.push(input);
    const controller = new AbortController(); response.on("close",()=>controller.abort());
    const result = await activation.peer.request({project:{id:"p",name:"P",path:f.root},workspace:{id:"w",projectId:"p",path:f.root,label:"W",isMain:true},...input,signal:controller.signal});response.end(JSON.stringify(result));return;
  }
  response.statusCode=404;response.end('{}');
}
function makePdf() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const text = "BT /F1 20 Tf 30 240 Td (Synthetic research paper) Tj ET\n";
  objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`);
  let pdf="%PDF-1.7\n"; const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  pdf += "%" + " ".repeat(12*1024*1024) + "\n";
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
