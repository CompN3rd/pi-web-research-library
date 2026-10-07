import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Test-only source PDF; creates no catalog or application/demo configuration. */
export async function researchFixture(pdf: Buffer = Buffer.from("%PDF-1.7\nsynthetic admission test bytes\n%%EOF\n")) {
  const root = await mkdtemp(join(tmpdir(), "research-plugin-test-"));
  const source = { path: "papers/synthetic.pdf", size: pdf.length, sha256: createHash("sha256").update(pdf).digest("hex") };
  const pdfPath = join(root, source.path);
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, pdf);
  return { root, source, pdf, pdfPath };
}
