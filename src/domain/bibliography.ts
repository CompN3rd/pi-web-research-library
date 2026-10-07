import { Cite, type CSL, type CSLName } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import "@citation-js/plugin-csl";
import {
  emptyReferenceFields, libraryText, referenceTypes, LIBRARY_MAX_REFERENCES,
  type BibliographyCodec, type BibliographyFormat, type CitationStyle,
  type LibraryReference, type ReferenceFields,
} from "./workbench.js";

export const BIBLIOGRAPHY_MAX_BYTES = 4 * 1024 * 1024;
const BIBLIOGRAPHY_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
export const BIBLIOGRAPHY_LOSS_WARNING = "Portable bibliography omits native documents, evidence, collections, reading/screening state, favorites, aliases and provenance. Authors use display names; format conversion can normalize markup, name parts and dates. Verify against the source.";
const encoder = new TextEncoder();
function bounded(text: string): string {
  if (encoder.encode(text).length > BIBLIOGRAPHY_MAX_BYTES) throw new Error("Bibliography exceeds 4 MiB");
  return text;
}
function boundedExport(text: string): string {
  if (encoder.encode(text).length > BIBLIOGRAPHY_EXPORT_MAX_BYTES) throw new Error("Bibliography export exceeds 2 MiB; reduce selected references or content");
  return text;
}
export function bibliographyFormat(value: unknown): BibliographyFormat {
  if (value !== "bibtex" && value !== "ris" && value !== "csl-json") throw new Error("Unsupported bibliography format");
  return value;
}
export function citationStyle(value: unknown): CitationStyle {
  if (value !== "apa" && value !== "vancouver" && value !== "harvard1") throw new Error("Unsupported citation style");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid citation object");
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, max = 4000): string {
  if (value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return libraryText(value, max);
}
function name(value: unknown): string {
  const item = object(value);
  for (const [key, part] of Object.entries(item)) {
    if (["comma-suffix", "static-ordering"].includes(key)) {
      if (typeof part !== "boolean") throw new Error(`Invalid CSL name flag: ${key}`);
    } else libraryText(part, 256);
  }
  const literal = text(item["literal"], 256);
  if (literal !== "") return literal;
  const family = [text(item["non-dropping-particle"], 256), text(item["family"], 256)].filter(Boolean).join(" ");
  const given = [text(item["given"], 256), text(item["dropping-particle"], 256)].filter(Boolean).join(" ");
  const result = [family, given, text(item["suffix"], 256)].filter(Boolean).join(", ");
  return libraryText(result, 256, false);
}
function issuedYear(value: unknown, warnings: string[], label: string): number | null {
  if (value === undefined) return null;
  const date = object(value);
  for (const field of ["literal", "raw"]) if (date[field] !== undefined) libraryText(date[field], 4000, false);
  for (const field of ["season", "circa"]) {
    const detail = date[field];
    if (detail === undefined || (field === "circa" && typeof detail === "boolean")) continue;
    if (typeof detail === "string") libraryText(detail, 256, false);
    else if (typeof detail !== "number" || !Number.isFinite(detail)) throw new Error(`${label}: invalid issued date ${field}`);
  }
  const suppliedParts = date["date-parts"];
  if (suppliedParts === undefined && (date["literal"] !== undefined || date["raw"] !== undefined)) {
    // CSL and Citation.js retain textual dates (including BibTeX 'forthcoming')
    // without numeric parts. The native year field cannot represent those dates.
    warnings.push(`${label}: literal/raw issued date cannot be represented as a numeric year; year left empty and date text is lost. Retain the original import file.`);
    return null;
  }
  if (!Array.isArray(suppliedParts) || suppliedParts.length === 0 || suppliedParts.length > 2) throw new Error(`${label}: issued date must have date-parts or a literal/raw date`);
  const parts = suppliedParts.map(part => {
    if (!Array.isArray(part) || part.length === 0 || part.length > 3) throw new Error(`${label}: invalid date-parts`);
    const normalized = part.map((component: unknown) => {
      const numeric = typeof component === "string" && /^\d+$/u.test(component) ? Number(component) : component;
      if (typeof numeric !== "number" || !Number.isSafeInteger(numeric)) throw new Error(`${label}: invalid date-parts`);
      return numeric;
    });
    const [year, month, day] = normalized;
    if (year === undefined || year < 1 || year > 9999 || (month !== undefined && (month < 1 || month > 12)) || (day !== undefined && (day < 1 || day > 31))) throw new Error(`${label}: invalid issued date`);
    return normalized;
  });
  const first = parts[0];
  if (first?.[0] === undefined) throw new Error(`${label}: invalid year`);
  if (first.length > 1 || parts.length > 1 || Object.keys(date).length > 1) warnings.push(`${label}: only the issued year is retained; date detail is lost.`);
  return first[0];
}
const mapped = new Set(["id", "citation-key", "type", "title", "author", "issued", "container-title", "volume", "issue", "page", "publisher", "DOI", "ISBN", "URL", "abstract", "language", "keyword", "categories", "note", "_graph"]);
function toFields(value: unknown, index: number, warnings: string[]): ReferenceFields {
  const item = object(value);
  const label = `Record ${String(index + 1)}`;
  const result = emptyReferenceFields();
  const type = item["type"];
  if (typeof type !== "string" || type === "") throw new Error(`${label}: missing citation type`);
  const supported = referenceTypes.find(candidate => candidate === type);
  if (supported === undefined) warnings.push(`${label}: type ${type} mapped to manuscript.`);
  result.type = supported ?? "manuscript";
  result.title = libraryText(item["title"], 1000, false);
  const rawKey = text(item["citation-key"] ?? item["id"], 256);
  result.citekey = /^[A-Za-z0-9][A-Za-z0-9_:.+-]{0,127}$/u.test(rawKey) && !rawKey.startsWith("temp_id_") ? rawKey : `import-${String(index + 1)}`;
  if (result.citekey !== rawKey) warnings.push(`${label}: missing/unsupported citation key replaced with ${result.citekey}.`);
  if (item["author"] !== undefined) {
    const authors = item["author"];
    if (!Array.isArray(authors) || authors.length > 100) throw new Error(`${label}: invalid author list`);
    result.authors = authors.map(name);
    if (authors.some(author => Object.keys(object(author)).some(key => !["family", "given", "literal"].includes(key)))) warnings.push(`${label}: author name parts flattened; verify particles, suffixes and name flags (flags are not retained).`);
  }
  result.year = issuedYear(item["issued"], warnings, label);
  result.containerTitle = text(item["container-title"], 1000);
  result.volume = text(item["volume"], 256);
  result.issue = text(item["issue"], 256);
  result.pages = text(item["page"], 256);
  result.publisher = text(item["publisher"], 1000);
  result.doi = text(item["DOI"], 1000);
  result.isbn = text(item["ISBN"], 256);
  result.url = text(item["URL"], 4000);
  result.abstract = text(item["abstract"], 16000);
  result.language = text(item["language"], 256);
  result.notes = text(item["note"], 32000);
  const categories = item["categories"];
  if (categories !== undefined && (!Array.isArray(categories) || categories.some(tag => typeof tag !== "string"))) throw new Error(`${label}: invalid categories`);
  const tags = Array.isArray(categories) ? categories.map(tag => libraryText(tag, 256, false)) : text(item["keyword"]).split(/[,;]/u).map(tag => tag.trim()).filter(Boolean);
  if (tags.length > 100) throw new Error(`${label}: too many tags`);
  result.tags = [...new Set(tags.map(tag => libraryText(tag, 256, false)))];
  const omitted = Object.keys(item).filter(key => !mapped.has(key));
  if (omitted.length > 0) warnings.push(`${label}: unsupported fields omitted: ${omitted.join(", ")}.`);
  return result;
}

// Validate framing separately: Citation.js intentionally tolerates truncated RIS and trailing BibTeX garbage.
function validateBibtex(text: string): void {
  let i = 0;
  let records = 0;
  while (i < text.length) {
    if (/\s/u.test(text.charAt(i))) { i++; continue; }
    if (text[i] === "%") { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end + 1; continue; }
    const header = /^@([A-Za-z]+)\s*([{(])/u.exec(text.slice(i));
    if (header === null) throw new Error("Malformed BibTeX framing or trailing content");
    i += header[0].length;
    const closing = header[2] === "{" ? "}" : ")";
    let braces = closing === "}" ? 1 : 0;
    let quoted = false;
    let closed = false;
    for (; i < text.length; i++) {
      const char = text[i];
      if (char === "\\") { i++; continue; }
      if (char === '"' && braces === (closing === "}" ? 1 : 0)) quoted = !quoted;
      if (char === "{") braces++;
      if (char === "}") braces--;
      if (!quoted && ((closing === "}" && braces === 0) || (closing === ")" && braces === 0 && char === ")"))) { i++; closed = true; break; }
      if (braces < 0) throw new Error("Malformed BibTeX braces");
    }
    if (!closed || quoted) throw new Error("Truncated BibTeX record");
    if (!["comment", "preamble", "string"].includes((header[1] ?? "").toLowerCase())) records++;
    if (records > LIBRARY_MAX_REFERENCES) throw new Error("Too many bibliography records");
  }
  if (records === 0) throw new Error("No bibliography records");
}
function validateRis(text: string): void {
  let active = false;
  let count = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    const tag = /^([A-Z0-9]{2}) {2}- ?(.*)$/u.exec(line);
    if (tag === null) {
      if (active && !/^[A-Z0-9]{2}\s+[-=]/u.test(line)) continue;
      throw new Error("Malformed RIS line");
    }
    if (tag[1] === "TY") {
      if (active || tag[2]?.trim() === "") throw new Error("Malformed RIS record start");
      active = true;
    } else if (!active) throw new Error("RIS field outside a record");
    if (tag[1] === "ER") {
      if (tag[2]?.trim() !== "") throw new Error("Malformed RIS record terminator");
      active = false; count++;
    }
    if (count > LIBRARY_MAX_REFERENCES) throw new Error("Too many bibliography records");
  }
  if (active || count === 0) throw new Error("Truncated or empty RIS bibliography");
}
function authorToCsl(author: string): CSLName {
  const parts = author.split(",").map(part => part.trim());
  if (parts.length === 2 && parts[0] !== "" && parts[1] !== "") return { family: parts[0] ?? "", given: parts[1] ?? "" };
  return { literal: author };
}
export function bibliographyCsl(references: LibraryReference[]): CSL[] {
  if (references.length > LIBRARY_MAX_REFERENCES) throw new Error("Too many bibliography references");
  const keys = new Set<string>();
  return references.map(reference => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_:.+-]{0,127}$/u.test(reference.citekey) || keys.has(reference.citekey)) throw new Error("Invalid or duplicate citation key");
    keys.add(reference.citekey);
    return {
      id: reference.citekey, "citation-key": reference.citekey, type: reference.type, title: reference.title,
      author: reference.authors.map(authorToCsl),
      ...(reference.year === null ? {} : { issued: { "date-parts": [[reference.year]] } }),
      "container-title": reference.containerTitle, volume: reference.volume, issue: reference.issue,
      page: reference.pages, publisher: reference.publisher, DOI: reference.doi, ISBN: reference.isbn,
      URL: reference.url, abstract: reference.abstract, language: reference.language,
      keyword: reference.tags.join(", "), note: reference.notes,
    } satisfies CSL;
  });
}
function parse(textInput: string, format: BibliographyFormat) {
  bibliographyFormat(format);
  const source = bounded(libraryText(textInput, BIBLIOGRAPHY_MAX_BYTES, false)).replace(/^\uFEFF/u, "");
  const warnings: string[] = [];
  let records: unknown[];
  if (format === "csl-json") {
    const data: unknown = JSON.parse(source);
    if (!Array.isArray(data)) throw new Error("CSL-JSON must contain an array of records");
    records = data;
  } else {
    if (format === "bibtex") validateBibtex(source); else validateRis(source);
    records = new Cite(source, { forceType: format === "bibtex" ? "@bibtex/text" : "@ris/file", strict: true, generateGraph: false, maxChainLength: 10, target: "@csl/list+object" }).data;
    warnings.push("Standard-format conversion may omit unsupported source fields or markup; retain the original import file for fidelity.");
  }
  if (records.length === 0 || records.length > LIBRARY_MAX_REFERENCES) throw new Error("Empty or oversized bibliography");
  const keys = new Set<string>();
  const identities = new Set<string>();
  const references = records.map((record, index) => {
    const result = toFields(record, index, warnings);
    const original = result.citekey;
    let suffix = 2;
    while (keys.has(result.citekey)) result.citekey = `${original.slice(0, 118)}-${String(suffix++)}`;
    if (original !== result.citekey) warnings.push(`Duplicate key ${original} renamed to ${result.citekey}; records were not merged.`);
    keys.add(result.citekey);
    const identity = result.doi === "" ? `${result.title.toLowerCase()}|${String(result.year)}` : result.doi.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "");
    if (identities.has(identity)) warnings.push(`Possible duplicate identity for ${result.citekey}; records were retained separately.`);
    identities.add(identity);
    return result;
  });
  return { references, warnings };
}
function escapeBibtexVerbatim(value: string, literalName = false): string {
  // Citation.js intentionally bypasses escaping for URI/verbatim fields and
  // literal names. Never let their braces/backslashes become BibTeX structure.
  // URI delimiters such as percent, underscore and ampersand remain URI data.
  const characters = literalName ? /[\\{}%&#_$^~]/gu : /[\\{}]/gu;
  return value.replace(characters, character => ({
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&",
    "#": "\\#", "_": "\\_", "$": "\\$", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
  })[character] ?? character);
}
export const bibliographyCodec: BibliographyCodec = {
  parse,
  export(references, format) {
    bibliographyFormat(format);
    const data = bibliographyCsl(references);
    bounded(JSON.stringify(data));
    if (format === "csl-json") return boundedExport(JSON.stringify(data.map(item => ({ ...item, custom: { exportWarnings: [BIBLIOGRAPHY_LOSS_WARNING] } })), null, 2));
    // RIS is line-oriented: no data value may introduce a new tag/record.
    const flattened = data.map(item => {
      const normalized: unknown = JSON.parse(JSON.stringify(item, (_key, value: unknown) => typeof value === "string" ? value.replace(/[\r\n]+/gu, " ") : value));
      return normalized;
    });
    const cite = new Cite(flattened);
    if (format === "bibtex") {
      for (const item of cite.data) {
        if (item.DOI !== undefined) item.DOI = escapeBibtexVerbatim(item.DOI);
        if (item.URL !== undefined) item.URL = escapeBibtexVerbatim(item.URL);
        for (const author of item.author ?? []) if (author.literal !== undefined) author.literal = escapeBibtexVerbatim(author.literal, true);
      }
      return boundedExport(`% ${BIBLIOGRAPHY_LOSS_WARNING}\n% Line breaks in field values are flattened. BibTeX URI/literal-name escaping may remain on re-import.\n${cite.format("bibtex", { format: "text" })}`);
    }
    cite.data.forEach(item => { item.note = `${item.note ?? ""} [Export warning: ${BIBLIOGRAPHY_LOSS_WARNING} Line breaks in field values are flattened.]`; });
    // The plugin's text writer wraps every 70 characters, even inside words; its
    // object formatter preserves values. Serialize those mapped RIS tags losslessly.
    const entries = cite.format("ris", { format: "object" });
    return boundedExport(entries.map(entry => {
      const lines = [`TY  - ${String(entry["TY"])}`];
      for (const [tag, value] of Object.entries(entry)) {
        if (tag === "TY") continue;
        for (const item of Array.isArray(value) ? value : [value]) if (item !== "") lines.push(`${tag}  - ${item}`);
      }
      return [...lines, "ER  - "].join("\n");
    }).join("\n"));
  },
  format(references, style) {
    citationStyle(style);
    if (references.length === 0) return "";
    const data = bibliographyCsl(references);
    bounded(JSON.stringify(data));
    return boundedExport(new Cite(data).format("bibliography", { style, format: "text", lang: "en-US" }));
  },
};

export interface CitationSelection { key: string; suppressAuthor: boolean; prefix: string; suffix: string }
/** Uses the same CSL engine and full bibliography context for numeric ordering/disambiguation. */
export function formatCitationSelection(references: LibraryReference[], style: CitationStyle, selections: CitationSelection[], narrative = false): string {
  citationStyle(style);
  const cite = new Cite(bibliographyCsl(references));
  const citation = cite.format("citation", {
    style, format: "text", lang: "en-US",
    entry: selections.map(item => {
      const page = /^,?\s*(?:pp?\.|pages?)\s+([\d–—-]+)\s*$/iu.exec(item.suffix);
      return { id: item.key, "suppress-author": item.suppressAuthor || narrative, prefix: item.prefix, suffix: page === null ? item.suffix : "", ...(page === null ? {} : { locator: page[1] ?? "", label: "page" }) };
    }),
    citationsPre: [references.map(reference => reference.citekey)], citationsPost: [],
  });
  if (!narrative) return citation;
  const author = cite.format("citation", {
    style, format: "text", lang: "en-US", entry: selections.map(item => ({ id: item.key, "author-only": true })),
    citationsPre: [references.map(reference => reference.citekey)], citationsPost: [],
  });
  // Numeric CSL styles can legitimately have no author-only form.
  return author === "" || author === "[NO_PRINTED_FORM]" ? citation : `${author} ${citation}`;
}
export function formatCitation(references: LibraryReference[], style: CitationStyle, keys: string[], suppressAuthor = false): string {
  return formatCitationSelection(references, style, keys.map(key => ({ key, suppressAuthor, prefix: "", suffix: "" })));
}
