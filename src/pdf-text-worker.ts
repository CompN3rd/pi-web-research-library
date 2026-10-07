import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";
import { libraryObject, libraryText, type LibraryTextPage } from "./domain/workbench.js";
import { PDF_TEXT_MAX_CHARS, PDF_TEXT_MAX_PAGE_CHARS, PDF_TEXT_MAX_PAGES } from "./server/workbenchText.js";

const port = parentPort;
if (port === null) throw new Error("PDF text extractor requires its private worker channel");
try {
  const input = libraryObject(workerData, ["snapshot"]);
  const snapshot = libraryText(input["snapshot"], 4_096, false);
  // The parent streams, hashes and snapshots a host-resolved PDF before launch.
  // Network URLs, browser extraction and model text are never extraction inputs.
  const data = new Uint8Array(await readFile(snapshot));
  const pdf = await getDocumentProxy(data, {
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    maxImageSize: 16_777_216,
    cMapUrl: fileURLToPath(new URL("./browser/pdfjs/cmaps/", import.meta.url)).replaceAll("\\", "/"),
    cMapPacked: true,
    standardFontDataUrl: fileURLToPath(new URL("./browser/pdfjs/standard_fonts/", import.meta.url)).replaceAll("\\", "/"),
  });
  try {
    if (pdf.numPages < 1 || pdf.numPages > PDF_TEXT_MAX_PAGES) throw new Error("PDF exceeds the 2,000-page extraction limit");
    const pages: LibraryTextPage[] = [];
    let characters = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const parts: string[] = [];
      let pageLength = 0;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        // Preserve text order and page boundaries, not claimed reading-order geometry.
        const text = Array.from(item.str).map(character => { const code = character.charCodeAt(0); return (code < 32 || (code >= 127 && code <= 159)) ? " " : character; }).join("");
        parts.push(text, item.hasEOL ? "\n" : " ");
        pageLength += text.length + 1;
        if (pageLength > PDF_TEXT_MAX_PAGE_CHARS) throw new Error("A PDF page exceeds the 64,000-character text limit");
      }
      const text = parts.join("").trim();
      characters += text.length;
      if (characters > PDF_TEXT_MAX_CHARS) throw new Error("PDF exceeds the 2,000,000-character text limit");
      pages.push({ page: number, text });
      page.cleanup();
    }
    const empty = pages.filter(page => page.text === "").length;
    const warnings = ["PDF text order may differ from visual reading order; verify quotations in the PDF."];
    if (empty > 0) warnings.push(`${String(empty)} page(s) have no extractable text. This index does not perform OCR.`);
    port.postMessage({ ok: true, result: { pages, warnings } });
  } finally { await pdf.loadingTask.destroy(); }
} catch (error) {
  port.postMessage({ ok: false, error: error instanceof Error ? error.message.slice(0, 1_000) : "PDF text extraction failed" });
}
