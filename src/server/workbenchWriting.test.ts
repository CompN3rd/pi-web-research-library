import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bibliographyCodec } from "../domain/bibliography.js";
import { syntheticReference } from "../domain/bibliography.testSupport.js";
import { emptyLibrary, type LibraryRepository, type LibraryState, type LibraryTask } from "../domain/workbench.js";
import { manuscript, page } from "../browser/workbenchClient.js";
import { WorkbenchStore } from "./workbenchStore.js";
import { reference as testReference } from "./workbench.testSupport.js";
import { LibraryWriting, manuscriptCitations } from "./workbenchWriting.js";
import { manuscriptHash, manuscriptTarget } from "./workbenchWritingFiles.js";

function previewToken(value: unknown): string {
  if (typeof value !== "object" || value === null || !("previewToken" in value) || typeof value.previewToken !== "string") throw new Error("Missing preview token");
  return value.previewToken;
}
function anyString(): unknown { return expect.any(String); }
function arrayContaining(items: unknown[]): unknown { return expect.arrayContaining(items); }
function objectContaining(item: object): unknown { return expect.objectContaining(item); }
function stringContaining(text: string): unknown { return expect.stringContaining(text); }

class MemoryWritingStore implements LibraryRepository {
  state: LibraryState = { ...emptyLibrary(), references: [syntheticReference()] };
  reads = 0;
  updates = 0;
  read(): Promise<LibraryState> { this.reads++; return Promise.resolve(structuredClone(this.state)); }
  async update<T>(_root: string, change: (state: LibraryState) => T | Promise<T>): Promise<T> {
    this.updates++;
    const next = structuredClone(this.state);
    const result = await change(next);
    this.state = next;
    return structuredClone(result);
  }
}
const id = `ms-${"b".repeat(32)}`;
const referenceId = syntheticReference().id;
const taskId = `task-${"c".repeat(32)}`;
const signal = new AbortController().signal;
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "library-writing-test-")); roots.push(root);
  const store = new MemoryWritingStore();
  const service = new LibraryWriting(store, bibliographyCodec);
  const call = (operation: string, input: unknown) => service.handle(root, operation, input, signal);
  const fields = { id, expectedRevision: 0, title: "Synthetic draft", markdown: "Evidence [@doe2020].", referenceIds: [referenceId], taskIds: [], style: "apa" };
  await call("writing.save", fields);
  return { root, store, call, fields };
}
function acceptedTask(): LibraryTask {
  return { id: taskId, revision: 2, kind: "summary", goal: "Synthetic goal", referenceIds: [referenceId], corpus: [{ referenceId, revision: 1, documentHashes: [], evidence: [] }], corpusHash: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sessionId: "synthetic-session", status: "completed", message: "", result: { markdown: "Draft", claims: [], cells: [], warnings: [] }, review: "accepted", reviewedAt: "2026-01-01T00:00:00.000Z" };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("LibraryWriting", () => {
  it("creates/retries, revision-checks edits, lists, and retains deletion tombstones", async () => {
    const { store, call, fields } = await setup();
    expect(await call("writing.save", fields)).toMatchObject({ id, revision: 1 });
    expect(store.state.manuscripts).toHaveLength(1);
    await expect(call("writing.save", { ...fields, markdown: "changed" })).rejects.toThrow(/Stale/u);
    expect(await call("writing.save", { ...fields, expectedRevision: 1, markdown: "changed" })).toMatchObject({ revision: 2 });
    expect(await call("writing.list", {})).toMatchObject({ total: 1, nextOffset: null });
    expect(await call("writing.delete", { id, expectedRevision: 2 })).toMatchObject({ revision: 3, deletedAt: anyString() });
    expect(await call("writing.delete", { id, expectedRevision: 2 })).toMatchObject({ revision: 3 });
    expect(await call("writing.list", {})).toMatchObject({ total: 0 });
    expect(await call("writing.list", { trash: true })).toMatchObject({ total: 1 });
    await expect(call("writing.save", fields)).rejects.toThrow(/Deleted/u);
  });
  it("decodes durable save responses and list pages with 101 linked references", async () => {
    const { root, fields } = await setup();
    const store = new WorkbenchStore();
    const references = Array.from({ length: 101 }, (_, index) => testReference(index + 1));
    await store.update(root, state => { state.references = references; });
    const writing = new LibraryWriting(store, bibliographyCodec);
    const saved = manuscript(await writing.handle(root, "writing.save", { ...fields, referenceIds: references.map(ref => ref.id) }, signal));
    expect(saved.referenceIds).toHaveLength(101);
    expect(page(manuscript)(await writing.handle(root, "writing.list", {}, signal)).items).toEqual([saved]);
    expect((await store.read(root)).manuscripts).toEqual([saved]);
  });
  it.each(["html", "latex"])("numbers Vancouver %s by first citation, then uncited binding order", async format => {
    const { store, call, fields } = await setup();
    const second = { ...testReference(2), title: "Second cited source", aliases: ["SecondAlias"] };
    const uncited = { ...testReference(3), title: "Uncited bound source" };
    store.state.references.push(second, uncited);
    await call("writing.save", { ...fields, expectedRevision: 1, style: "vancouver", referenceIds: [referenceId, uncited.id, second.id], markdown: "[@SecondAlias] then [@doe2020] and [@Test2]." });
    const result = await call("writing.export", { id, format });
    if (typeof result !== "object" || result === null || !("text" in result) || typeof result.text !== "string") throw new Error("Missing export");
    expect(result.text).toContain("(1) then (2) and (1).");
    expect(result.text.indexOf(second.title)).toBeLessThan(result.text.indexOf("Synthetic research"));
    expect(result.text.indexOf("Synthetic research")).toBeLessThan(result.text.indexOf(uncited.title));
    expect(await call("writing.audit", { id })).toMatchObject({ bibliography: stringContaining("1. ") });
  });
  it("saves the same edited manuscript after stale task bindings are explicitly removed", async () => {
    const { store, call, fields } = await setup();
    store.state.tasks.push(acceptedTask());
    await call("writing.save", { ...fields, expectedRevision: 1, taskIds: [taskId] });
    const reference = store.state.references[0]; if (reference === undefined) throw new Error("Missing reference");
    reference.revision++;
    const edit = { ...fields, expectedRevision: 2, markdown: "Edited source discussion [@doe2020]." };
    await expect(call("writing.save", { ...edit, taskIds: [taskId] })).rejects.toThrow(/current/u);
    expect(await call("writing.save", { ...edit, taskIds: [] })).toMatchObject({ id, revision: 3, markdown: edit.markdown, taskIds: [] });
    expect(store.state.tasks[0]?.review).toBe("accepted");
  });
  it("rejects unknown fields, oversized markdown, missing references, and cancelled work", async () => {
    const { root, store, call, fields } = await setup();
    await expect(call("writing.list", { arbitrary: true })).rejects.toThrow(/unsupported/u);
    await expect(call("writing.list", { trash: "yes" })).rejects.toThrow(/filter/u);
    await expect(call("writing.save", { ...fields, expectedRevision: 1, markdown: "x".repeat(128001) })).rejects.toThrow(/oversized/u);
    await expect(call("writing.save", { ...fields, expectedRevision: 1, referenceIds: [`ref-${"f".repeat(32)}`] })).rejects.toThrow(/unavailable/u);
    const abort = new AbortController(); abort.abort();
    await expect(new LibraryWriting(store, bibliographyCodec).handle(root, "writing.list", {}, abort.signal)).rejects.toThrow();
  });
  it("bounds the entire serialized manuscript in UTF-8 before mutating stored content", async () => {
    const { call, fields, store } = await setup();
    const before = structuredClone(store.state.manuscripts);
    await expect(call("writing.save", { ...fields, expectedRevision: 1, markdown: "é".repeat(100000) })).rejects.toThrow(/190 KiB; reduce/u);
    expect(store.state.manuscripts).toEqual(before);
    await expect(call("writing.save", { ...fields, id: `ms-${"e".repeat(32)}`, markdown: "é".repeat(100000) })).rejects.toThrow(/190 KiB; reduce/u);
    expect(store.state.manuscripts).toEqual(before);
    await call("writing.save", { ...fields, expectedRevision: 1, markdown: "é".repeat(90000) });
    expect(store.state.manuscripts[0]?.markdown).toHaveLength(90000);
  });
  it.each(["markdown", "latex", "html", "bundle"])("bounds the complete %s export to 2 MiB UTF-8", async format => {
    const { root, store } = await setup();
    const service = new LibraryWriting(store, { ...bibliographyCodec, format: () => "é".repeat(1050000) });
    await expect(service.handle(root, "writing.export", { id, format }, signal)).rejects.toThrow(/exceeds 2 MiB; reduce/u);
  });
  it("rejects oversized portable bundles including their full evidence map", async () => {
    const { call, store } = await setup();
    store.state.evidence = Array.from({ length: 150 }, (_, index) => ({ id: `ev-${index.toString(16).padStart(32, "0")}`, revision: 1, referenceId, documentId: null, pdfSha256: null, page: null, rect: null, quote: "", body: "x".repeat(16000), kind: "note", status: "open", tags: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null }));
    await expect(call("writing.export", { id, format: "bundle" })).rejects.toThrow(/exceeds 2 MiB; reduce/u);
    expect(store.state.evidence).toHaveLength(150);
  });
  it("requires accepted current task results and audits subsequent reference/evidence drift", async () => {
    const { store, call, fields } = await setup();
    store.state.tasks.push(acceptedTask());
    await call("writing.save", { ...fields, expectedRevision: 1, taskIds: [taskId] });
    const reference = store.state.references[0];
    if (reference === undefined) throw new Error("Missing test reference");
    reference.revision++;
    await expect(call("writing.save", { ...fields, expectedRevision: 2, taskIds: [taskId] })).rejects.toThrow(/current/u);
    expect(await call("writing.audit", { id })).toMatchObject({ issues: arrayContaining([objectContaining({ kind: "stale-task" })]) });
    reference.revision--;
    const task = store.state.tasks[0];
    if (task === undefined) throw new Error("Missing test task");
    task.review = "unreviewed";
    await expect(call("writing.save", { ...fields, expectedRevision: 2, taskIds: [taskId] })).rejects.toThrow(/accepted/u);
  });
  it("finds unknown/ambiguous citations and quote problems separately from human judgments", async () => {
    const { store, call, fields } = await setup();
    store.state.references.push({ ...syntheticReference(), id: `ref-${"d".repeat(32)}`, citekey: "other", aliases: ["ambiguous"] });
    const reference = store.state.references[0];
    if (reference === undefined) throw new Error("Missing reference");
    reference.aliases = ["old", "ambiguous"];
    await call("writing.save", { ...fields, expectedRevision: 1, markdown: '[@old; @missing; @ambiguous; @other]. “Unsupported quote text.”' });
    expect(await call("writing.audit", { id })).toMatchObject({ citationKeys: ["old", "missing", "ambiguous", "other"], issues: arrayContaining([objectContaining({ kind: "unknown-citation" }), objectContaining({ kind: "ambiguous-citation" }), objectContaining({ kind: "reference-mismatch" }), objectContaining({ kind: "quote-not-in-evidence" }), objectContaining({ kind: "human-review" })]) });
  });
  it("exports escaped non-executable HTML, safe LaTeX, Markdown and a portable evidence bundle", async () => {
    const { call, fields } = await setup();
    await call("writing.save", { ...fields, expectedRevision: 1, markdown: '<script>alert(1)</script> [@doe2020]. \\input{private}' });
    const html = await call("writing.export", { id, format: "html" });
    expect(html).toMatchObject({ mime: "text/html", text: stringContaining("&lt;script&gt;") });
    expect(html).toMatchObject({ text: stringContaining("(Doe, 2020)") });
    const latex = await call("writing.export", { id, format: "latex" });
    expect(latex).toMatchObject({ text: stringContaining("\\textbackslash{}input\\{private\\}") });
    expect(await call("writing.export", { id, format: "markdown" })).toMatchObject({ text: stringContaining("## References") });
    const bundle = await call("writing.export", { id, format: "bundle" });
    if (typeof bundle !== "object" || bundle === null || !("text" in bundle) || typeof bundle.text !== "string") throw new Error("Missing bundle");
    const parsed: unknown = JSON.parse(bundle.text);
    expect(parsed).toMatchObject({ manifest: { version: 1, warnings: arrayContaining([stringContaining("not accepted truth")]) }, draft: { id }, bibliography: { bibtex: stringContaining("@article"), ris: stringContaining("TY  - JOUR") }, evidence: [] });
  });
  it("previews without writes, checks hashes/revisions, backs up, atomically applies and replays", async () => {
    const { root, store, call } = await setup();
    await mkdir(join(root, "drafts"));
    const path = "drafts/paper.md";
    await writeFile(join(root, path), "old synthetic text");
    const updates = store.updates;
    const preview = await call("writing.apply.preview", { id, path });
    expect(store.updates).toBe(updates);
    expect(await readdir(join(root, "drafts"))).toEqual(["paper.md"]);
    expect(preview).toMatchObject({ expectedHash: manuscriptHash("old synthetic text"), diff: stringContaining("-old synthetic text") });
    const request = { id, expectedRevision: 1, path, expectedHash: manuscriptHash("old synthetic text"), previewToken: previewToken(preview) };
    await expect(call("writing.apply", { ...request, expectedRevision: 2 })).rejects.toThrow(/Stale/u);
    await expect(call("writing.apply", { ...request, expectedHash: "f".repeat(64) })).rejects.toThrow(/changed|stale/u);
    const result = await call("writing.apply", request);
    const backupPath = `${path}.${request.expectedHash}.backup`;
    expect(result).toMatchObject({ path, backupPath });
    expect(await readFile(join(root, backupPath), "utf8")).toBe("old synthetic text");
    expect(await readFile(join(root, path), "utf8")).toContain("## References");
    expect(await call("writing.apply", request)).toEqual(result);
    expect((await readdir(join(root, "drafts"))).filter(file => file.endsWith(".tmp"))).toEqual([]);
  });
  it("creates only explicit new files in existing directories and detects concurrent target edits", async () => {
    const { root, call } = await setup();
    const preview = await call("writing.apply.preview", { id, path: "new.md" });
    expect(preview).toMatchObject({ expectedHash: null });
    await writeFile(join(root, "new.md"), "external edit");
    await expect(call("writing.apply", { id, expectedRevision: 1, path: "new.md", expectedHash: null, previewToken: previewToken(preview) })).rejects.toThrow(/changed|stale/u);
    const other = await call("writing.apply.preview", { id, path: "other.txt" });
    await call("writing.apply", { id, expectedRevision: 1, path: "other.txt", expectedHash: null, previewToken: previewToken(other) });
    expect(await readFile(join(root, "other.txt"), "utf8")).toContain("Synthetic draft");
    await expect(call("writing.apply.preview", { id, path: "missing/new.md" })).rejects.toThrow();
  });
  it("rejects oversized/binary targets and conflicting recovery backups without changing originals", async () => {
    const { root, call } = await setup();
    await writeFile(join(root, "huge.md"), Buffer.alloc(1024 * 1024 + 1, 65));
    await expect(call("writing.apply.preview", { id, path: "huge.md" })).rejects.toThrow(/bounded/u);
    await writeFile(join(root, "binary.md"), Buffer.from([0xff]));
    await expect(call("writing.apply.preview", { id, path: "binary.md" })).rejects.toThrow();
    await writeFile(join(root, "draft.md"), "before");
    await writeFile(join(root, `draft.md.${manuscriptHash("before")}.backup`), "conflict");
    const preview = await call("writing.apply.preview", { id, path: "draft.md" });
    await expect(call("writing.apply", { id, expectedRevision: 1, path: "draft.md", expectedHash: manuscriptHash("before"), previewToken: previewToken(preview) })).rejects.toThrow(/conflicts/u);
    expect(await readFile(join(root, "draft.md"), "utf8")).toBe("before");
  });
  it("renders Pandoc citation clusters and page locators without raw tokens or redundant brackets", async () => {
    const { call, fields, store } = await setup();
    const secondId = `ref-${"d".repeat(32)}`;
    store.state.references.push({ ...syntheticReference(), id: secondId, citekey: "second", authors: ["Smith, Jane"], year: 2021 });
    await call("writing.save", { ...fields, expectedRevision: 1, markdown: "Cluster [see @doe2020, p. 3; @second].", referenceIds: [referenceId, secondId] });
    const result = await call("writing.export", { id, format: "html" });
    expect(result).toMatchObject({ text: stringContaining("see Doe, 2020, p. 3; Smith, 2021") });
    if (typeof result !== "object" || result === null || !("text" in result) || typeof result.text !== "string") throw new Error("Missing HTML");
    expect(result.text).not.toContain("@doe2020");
    expect(result.text).not.toContain("[(");
  });
  it.each(["html", "latex"])("preserves UTF-16 offsets after emoji in code when exporting %s", async format => {
    const { call, fields } = await setup();
    const prefixes = ["`😀` ", "```text\n😀 @ignored\n```\n", "~~~😀\n😀 @ignored\n~~~\n", "    😀 @ignored\n"];
    for (const [index, prefix] of prefixes.entries()) {
      const markdown = `${prefix}@doe2020.`;
      expect(manuscriptCitations(markdown)).toEqual([{ key: "doe2020", start: prefix.length, end: prefix.length + "@doe2020".length, suppressAuthor: false }]);
      await call("writing.save", { ...fields, expectedRevision: index + 1, markdown });
      const exportedPrefix = format === "latex" ? prefix.replace(/~/gu, "\\textasciitilde{}") : prefix;
      expect(await call("writing.export", { id, format })).toMatchObject({ text: stringContaining(`${exportedPrefix}Doe (2020).`) });
    }
  });
  it.each([
    { style: "apa", format: "html" }, { style: "apa", format: "latex" },
    { style: "harvard1", format: "html" }, { style: "harvard1", format: "latex" },
  ])("renders $style narrative citations and attached locators in $format", async ({ style, format }) => {
    const { call, fields } = await setup();
    await call("writing.save", { ...fields, expectedRevision: 1, style, markdown: "@doe2020 reports. @doe2020 [p. 3] explains. Compare [@doe2020]. Also -@doe2020 [pp. 3–4]." });
    expect(await call("writing.export", { id, format })).toMatchObject({ text: stringContaining("Doe (2020) reports. Doe (2020, p. 3) explains. Compare (Doe, 2020). Also (2020, pp. 3–4).") });
  });
  it("rejects hard-linked targets without changing either path", async () => {
    const { root, call } = await setup();
    await writeFile(join(root, "original.md"), "synthetic original");
    await link(join(root, "original.md"), join(root, "linked.md"));
    await expect(call("writing.apply.preview", { id, path: "linked.md" })).rejects.toThrow(/hard links/u);
    expect(await readFile(join(root, "original.md"), "utf8")).toBe("synthetic original");
  });
  it("binds distinct tab confirmations to the exact previewed bibliography", async () => {
    const { root, store, call } = await setup();
    const first = await call("writing.apply.preview", { id, path: "draft.md" });
    const reference = store.state.references[0];
    if (reference === undefined) throw new Error("Missing reference");
    reference.title = "Changed bibliography not yet approved";
    reference.revision++;
    const second = await call("writing.apply.preview", { id, path: "draft.md" });
    const request = { id, expectedRevision: 1, path: "draft.md", expectedHash: null };
    await expect(call("writing.apply", { ...request, previewToken: previewToken(first) })).rejects.toThrow(/stale/u);
    await expect(readFile(join(root, "draft.md"))).rejects.toThrow();
    await call("writing.apply", { ...request, previewToken: previewToken(second) });
    expect(await readFile(join(root, "draft.md"), "utf8")).toContain("Changed bibliography");
  });
  it("rejects symlink directory escapes", async () => {
    const { root, call } = await setup();
    const outside = await mkdtemp(join(tmpdir(), "library-writing-outside-")); roots.push(outside);
    await symlink(outside, join(root, "linked"), "junction");
    await expect(call("writing.apply.preview", { id, path: "linked/draft.md" })).rejects.toThrow(/symlinks/u);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe("manuscript citation syntax and target safety", () => {
  it("recognizes Pandoc citations/aliases outside fences, inline and indented code, and ignores emails/escapes", () => {
    const markdown = "Text [@doe2020, p. 3; -@other]. @narrative says. person@example.com \\@escaped\n```md\n@fenced\n```\n~~~\n@tilde\n~~~\n    @indented\n`@inline` and ``@otherinline``\n";
    expect(manuscriptCitations(markdown).map(token => token.key)).toEqual(["doe2020", "other", "narrative"]);
  });
  it.each(["../escape.md", "/abs.md", "C:/abs.md", "draft.js", "references.bib", "raw/paper.md", "sources/paper.txt", ".pi-web/research-library/paper.md", "draft.deleted/paper.md", "config/paper.md", "AGENTS.md", "requirements.txt", "node_modules/paper.md", "dir\\paper.md", "nul.md", "draft.md:stream", "folder./draft.md"])("rejects protected or unsafe target %s", path => {
    expect(() => manuscriptTarget(path)).toThrow();
  });
});
