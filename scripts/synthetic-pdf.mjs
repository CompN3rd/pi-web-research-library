// Authored PDF bytes for package/browser verification, never real research data.
export function syntheticReaderPdf(count = 3, mixedSizes = false, withOutline = false) {
  const kids = Array.from({ length: count }, (_, index) => `${4 + index * 2} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let page = 1; page <= count; page++) {
    const width = mixedSizes && page === 4 ? 900 : 600;
    const height = mixedSizes && page === 4 ? 600 : mixedSizes && page === 6 ? 1000 : 800;
    const lines = [`Reading fixture - page ${page}`, "A quiet place to read.", ...Array.from({ length: 18 }, (_, i) => `Passage ${i + 1}: synthetic reading text for selection and navigation.`), page === 2 ? "Unique needle on the second page." : "End of this synthetic page."];
    const stream = `BT /F1 16 Tf 48 ${height - 60} Td 30 TL ${lines.map((line, i) => `${i ? "T* " : ""}(${line}) Tj`).join("\n")} ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  if (withOutline) {
    if (count < 8) throw new Error("Outline fixture requires eight pages");
    const root = objects.length + 1;
    objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${root} 0 R /Names << /Dests << /Names [(methods) [10 0 R /Fit]] >> >> >>`;
    objects.push(
      `<< /Type /Outlines /First ${root + 1} 0 R /Last ${root + 4} 0 R /Count 4 >>`,
      `<< /Title (Introduction) /Parent ${root} 0 R /Next ${root + 3} 0 R /First ${root + 2} 0 R /Last ${root + 2} 0 R /Count 1 /Dest [6 0 R /Fit] >>`,
      `<< /Title (Methods) /Parent ${root + 1} 0 R /Dest (methods) >>`,
      `<< /Title (Results) /Parent ${root} 0 R /Prev ${root + 1} 0 R /Next ${root + 4} 0 R /Dest [18 0 R /XYZ 0 300 2] >>`,
      `<< /Title (External website) /Parent ${root} 0 R /Prev ${root + 3} 0 R /A << /S /URI /URI (https://example.invalid/) >> >>`,
    );
  }
  let pdf = "%PDF-1.7\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export function syntheticPdf(text = "Synthetic research paper", paddingBytes = 0) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const stream = `BT /F1 20 Tf 30 240 Td (${text.replaceAll(/[()\\]/g, "\\$&")}) Tj ET\n`;
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  let pdf = "%PDF-1.7\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  pdf += "%" + " ".repeat(paddingBytes) + "\n";
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
