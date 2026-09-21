import { loadLocalPilotLibrary } from "../companion/pilotCore.js";
import { pilotPaperById } from "../domain/pilot.js";
import type { PaperScope } from "../domain/protocol.js";

export async function resolvePaper(root: string, scope: PaperScope) {
  const library = await loadLocalPilotLibrary(root);
  const paper = pilotPaperById(library.config, scope.paperId);
  if (library.config.libraryId !== scope.libraryId || paper?.pdf.sha256 !== scope.pdfSha256) throw new Error("Paper or PDF revision no longer matches this library. Refresh.");
  return paper;
}
