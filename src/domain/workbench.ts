import type { PdfRect } from "./pdf.js";

/** Workspace-owned reference, evidence, research and manuscript catalog. */
export const LIBRARY_ROOT = ".pi-web/research-library";
export const LIBRARY_STATE_PATH = `${LIBRARY_ROOT}/library.json`;
export const LIBRARY_VERSION = 1;
export const LIBRARY_PAGE_SIZE = 25;
export const LIBRARY_MAX_BYTES = 16 * 1024 * 1024;
export const LIBRARY_MAX_REFERENCES = 5_000;
export const LIBRARY_MAX_EVIDENCE = 10_000;
export const LIBRARY_MAX_TASKS = 200;
export const LIBRARY_MAX_MANUSCRIPTS = 100;
export const LIBRARY_MAX_PDF_BYTES = 128 * 1024 * 1024;
export const referenceTypes = ["article-journal", "book", "chapter", "paper-conference", "thesis", "report", "webpage", "dataset", "software", "manuscript"] as const;
export type ReferenceType = typeof referenceTypes[number];
export type ReadingStatus = "inbox" | "reading" | "read";
export type ScreeningStatus = "unscreened" | "included" | "excluded";
export type BibliographyFormat = "bibtex" | "ris" | "csl-json";
export type CitationStyle = "apa" | "vancouver" | "harvard1";

export interface LibraryDocument {
  id: string;
  path: string;
  sha256: string;
  size: number;
  label: string;
  sourceUrl: string;
  rights: string;
  addedAt: string;
}
export interface ReferenceFields {
  type: ReferenceType;
  citekey: string;
  title: string;
  authors: string[];
  year: number | null;
  containerTitle: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  doi: string;
  isbn: string;
  url: string;
  abstract: string;
  language: string;
  tags: string[];
  collectionIds: string[];
  readingStatus: ReadingStatus;
  screening: ScreeningStatus;
  screeningReason: string;
  favorite: boolean;
  notes: string;
}
export interface LibraryReference extends ReferenceFields {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  documents: LibraryDocument[];
  aliases: string[];
  /** Imports are provenance, not permission to overwrite user edits. */
  provenance: string[];
}
export interface LibraryCollection { id: string; name: string; parentId: string | null; revision: number }
export interface LibraryEvidence {
  id: string;
  revision: number;
  referenceId: string;
  documentId: string | null;
  pdfSha256: string | null;
  page: number | null;
  rect: PdfRect | null;
  quote: string;
  body: string;
  kind: "quote" | "note" | "question";
  status: "open" | "resolved";
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface CorpusBinding { referenceId: string; revision: number; documentHashes: string[]; evidence: { id: string; revision: number }[] }
export const libraryTaskKinds = ["summary", "critique", "comparison", "extraction", "outline", "related-work", "manuscript-audit", "reviewer-response"] as const;
export type LibraryTaskKind = typeof libraryTaskKinds[number];
export type LibraryTaskStatus = "starting" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ResearchClaim { id: string; text: string; referenceIds: string[]; evidenceIds: string[]; relationship: "supports" | "contrasts" | "context" | "uncertain" }
export interface ResearchCell { referenceId: string; column: string; value: string; evidenceIds: string[] }
export interface LibraryResearchResult { markdown: string; claims: ResearchClaim[]; cells: ResearchCell[]; warnings: string[] }
export interface LibraryTask {
  id: string;
  revision: number;
  kind: LibraryTaskKind;
  goal: string;
  referenceIds: string[];
  corpus: CorpusBinding[];
  corpusHash: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
  status: LibraryTaskStatus;
  message: string;
  result: LibraryResearchResult | null;
  review: "unreviewed" | "accepted" | "rejected";
  reviewedAt: string | null;
}
export interface LibraryManuscript {
  id: string;
  revision: number;
  title: string;
  markdown: string;
  referenceIds: string[];
  taskIds: string[];
  style: CitationStyle;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface SavedLibrarySearch { id: string; name: string; query: string; provider: "local" | "crossref" | "openalex"; checkedAt: string | null }
export interface LibraryState {
  version: typeof LIBRARY_VERSION;
  revision: number;
  references: LibraryReference[];
  collections: LibraryCollection[];
  evidence: LibraryEvidence[];
  tasks: LibraryTask[];
  manuscripts: LibraryManuscript[];
  savedSearches: SavedLibrarySearch[];
}
export interface LibraryRepository {
  read(root: string, signal?: AbortSignal): Promise<LibraryState>;
  update<T>(root: string, change: (state: LibraryState) => T | Promise<T>, signal?: AbortSignal): Promise<T>;
}
export interface LibraryPage<T> { items: T[]; total: number; nextOffset: number | null }
export interface BibliographyImport { references: ReferenceFields[]; warnings: string[] }
export interface BibliographyCodec {
  parse(text: string, format: BibliographyFormat): BibliographyImport;
  export(references: LibraryReference[], format: BibliographyFormat): string;
  format(references: LibraryReference[], style: CitationStyle): string;
}
export interface LibraryTextPage { page: number; text: string }
export interface LibraryTextHit { referenceId: string; documentId: string; pdfSha256: string; page: number; excerpt: string }
export interface LibraryTextAccess {
  read(root: string, referenceId: string, documentId: string, page: number, signal?: AbortSignal): Promise<LibraryTextPage>;
  search(root: string, query: string, referenceIds: string[], signal?: AbortSignal): Promise<LibraryTextHit[]>;
}

export function emptyLibrary(): LibraryState {
  return { version: LIBRARY_VERSION, revision: 0, references: [], collections: [], evidence: [], tasks: [], manuscripts: [], savedSearches: [] };
}
export function emptyReferenceFields(): ReferenceFields {
  return { type: "article-journal", citekey: "", title: "", authors: [], year: null, containerTitle: "", volume: "", issue: "", pages: "", publisher: "", doi: "", isbn: "", url: "", abstract: "", language: "", tags: [], collectionIds: [], readingStatus: "inbox", screening: "unscreened", screeningReason: "", favorite: false, notes: "" };
}
export function libraryObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected a library object");
  const input = Object.fromEntries(Object.entries(value));
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !required.includes(key) && !optional.includes(key))) throw new Error("Missing or unsupported library field");
  return input;
}
export function libraryText(value: unknown, max = 4_000, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.trim() === "") || Array.from(value).some(character => { const code = character.charCodeAt(0); return (code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159); })) throw new Error("Invalid or oversized library text");
  return value;
}
export function libraryInteger(value: unknown, min = 0, max = 1_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid library integer");
  return value;
}
export function libraryId(value: unknown, prefix?: string): string {
  const id = libraryText(value, 80, false);
  if (!/^(ref|doc|ev|task|ms|col|search)-[a-f0-9]{32}$/u.test(id) || (prefix !== undefined && !id.startsWith(`${prefix}-`))) throw new Error("Invalid library identity");
  return id;
}
export function libraryStrings(value: unknown, maxItems = 100, maxLength = 256): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error("Invalid library list");
  const values = value.map(item => libraryText(item, maxLength, false));
  if (new Set(values).size !== values.length) throw new Error("Duplicate library list entry");
  return values;
}
export function libraryPath(value: unknown): string {
  const path = libraryText(value, 1_024, false);
  if (path.includes("\\") || path.includes(":") || path.startsWith("/") || path.split("/").some(part => part === "" || part === "." || part === "..") || /[?#]/u.test(path)) throw new Error("Expected a safe workspace-relative path");
  return path;
}
export function libraryPage<T>(items: T[], offset: number): LibraryPage<T> {
  libraryInteger(offset, 0, 100_000);
  const page: T[] = [];
  for (const item of items.slice(offset, offset + LIBRARY_PAGE_SIZE)) {
    const candidate = { items: [...page, item], total: items.length, nextOffset: offset + page.length + 1 < items.length ? offset + page.length + 1 : null };
    if (new TextEncoder().encode(JSON.stringify(candidate)).length > 192 * 1024) {
      if (page.length === 0) throw new Error("Library record exceeds the transport page limit");
      break;
    }
    page.push(item);
  }
  return { items: page, total: items.length, nextOffset: offset + page.length < items.length ? offset + page.length : null };
}
