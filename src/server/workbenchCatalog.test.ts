import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyReferenceFields, LIBRARY_MAX_PDF_BYTES, type BibliographyCodec, type LibraryRepository, type ReferenceFields } from "../domain/workbench.js";
import { validateLibraryReference } from "../domain/workbenchValidation.js";
import { page, reference as decodeReference } from "../browser/workbenchClient.js";
import { evidence, reference, testId } from "./workbench.testSupport.js";
import { LibraryCatalog } from "./workbenchCatalog.js";
import { WorkbenchStore } from "./workbenchStore.js";

let root = "";
const signal = new AbortController().signal;
const store = new WorkbenchStore();
let parsed: ReferenceFields[] = [];
const codec: BibliographyCodec = {
  parse: () => ({ references: structuredClone(parsed), warnings: ["Synthetic codec"] }),
  export: (refs, format) => `${format}:${refs.map(r => r.citekey).join(",")}`,
  format: () => "Synthetic formatting",
};
const catalog = new LibraryCatalog(store, codec);
const fields = (key = "Test1"): ReferenceFields => ({ ...emptyReferenceFields(), citekey: key, title: "Synthetic study", authors: ["Synthetic Author"], year: 2026 });
const call = (operation: string, input: unknown): Promise<unknown> => catalog.handle(root, operation, input, signal);
const save = async (number = 1, value = fields(), expectedRevision = 0) => validateLibraryReference(await call("library.save", { id: testId("ref", number), expectedRevision, fields: value }));
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "native-library-catalog-")); parsed = []; });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("LibraryCatalog", () => {
  it("creates idempotently, edits revisions and retains old keys as unambiguous aliases", async () => {
    const first = await save(); expect(await save()).toEqual(first); expect((await store.read(root)).revision).toBe(1);
    await expect(save(1, { ...fields(), title: "Changed" })).rejects.toThrow(/already exists/u);
    const edited = await save(1, fields("Renamed"), 1); expect(edited.aliases).toEqual(["Test1"]); expect(edited.revision).toBe(2);
    await expect(save(1, fields("Other"), 1)).rejects.toThrow(/Stale/u);
    await expect(save(2, fields("Test1"))).rejects.toThrow(/already in use/u);
    expect(await call("library.get", { id: first.id })).toEqual(edited);
    await expect(call("library.get", { id: first.id, arbitraryPath: "/secret" })).rejects.toThrow();
  });
  it("decodes durable save, get and list responses with 101 collection memberships", async () => {
    const collectionIds = Array.from({ length: 101 }, (_, index) => testId("col", index + 1));
    await store.update(root, state => {
      state.collections = collectionIds.map((id, index) => ({ id, name: `Collection ${String(index + 1)}`, parentId: null, revision: 1 }));
    });
    const response = await call("library.save", { id: testId("ref"), expectedRevision: 0, fields: { ...fields(), collectionIds } });
    const persisted = (await store.read(root)).references[0];
    expect(persisted?.collectionIds).toEqual(collectionIds);
    expect(decodeReference(response)).toEqual(persisted);
    expect(decodeReference(await call("library.get", { id: testId("ref") }))).toEqual(persisted);
    expect(page(decodeReference)(await call("library.list", {}))).toEqual({ items: [persisted], total: 1, nextOffset: null });
  });
  it("filters metadata, collections, tags, reading/screening state and favorites with deterministic pagination", async () => {
    const col = testId("col"); await call("collections.save", { id: col, expectedRevision: 0, name: "Synthetic", parentId: null });
    await store.update(root, state => {
      for (let i = 1; i <= 30; i += 1) state.references.push({ ...reference(i), title: `Study ${String(i).padStart(2, "0")}`, collectionIds: [col], tags: ["synthetic"], readingStatus: "read", screening: "included", screeningReason: "Test-only", favorite: true });
    });
    const filter = { query: "study", collectionId: col, tag: "synthetic", readingStatus: "read", screening: "included", favorite: true };
    const expectedItems: unknown = expect.arrayContaining([expect.objectContaining({ title: "Study 01" })]);
    expect(await call("library.list", filter)).toMatchObject({ total: 30, nextOffset: 25, items: expectedItems });
    expect(await call("library.list", { ...filter, offset: 25 })).toMatchObject({ total: 30, nextOffset: null });
    expect(await call("library.list", { favorite: false })).toMatchObject({ total: 0 });
    await expect(call("library.list", { offset: -1 })).rejects.toThrow();
  });
  it("caps serialized list pages as well as count", async () => {
    await store.update(root, state => { for (let i = 1; i <= 25; i += 1) state.references.push({ ...reference(i), notes: "n".repeat(32000) }); });
    const page = await call("library.list", {});
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(192 * 1024);
    expect(page).toMatchObject({ total: 25, nextOffset: 6 });
  });
  it("trashes/restores without removing PDFs and prevents conflicting restore", async () => {
    const ref = await save(); const deleted = await call("library.delete", { id: ref.id, expectedRevision: 1 });
    expect(validateLibraryReference(deleted).revision).toBe(2);
    expect(validateLibraryReference(deleted).deletedAt).toEqual(expect.any(String));
    expect(await call("library.list", {})).toMatchObject({ total: 0 });
    expect(await call("library.list", { trash: true })).toMatchObject({ total: 1 });
    await save(2, fields()); await expect(call("library.restore", { id: ref.id, expectedRevision: 2 })).rejects.toThrow(/already in use/u);
    await call("library.delete", { id: testId("ref", 2), expectedRevision: 1 });
    expect(await call("library.restore", { id: ref.id, expectedRevision: 2 })).toMatchObject({ revision: 3, deletedAt: null });
    await expect(save()).rejects.toThrow(/history/u);
  });
  it("rejects collection cycles, duplicate names and child deletion; removes membership with revision bump", async () => {
    const parent = { id: testId("col"), expectedRevision: 0, name: "Parent", parentId: null };
    expect(await call("collections.save", parent)).toEqual(await call("collections.save", parent));
    await call("collections.save", { id: testId("col", 2), expectedRevision: 0, name: "Child", parentId: parent.id });
    await expect(call("collections.save", { ...parent, expectedRevision: 1, parentId: testId("col", 2) })).rejects.toThrow(/cycle/u);
    await expect(call("collections.save", { ...parent, id: testId("col", 3), name: " parent " })).rejects.toThrow(/Duplicate/u);
    await expect(call("collections.delete", { id: parent.id, expectedRevision: 1 })).rejects.toThrow(/child/u);
    const ref = await save(1, { ...fields(), collectionIds: [testId("col", 2)] });
    expect(await call("collections.delete", { id: testId("col", 2), expectedRevision: 1 })).toEqual({ deleted: true });
    expect(await call("library.get", { id: ref.id })).toMatchObject({ collectionIds: [], revision: 2 });
    expect(await call("collections.list", {})).toHaveLength(1);
  });
  it("finds duplicate identities and merges references without active evidence while retaining historical metadata", async () => {
    const keep = await save(1, { ...fields(), doi: "10.123/synthetic", tags: ["a"], notes: "Keep note" });
    const remove = await save(2, { ...fields("Test2"), doi: "https://doi.org/10.123/synthetic", tags: ["b"], notes: "Other note" });
    await store.update(root, state => { state.evidence.push({ ...evidence(), referenceId: remove.id, deletedAt: evidence().updatedAt }); });
    expect(await call("library.duplicates", {})).toEqual({ pairs: [{ leftId: keep.id, rightId: remove.id, reason: "Same DOI" }] });
    const merged = validateLibraryReference(await call("library.merge", { keepId: keep.id, removeId: remove.id, keepRevision: 1, removeRevision: 1 }));
    expect(merged).toMatchObject({ aliases: ["Test2"], tags: ["a", "b"], provenance: [`merge:${remove.id}`], revision: 2 });
    expect(merged.notes).toContain("Other note");
    const state = await store.read(root); expect(state.evidence[0]?.referenceId).toBe(remove.id); expect(state.references[1]?.deletedAt).not.toBeNull();
    expect(state.references[1]?.notes).toBe("Other note");
    await expect(call("library.restore", { id: remove.id, expectedRevision: 2 })).rejects.toThrow(/already in use/u);
  });
  it("previews standard file imports, imports only selection and safely replays tombstoned rows", async () => {
    await save(); parsed = [fields("Test1"), fields("Test2")];
    const fingerprint: unknown = expect.stringMatching(/^[a-f0-9]{64}$/u);
    const duplicateCandidates: unknown = expect.arrayContaining([expect.objectContaining({ index: 0 })]);
    const collisionWarnings: unknown = expect.arrayContaining([expect.stringContaining("collision")]);
    expect(await call("library.import.preview", { format: "bibtex", text: "synthetic input" })).toMatchObject({ references: parsed, fingerprint, duplicateCandidates, warnings: collisionWarnings });
    const input = { format: "bibtex", text: "synthetic input", indices: [0] };
    const changedWarnings: unknown = expect.arrayContaining([expect.stringContaining("changed")]);
    expect(await call("library.import.commit", input)).toMatchObject({ added: [expect.any(String)], skipped: 0, warnings: changedWarnings });
    const state = await store.read(root); const imported = state.references[1]; if (imported === undefined) throw new Error("Missing import");
    expect(imported.citekey).toMatch(/^Test1-/u); expect(state.references).toHaveLength(2);
    await call("library.delete", { id: imported.id, expectedRevision: 1 });
    expect(await call("library.import.commit", input)).toMatchObject({ added: [], skipped: 1 });
    await expect(call("library.import.commit", { ...input, indices: [2] })).rejects.toThrow();
    await expect(call("library.import.commit", { ...input, indices: [0, 0] })).rejects.toThrow(/Repeated/u);
    expect(await call("library.export", { referenceIds: [testId("ref")], format: "ris" })).toEqual({ text: "ris:Test1", filename: "library.ris", mime: "application/x-research-info-systems" });
  });
  it("admits contained local PDFs with server-computed identity and exact retry, rejecting replacement", async () => {
    const ref = await save(); await mkdir(join(root, "raw")); const pdf = "%PDF-1.7\nSynthetic fixture only\n%%EOF\n";
    await writeFile(join(root, "raw/synthetic.pdf"), pdf);
    const input = { referenceId: ref.id, expectedRevision: 1, path: "raw/synthetic.pdf", label: "Synthetic", sourceUrl: "https://example.invalid/paper", rights: "Synthetic fixture" };
    const attached = validateLibraryReference(await call("library.attach", input));
    expect(attached.documents[0]).toMatchObject({ sha256: createHash("sha256").update(pdf).digest("hex"), size: Buffer.byteLength(pdf), path: input.path });
    expect(await call("library.attach", input)).toEqual(attached);
    await expect(call("library.attach", { ...input, sha256: "forged" })).rejects.toThrow();
    await writeFile(join(root, "raw/synthetic.pdf"), pdf.replace("fixture", "changed"));
    await expect(call("library.attach", { ...input, expectedRevision: 2 })).rejects.toThrow(/different content/u);
    await call("library.delete", { id: ref.id, expectedRevision: 2 }); expect(await readFile(join(root, "raw/synthetic.pdf"), "utf8")).toContain("changed");
  });
  it("rejects a PDF source replaced between hashing and serialized admission", async () => {
    const ref = await save(); const path = join(root, "synthetic.pdf");
    await writeFile(path, "%PDF-1.7\nSynthetic original\n%%EOF\n");
    const replacingStore: LibraryRepository = {
      read: (root, signal) => store.read(root, signal),
      update: async (root, change, signal) => {
        await writeFile(path, "%PDF-1.7\nSynthetic replacement changed size\n%%EOF\n");
        return store.update(root, change, signal);
      },
    };
    await expect(new LibraryCatalog(replacingStore, codec).handle(root, "library.attach", { referenceId: ref.id, expectedRevision: 1, path: "synthetic.pdf", label: "Synthetic", sourceUrl: "", rights: "" }, signal)).rejects.toThrow(/source changed/u);
    expect((await store.read(root)).references[0]?.documents).toEqual([]);
  });
  it("rejects oversized sparse PDFs and accepts an EOF marker crossing a read boundary", async () => {
    const ref = await save(); const input = { referenceId: ref.id, expectedRevision: 1, path: "synthetic.pdf", label: "Synthetic", sourceUrl: "", rights: "" };
    const file = await open(join(root, "synthetic.pdf"), "w");
    try { await file.truncate(LIBRARY_MAX_PDF_BYTES + 1); } finally { await file.close(); }
    await expect(call("library.attach", input)).rejects.toThrow(/bounded/u);
    const pdf = `%PDF-1.7\n${" ".repeat(65524)}%%EOF\n`;
    expect(Buffer.byteLength(pdf)).toBe(65539);
    await writeFile(join(root, "synthetic.pdf"), pdf);
    expect(validateLibraryReference(await call("library.attach", input)).documents).toHaveLength(1);
  });
  it("rejects merge document identity conflicts atomically and caps duplicate review", async () => {
    await store.update(root, state => {
      for (let i = 1; i <= 20; i += 1) state.references.push({ ...reference(i), title: "Duplicate synthetic" });
      for (const [index, ref] of state.references.slice(0, 2).entries()) ref.documents.push({ id: testId("doc"), path: `raw/${String(index)}.pdf`, sha256: String(index).repeat(64), size: 100, label: "Synthetic", sourceUrl: "", rights: "", addedAt: ref.createdAt });
    });
    const pairs = await call("library.duplicates", {});
    expect(pairs).toHaveProperty("pairs.length", 100);
    await expect(call("library.merge", { keepId: testId("ref"), removeId: testId("ref", 2), keepRevision: 1, removeRevision: 1 })).rejects.toThrow(/Conflicting document/u);
    expect((await store.read(root)).references[1]?.deletedAt).toBeNull();
  });
  it("rejects non-PDFs, traversal, junction attachments and aborted calls", async () => {
    const ref = await save(); await writeFile(join(root, "fake.pdf"), "not PDF");
    const input = { referenceId: ref.id, expectedRevision: 1, path: "fake.pdf", label: "Synthetic", sourceUrl: "", rights: "" };
    await expect(call("library.attach", input)).rejects.toThrow(/complete PDF/u);
    await expect(call("library.attach", { ...input, path: "../file.pdf" })).rejects.toThrow(/relative/u);
    await symlink(root, join(root, "link"), "junction");
    await expect(call("library.attach", { ...input, path: "link/fake.pdf" })).rejects.toThrow(/symlink/u);
    await expect(catalog.handle(root, "library.save", {}, AbortSignal.abort())).rejects.toThrow();
    await expect(call("unknown.operation", {})).rejects.toThrow(/Unsupported/u);
  });
});
