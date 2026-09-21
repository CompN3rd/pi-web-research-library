import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RESEARCH_LIBRARY_PILOT_CONFIG_PATH, RESEARCH_LIBRARY_PILOT_RIGHTS } from "../domain/pilot.js";
import { createAnnotationRecord } from "../domain/annotation.js";

export async function researchFixture(pdf: Buffer = Buffer.from("%PDF-1.7\nsynthetic test bytes\n")) {
  const root = await mkdtemp(join(tmpdir(), "research-plugin-test-"));
  const digest = createHash("sha256").update(pdf).digest("hex");
  const scope = { libraryId: "pilot-test", paperId: "pilot-paper", pdfSha256: digest };
  const pdfPath = join(root, "raw/research-library-pilot/paper.pdf");
  const manifestPath = join(root, RESEARCH_LIBRARY_PILOT_CONFIG_PATH);
  const manifest = {
    version: 1, pilot: true, libraryId: scope.libraryId,
    papers: [{
      id: scope.paperId, bibkey: "Test2026", title: "Synthetic test paper", authors: ["Test author"],
      sourceNotePath: "Thesis/Citations/Test2026.md", sourceNoteSha256: "a".repeat(64), relatedTopics: [], metaCategories: [], usedBy: [],
      pdf: { path: "raw/research-library-pilot/paper.pdf", sha256: digest, size: pdf.length, sourceUrl: "https://example.test/paper.pdf", sourcePageUrl: "https://example.test/paper", retrievedAt: "2026-08-08T12:00:00.000Z", rights: RESEARCH_LIBRARY_PILOT_RIGHTS },
    }],
  };
  await mkdir(dirname(pdfPath), { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(pdfPath, pdf);
  await writeFile(manifestPath, JSON.stringify(manifest));
  const annotation = createAnnotationRecord({ ...scope, page: 1, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, quote: "Synthetic quote", body: "Why?", kind: "question" });
  return { root, scope, pdf, pdfPath, manifest, manifestPath, annotation };
}
