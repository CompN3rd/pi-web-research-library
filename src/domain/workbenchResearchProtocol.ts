import { libraryId, libraryObject, libraryStrings, libraryText, type CorpusBinding, type LibraryResearchResult, type LibraryTaskKind } from "./workbench.js";

export const WORKBENCH_RESULT_CHANNEL = "compn3rd.research-library.native.result.v1";
export const WORKBENCH_ACK_CHANNEL = "compn3rd.research-library.native.ack.v1";
export const WORKBENCH_RESULT_BYTES = 128 * 1024;
export const WORKBENCH_TOOL_BYTES = 64 * 1024;

export const researchRecipes: Record<LibraryTaskKind, string> = {
  summary: "Summarize the question, methods, findings and limitations. Distinguish source claims from your synthesis.",
  critique: "Critique methods, assumptions, validity, uncertainty and limitations; distinguish documented issues from hypotheses.",
  comparison: "Compare the selected sources in an evidence matrix. Use cells for method, population, findings and limitations; mark unavailable information explicitly.",
  extraction: "Extract structured evidence into cells with stable, descriptive column names. Never fill missing values with guesses.",
  outline: "Propose an argument outline with evidence-backed claims and explicit evidence gaps, not a completed manuscript.",
  "related-work": "Draft a related-work synthesis organized by themes, contrasts and gaps. Attribute every substantive source claim.",
  "manuscript-audit": "Audit the manuscript material explicitly supplied in the goal against the selected corpus. Identify unsupported claims and citation gaps; do not claim access to an unspecified manuscript.",
  "reviewer-response": "Draft a point-by-point response to reviewer comments explicitly supplied in the goal. Separate evidence, proposed revisions and unresolved issues; never claim revisions were already made.",
};

export function researchEnum<T extends string>(value: unknown, values: readonly T[]): T {
  const found = values.find(item => item === value);
  if (found === undefined) throw new Error("Invalid research choice");
  return found;
}
export function researchIds(value: unknown, prefix: string, max = 20): string[] {
  return libraryStrings(value, max, 80).map(id => libraryId(id, prefix));
}
export function resultHashText(value: unknown): string {
  const hash = libraryText(value, 64, false);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid corpus hash");
  return hash;
}

/** Structural validation only; publication additionally verifies the frozen corpus and session. */
export function parseResearchResult(value: unknown): LibraryResearchResult {
  const input = libraryObject(value, ["markdown", "claims", "cells", "warnings"]);
  if (!Array.isArray(input["claims"]) || input["claims"].length > 100 || !Array.isArray(input["cells"]) || input["cells"].length > 500) throw new Error("Too many research claims or cells");
  const result: LibraryResearchResult = {
    markdown: libraryText(input["markdown"], 64_000, false),
    claims: input["claims"].map((value: unknown) => {
      const claim = libraryObject(value, ["id", "text", "referenceIds", "evidenceIds", "relationship"]);
      const id = libraryText(claim["id"], 80, false);
      if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error("Invalid claim id");
      const referenceIds = researchIds(claim["referenceIds"], "ref");
      if (referenceIds.length === 0) throw new Error("Claims must identify their sources");
      return { id, text: libraryText(claim["text"], 4_000, false), referenceIds, evidenceIds: researchIds(claim["evidenceIds"], "ev", 50), relationship: researchEnum(claim["relationship"], ["supports", "contrasts", "context", "uncertain"]) };
    }),
    cells: input["cells"].map((value: unknown) => {
      const cell = libraryObject(value, ["referenceId", "column", "value", "evidenceIds"]);
      return { referenceId: libraryId(cell["referenceId"], "ref"), column: libraryText(cell["column"], 120, false), value: libraryText(cell["value"], 4_000, false), evidenceIds: researchIds(cell["evidenceIds"], "ev", 50) };
    }),
    warnings: libraryStrings(input["warnings"], 30, 1_000),
  };
  if (new Set(result.claims.map(claim => claim.id)).size !== result.claims.length) throw new Error("Duplicate claim id");
  if (new Set(result.cells.map(cell => JSON.stringify([cell.referenceId, cell.column]))).size !== result.cells.length) throw new Error("Duplicate matrix cell");
  if (new TextEncoder().encode(JSON.stringify(result)).length > WORKBENCH_RESULT_BYTES) throw new Error("Research result exceeds the transport budget");
  return result;
}

/** Attribution is checked against the frozen snapshot, not current source freshness. */
export function assertResultAttribution(result: LibraryResearchResult, corpus: CorpusBinding[]): void {
  const references = new Set(corpus.map(binding => binding.referenceId));
  const evidence = new Map(corpus.flatMap(binding => binding.evidence.map(item => [item.id, binding.referenceId] as const)));
  for (const claim of result.claims) {
    if (claim.referenceIds.some(id => !references.has(id)) || claim.evidenceIds.some(id => !claim.referenceIds.includes(evidence.get(id) ?? ""))) throw new Error("Claim cites evidence outside its frozen sources");
  }
  for (const cell of result.cells) {
    if (!references.has(cell.referenceId) || cell.evidenceIds.some(id => evidence.get(id) !== cell.referenceId)) throw new Error("Matrix cell cites evidence outside its frozen source");
  }
}
