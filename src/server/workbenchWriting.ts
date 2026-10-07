import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { BIBLIOGRAPHY_LOSS_WARNING, citationStyle, formatCitationSelection, type CitationSelection } from "../domain/bibliography.js";
import {
  LIBRARY_MAX_MANUSCRIPTS, libraryId, libraryInteger, libraryObject, libraryPage, libraryStrings, libraryText,
  type BibliographyCodec, type LibraryManuscript, type LibraryReference, type LibraryRepository, type LibraryState, type LibraryTask,
} from "../domain/workbench.js";
import { applyManuscriptFile, manuscriptHash, manuscriptTarget, previewManuscriptFile } from "./workbenchWritingFiles.js";

const MANUSCRIPT_MAX_ENTITY_BYTES = 190 * 1024;
function checkManuscriptSize(manuscript: LibraryManuscript): void {
  if (Buffer.byteLength(JSON.stringify(manuscript), "utf8") > MANUSCRIPT_MAX_ENTITY_BYTES) throw new Error("Manuscript record exceeds 190 KiB; reduce content or linked references/tasks");
}
const DRAFT_WARNING = "Draft — not accepted truth. Citations and automated checks do not establish claim accuracy; verify sources, quotes, and permissions before publication.";
interface CitationToken { start: number; end: number; key: string; suppressAuthor: boolean }
interface AuditIssue { kind: string; message: string; key?: string }
function maskedCharacters(text: string): string {
  // Offsets are applied to the original UTF-16 string, including surrogate pairs.
  return text.replace(/[^\n]/gu, character => " ".repeat(character.length));
}
function maskedCode(markdown: string): string {
  let fence: { character: string; length: number } | null = null;
  const lines = markdown.split(/(?<=\n)/u).map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== null) {
      if (marker?.startsWith(fence.character) === true && marker.length >= fence.length && line.slice(line.indexOf(marker) + marker.length).trim() === "") fence = null;
      return maskedCharacters(line);
    }
    if (marker !== undefined) { fence = { character: marker[0] ?? "", length: marker.length }; return maskedCharacters(line); }
    if (/^(?: {4}|\t)/u.test(line)) return maskedCharacters(line);
    return line;
  }).join("");
  // Match equal-length backtick delimiters without treating an unclosed tick as code.
  return lines.replace(/(`+)([\s\S]*?)\1(?!`)/gu, maskedCharacters);
}
export function manuscriptCitations(markdown: string): CitationToken[] {
  const source = maskedCode(markdown);
  const tokens: CitationToken[] = [];
  const pattern = /(^|[^\p{L}\p{N}_@\\])(-?@)([A-Za-z0-9][A-Za-z0-9_:.+-]*)/gmu;
  for (const match of source.matchAll(pattern)) {
    const key = (match[3] ?? "").replace(/[.:+-]+$/u, "");
    if (key === "") continue;
    const start = match.index + (match[1]?.length ?? 0);
    tokens.push({ start, end: start + (match[2]?.length ?? 0) + key.length, key, suppressAuthor: match[2] === "-@" });
    if (tokens.length > 2000) throw new Error("Manuscript exceeds 2000 citation occurrences");
  }
  return tokens;
}
function activeManuscript(state: LibraryState, id: string): LibraryManuscript {
  const manuscript = state.manuscripts.find(item => item.id === id && item.deletedAt === null);
  if (manuscript === undefined) throw new Error("Manuscript not found or deleted");
  return manuscript;
}
function checkRevision(manuscript: LibraryManuscript, expected: number): void {
  if (manuscript.revision !== expected) throw new Error("Stale manuscript revision; reload before editing");
}
function taskProblems(state: LibraryState, task: LibraryTask): string[] {
  const problems: string[] = [];
  if (task.review !== "accepted" || task.status !== "completed" || task.result === null) problems.push("task has no accepted completed result");
  for (const binding of task.corpus) {
    const reference = state.references.find(item => item.id === binding.referenceId && item.deletedAt === null);
    if (reference?.revision !== binding.revision || JSON.stringify(reference.documents.map(doc => doc.sha256).sort()) !== JSON.stringify([...binding.documentHashes].sort())) problems.push(`reference ${binding.referenceId} changed or was deleted`);
    const currentEvidenceIds = state.evidence.filter(item => item.referenceId === binding.referenceId && item.deletedAt === null).map(item => item.id).sort();
    if (JSON.stringify(currentEvidenceIds) !== JSON.stringify(binding.evidence.map(item => item.id).sort())) problems.push(`evidence corpus for ${binding.referenceId} changed`);
    for (const frozen of binding.evidence) {
      const evidence = state.evidence.find(item => item.id === frozen.id && item.deletedAt === null);
      if (evidence?.revision !== frozen.revision) problems.push(`evidence ${frozen.id} changed or was deleted`);
    }
  }
  return problems;
}
function resolveKey(state: LibraryState, key: string): LibraryReference[] {
  return state.references.filter(reference => reference.deletedAt === null && (reference.citekey === key || reference.aliases.includes(key)));
}
function linkedReferences(state: LibraryState, manuscript: LibraryManuscript): LibraryReference[] {
  return manuscript.referenceIds.map(id => {
    const reference = state.references.find(item => item.id === id && item.deletedAt === null);
    if (reference === undefined) throw new Error(`Linked reference ${id} is unavailable; audit and repair the manuscript`);
    return reference;
  });
}
/** Cited sources lead in first-occurrence order; uncited bindings follow in binding order. */
function citationOrderedReferences(state: LibraryState, manuscript: LibraryManuscript, references: LibraryReference[]): LibraryReference[] {
  const ordered = new Map<string, LibraryReference>();
  const linked = new Set(references.map(reference => reference.id));
  for (const token of manuscriptCitations(manuscript.markdown)) {
    const matches = resolveKey(state, token.key);
    const reference = matches[0];
    if (matches.length === 1 && reference !== undefined && linked.has(reference.id)) ordered.set(reference.id, reference);
  }
  for (const reference of references) if (!ordered.has(reference.id)) ordered.set(reference.id, reference);
  return [...ordered.values()];
}
function audit(state: LibraryState, manuscript: LibraryManuscript, codec: BibliographyCodec) {
  const issues: AuditIssue[] = [];
  const keys = [...new Set(manuscriptCitations(manuscript.markdown).map(token => token.key))];
  const used = new Set<string>();
  for (const key of keys) {
    const matches = resolveKey(state, key);
    if (matches.length === 0) issues.push({ kind: "unknown-citation", message: `Unknown citation key: ${key}`, key });
    else if (matches.length > 1) issues.push({ kind: "ambiguous-citation", message: `Citation key identifies multiple references: ${key}`, key });
    else {
      const reference = matches[0];
      if (reference !== undefined) {
        used.add(reference.id);
        if (!manuscript.referenceIds.includes(reference.id)) issues.push({ kind: "reference-mismatch", message: `Cited reference is not linked to manuscript: ${key}`, key });
      }
    }
  }
  const available: LibraryReference[] = [];
  for (const id of manuscript.referenceIds) {
    const reference = state.references.find(item => item.id === id && item.deletedAt === null);
    if (reference === undefined) issues.push({ kind: "missing-reference", message: `Linked reference ${id} is missing or deleted` });
    else {
      available.push(reference);
      if (!used.has(id)) issues.push({ kind: "uncited-reference", message: `Linked reference ${reference.citekey} is not cited`, key: reference.citekey });
    }
  }
  for (const id of manuscript.taskIds) {
    const task = state.tasks.find(item => item.id === id);
    if (task === undefined) issues.push({ kind: "missing-task", message: `Linked task ${id} is missing` });
    else {
      for (const problem of taskProblems(state, task)) issues.push({ kind: "stale-task", message: `${id}: ${problem}` });
      for (const referenceId of task.referenceIds) if (!manuscript.referenceIds.includes(referenceId)) issues.push({ kind: "task-reference-mismatch", message: `${id}: corpus reference ${referenceId} is not linked` });
    }
  }
  for (const evidence of state.evidence.filter(item => manuscript.referenceIds.includes(item.referenceId) && item.deletedAt === null)) {
    if (evidence.documentId !== null) {
      const doc = state.references.find(item => item.id === evidence.referenceId)?.documents.find(item => item.id === evidence.documentId);
      if (doc?.sha256 !== evidence.pdfSha256) issues.push({ kind: "stale-evidence", message: `Evidence ${evidence.id} no longer matches its source PDF` });
    }
    if (evidence.kind === "quote" && (evidence.quote.trim() === "" || evidence.page === null || evidence.documentId === null)) issues.push({ kind: "unanchored-quote", message: `Quote ${evidence.id} has no complete source/page anchor` });
  }
  const visible = maskedCode(manuscript.markdown);
  for (const match of visible.matchAll(/[“"]([^”"\n]{8,})[”"]/gu)) {
    const quote = match[1] ?? "";
    const supported = state.evidence.some(item => item.deletedAt === null && manuscript.referenceIds.includes(item.referenceId) && item.quote.includes(quote));
    if (!supported) issues.push({ kind: "quote-not-in-evidence", message: `Quoted text has no exact linked evidence match: ${quote.slice(0, 160)}` });
  }
  issues.push({ kind: "human-review", message: "Deterministic checks cannot establish entailment, quote accuracy against the PDF, complete citation coverage, or permissions. Review these manually." });
  return { issues, citationKeys: keys, bibliography: codec.format(citationOrderedReferences(state, manuscript, available), manuscript.style) };
}
function escapeHtml(text: string): string { return text.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#_%~^]/gu, char => ({ "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "$": "\\$", "&": "\\&", "#": "\\#", "_": "\\_", "%": "\\%", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[char] ?? char);
}
function renderedCitations(state: LibraryState, manuscript: LibraryManuscript, references: LibraryReference[]): string {
  const tokens = manuscriptCitations(manuscript.markdown);
  const syntax = maskedCode(manuscript.markdown);
  let output = "";
  let start = 0;
  const rendered = new Map<string, string>();
  for (const token of tokens) {
    if (token.start < start) continue;
    const opening = syntax.lastIndexOf("[", token.start);
    const closing = syntax.indexOf("]", token.end);
    const cluster = opening >= start && closing >= token.end && !/[[\]\n]/u.test(syntax.slice(opening + 1, closing));
    const locator = cluster ? null : /^[ \t]+\[((?:pp?\.|pages?)\s+[\d–—-]+)\]/iu.exec(syntax.slice(token.end));
    const narrative = !cluster && !token.suppressAuthor;
    const group = cluster ? tokens.filter(item => item.start > opening && item.end <= closing) : [token];
    const groupStart = cluster ? opening : token.start;
    const groupEnd = cluster ? closing + 1 : token.end + (locator?.[0].length ?? 0);
    const selections: CitationSelection[] = group.map((item, index) => {
      const matches = resolveKey(state, item.key);
      const reference = matches[0];
      if (matches.length !== 1 || reference === undefined || !manuscript.referenceIds.includes(reference.id)) throw new Error(`Cannot export unresolved/unlinked citation ${item.key}; audit and repair first`);
      const previous = group[index - 1];
      const next = group[index + 1];
      const before = manuscript.markdown.slice(previous?.end ?? groupStart + 1, item.start);
      const after = manuscript.markdown.slice(item.end, next?.start ?? groupEnd - 1);
      return {
        key: reference.citekey, suppressAuthor: item.suppressAuthor,
        prefix: cluster ? (previous === undefined ? before : before.slice(before.indexOf(";") + 1)).trim() : "",
        suffix: cluster ? (next === undefined ? after : after.slice(0, !after.includes(";") ? after.length : after.indexOf(";"))).trim() : locator?.[1] ?? "",
      };
    });
    output += manuscript.markdown.slice(start, groupStart);
    const cacheKey = JSON.stringify({ selections, narrative });
    let citation = rendered.get(cacheKey);
    if (citation === undefined) {
      citation = formatCitationSelection(references, manuscript.style, selections, narrative);
      rendered.set(cacheKey, citation);
    }
    output += citation;
    start = groupEnd;
  }
  return output + manuscript.markdown.slice(start);
}
function exportManuscript(state: LibraryState, manuscript: LibraryManuscript, format: unknown, codec: BibliographyCodec) {
  const references = citationOrderedReferences(state, manuscript, linkedReferences(state, manuscript));
  const bibliography = codec.format(references, manuscript.style);
  let text: string;
  let extension: string;
  let mime: string;
  switch (format) {
    case "markdown":
      text = `> ${DRAFT_WARNING}\n\n# ${manuscript.title.replace(/[\r\n]/gu, " ")}\n\n${manuscript.markdown}\n\n## References\n\n${bibliography}`;
      extension = "md"; mime = "text/markdown"; break;
    case "html":
      text = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'"><title>${escapeHtml(manuscript.title)}</title></head><body><p>${escapeHtml(DRAFT_WARNING)}</p><h1>${escapeHtml(manuscript.title)}</h1><pre>${escapeHtml(renderedCitations(state, manuscript, references))}</pre><h2>References</h2><pre>${escapeHtml(bibliography)}</pre></body></html>`;
      extension = "html"; mime = "text/html"; break;
    case "latex":
      text = `\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\begin{document}\n\\section*{${escapeLatex(manuscript.title)}}\n${escapeLatex(DRAFT_WARNING)}\n\n${escapeLatex(renderedCitations(state, manuscript, references))}\n\n\\section*{References}\n${escapeLatex(bibliography)}\n\\end{document}\n`;
      extension = "tex"; mime = "application/x-tex"; break;
    case "bundle":
      text = JSON.stringify({
        manifest: { version: 1, kind: "research-library-manuscript", manuscriptId: manuscript.id, revision: manuscript.revision, warnings: [DRAFT_WARNING, BIBLIOGRAPHY_LOSS_WARNING, "PDF files are not embedded. Document paths are workspace-relative provenance, not portable attachments."] },
        draft: manuscript,
        bibliography: { rendered: bibliography, bibtex: codec.export(references, "bibtex"), ris: codec.export(references, "ris"), cslJson: codec.export(references, "csl-json") },
        references,
        evidence: state.evidence.filter(item => manuscript.referenceIds.includes(item.referenceId)),
        tasks: state.tasks.filter(item => manuscript.taskIds.includes(item.id)),
        audit: audit(state, manuscript, codec),
      }, null, 2);
      extension = "json"; mime = "application/json"; break;
    default: throw new Error("Unsupported manuscript export format");
  }
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new Error("Manuscript export exceeds 2 MiB; reduce selected references or content");
  return { text, filename: `${manuscript.id}.${extension}`, mime };
}

interface ApplyPreviewReceipt {
  root: string; id: string; path: string; revision: number; expectedHash: string | null; textHash: string; expiresAt: number;
}

export class LibraryWriting {
  private readonly previews = new Map<string, ApplyPreviewReceipt>();
  constructor(private readonly store: LibraryRepository, private readonly codec: BibliographyCodec) {}
  async handle(root: string, operation: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    switch (operation) {
      case "writing.list": {
        const args = libraryObject(input, [], ["offset", "trash"]);
        const offset = libraryInteger(args["offset"] ?? 0);
        if (args["trash"] !== undefined && typeof args["trash"] !== "boolean") throw new Error("Invalid trash filter");
        const state = await this.store.read(root, signal);
        const manuscripts = state.manuscripts.filter(item => (item.deletedAt !== null) === (args["trash"] === true)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        return libraryPage(manuscripts, offset);
      }
      case "writing.save": {
        const args = libraryObject(input, ["id", "expectedRevision", "title", "markdown", "referenceIds", "taskIds", "style"]);
        const id = libraryId(args["id"], "ms");
        const expected = libraryInteger(args["expectedRevision"]);
        const fields = {
          title: libraryText(args["title"], 1000, false), markdown: libraryText(args["markdown"], 128000),
          referenceIds: libraryStrings(args["referenceIds"], 5000, 80).map(value => libraryId(value, "ref")),
          taskIds: libraryStrings(args["taskIds"], 200, 80).map(value => libraryId(value, "task")), style: citationStyle(args["style"]),
        };
        return this.store.update(root, state => {
          const existing = state.manuscripts.find(item => item.id === id);
          if (existing !== undefined) {
            if (existing.deletedAt !== null) throw new Error("Deleted manuscript identities cannot be reused");
            if (expected === 0 && existing.revision === 1 && Object.entries(fields).every(([key, value]) => JSON.stringify(Reflect.get(existing, key)) === JSON.stringify(value))) return existing;
            checkRevision(existing, expected);
          } else if (expected !== 0) throw new Error("Manuscript not found");
          for (const referenceId of fields.referenceIds) if (!state.references.some(item => item.id === referenceId && item.deletedAt === null)) throw new Error(`Reference ${referenceId} is unavailable`);
          for (const taskId of fields.taskIds) {
            const task = state.tasks.find(item => item.id === taskId);
            if (task === undefined || taskProblems(state, task).length > 0) throw new Error(`Task ${taskId} must have an accepted current result`);
            if (task.referenceIds.some(referenceId => !fields.referenceIds.includes(referenceId))) throw new Error(`Task ${taskId} corpus must be linked to manuscript`);
          }
          if (existing === undefined && state.manuscripts.length >= LIBRARY_MAX_MANUSCRIPTS) throw new Error("Manuscript limit reached (including recovery tombstones)");
          const now = new Date().toISOString();
          const manuscript: LibraryManuscript = { id, ...fields, revision: (existing?.revision ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null };
          checkManuscriptSize(manuscript);
          if (existing !== undefined) { Object.assign(existing, manuscript); return existing; }
          state.manuscripts.push(manuscript);
          return manuscript;
        }, signal);
      }
      case "writing.delete": {
        const args = libraryObject(input, ["id", "expectedRevision"]);
        const id = libraryId(args["id"], "ms");
        const expected = libraryInteger(args["expectedRevision"], 1);
        return this.store.update(root, state => {
          const manuscript = state.manuscripts.find(item => item.id === id);
          if (manuscript === undefined) throw new Error("Manuscript not found");
          if (manuscript.deletedAt !== null && manuscript.revision === expected + 1) return manuscript;
          checkRevision(manuscript, expected);
          if (manuscript.deletedAt !== null) throw new Error("Manuscript already deleted");
          const deletedAt = new Date().toISOString();
          const deleted = { ...manuscript, deletedAt, updatedAt: deletedAt, revision: manuscript.revision + 1 };
          checkManuscriptSize(deleted);
          Object.assign(manuscript, deleted);
          return manuscript;
        }, signal);
      }
      case "writing.audit": {
        const args = libraryObject(input, ["id"]);
        const state = await this.store.read(root, signal);
        return audit(state, activeManuscript(state, libraryId(args["id"], "ms")), this.codec);
      }
      case "writing.export": {
        const args = libraryObject(input, ["id", "format"]);
        const state = await this.store.read(root, signal);
        return exportManuscript(state, activeManuscript(state, libraryId(args["id"], "ms")), args["format"], this.codec);
      }
      case "writing.apply.preview": {
        const args = libraryObject(input, ["id", "path"]);
        const state = await this.store.read(root, signal);
        const manuscript = activeManuscript(state, libraryId(args["id"], "ms"));
        const path = manuscriptTarget(args["path"]);
        const canonicalRoot = await realpath(root);
        const preview = await previewManuscriptFile(canonicalRoot, path, exportManuscript(state, manuscript, "markdown", this.codec).text, signal);
        const now = Date.now();
        for (const [token, receipt] of this.previews) if (receipt.expiresAt <= now) this.previews.delete(token);
        if (this.previews.size >= 100) throw new Error("Too many pending apply previews; wait for expiry or apply an existing preview");
        const previewToken = randomBytes(16).toString("hex");
        this.previews.set(previewToken, { root: canonicalRoot, id: manuscript.id, path, revision: manuscript.revision, expectedHash: preview.expectedHash, textHash: manuscriptHash(preview.text), expiresAt: now + 15 * 60 * 1000 });
        return { ...preview, previewToken };
      }
      case "writing.apply": {
        const args = libraryObject(input, ["id", "expectedRevision", "path", "expectedHash", "previewToken"]);
        const id = libraryId(args["id"], "ms");
        const expected = libraryInteger(args["expectedRevision"], 1);
        const path = manuscriptTarget(args["path"]);
        const hash = args["expectedHash"] === null ? null : libraryText(args["expectedHash"], 64, false);
        if (hash !== null && !/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid manuscript preview hash");
        const previewToken = libraryText(args["previewToken"], 32, false);
        if (!/^[a-f0-9]{32}$/u.test(previewToken)) throw new Error("Invalid apply preview token");
        const canonicalRoot = await realpath(root);
        // The repository queue also serializes revision checks against saves/deletes during publication.
        return this.store.update(root, async state => {
          const manuscript = activeManuscript(state, id);
          checkRevision(manuscript, expected);
          const text = exportManuscript(state, manuscript, "markdown", this.codec).text;
          const receipt = this.previews.get(previewToken);
          const current = await previewManuscriptFile(canonicalRoot, path, text, signal);
          // A lost/consumed receipt can only authorize a no-write, exact-output replay.
          if (current.expectedHash !== manuscriptHash(text) && (receipt === undefined || receipt.expiresAt <= Date.now() || receipt.root !== canonicalRoot || receipt.id !== id || receipt.path !== path || receipt.revision !== expected || receipt.expectedHash !== hash || receipt.textHash !== manuscriptHash(text))) throw new Error("Apply preview is missing, expired, or stale; preview and confirm again");
          const result = await applyManuscriptFile(canonicalRoot, path, hash, text, signal);
          this.previews.delete(previewToken);
          return result;
        }, signal);
      }
      default: throw new Error(`Unsupported writing operation: ${operation}`);
    }
  }
}
