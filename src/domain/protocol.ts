export const RESEARCH_PROTOCOL_VERSION = 1;
export const PDF_CHUNK_BYTES = 256 * 1024;
export const PDF_MAX_READERS = 4;
export const PDF_IDLE_MS = 120_000;
export const ANNOTATION_PAGE_SIZE = 20;

export interface PaperScope {
  libraryId: string;
  paperId: string;
  pdfSha256: string;
}

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object");
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(result).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(result, key))) throw new Error("Missing or unsupported protocol field");
  return result;
}

export function boundedString(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || value.length > 256 || !pattern.test(value)) throw new Error("Invalid protocol identity");
  return value;
}

export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid protocol integer");
  return value;
}

export function paperScope(value: unknown): PaperScope {
  const input = record(value, ["libraryId", "paperId", "pdfSha256"]);
  return {
    libraryId: boundedString(input["libraryId"], /^pilot-[a-z][a-z0-9.-]{0,62}$/u),
    paperId: boundedString(input["paperId"], /^pilot-[a-z][a-z0-9.-]{0,62}$/u),
    pdfSha256: boundedString(input["pdfSha256"], /^[a-f0-9]{64}$/u),
  };
}
