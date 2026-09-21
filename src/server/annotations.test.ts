import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { annotationFilePath, applyAnnotationChanges } from "../domain/annotation.js";
import { getLocalPilotAnnotation, listLocalPilotAnnotations } from "../companion/pilotCore.js";
import { AnnotationRepository } from "./annotations.js";
import { researchFixture } from "./fixture.testSupport.js";

const roots: string[] = [];
const signal = () => new AbortController().signal;
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() { const f = await researchFixture(); roots.push(f.root); return { ...f, repo: new AnnotationRepository() }; }

describe("durable annotation repository", () => {
  it("rejects internal directory aliases before acknowledging a write that readers would hide", async () => {
    const f = await fixture();
    const internal = join(f.root, "internal");
    await mkdir(internal);
    await symlink(internal, join(f.root, ".pi-web"), "junction");
    await expect(f.repo.create(f.root, f.scope, f.annotation, signal())).rejects.toThrow("symlinks");
    expect(await readdir(internal)).toEqual([]);
  });
  it("rejects impossible calendar dates consistently with the companion", async () => {
    const f = await fixture();
    const date = "2026-02-30T00:00:00.000Z";
    await expect(f.repo.create(f.root, f.scope, { ...f.annotation, createdAt: date, updatedAt: date }, signal())).rejects.toThrow("canonical ISO");
  });
  it("publishes complete create-only records and reconciles identical retries", async () => {
    const f = await fixture();
    const results = await Promise.all([1, 2].map(() => f.repo.create(f.root, f.scope, f.annotation, signal())));
    expect(results).toEqual([f.annotation, f.annotation]);
    const file = join(f.root, annotationFilePath(f.scope.paperId, f.annotation.id));
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(f.annotation);
    expect(await readdir(dirname(file))).toEqual([`${f.annotation.id}.json`]);
    await expect(f.repo.create(f.root, f.scope, { ...f.annotation, body: "different" }, signal())).rejects.toThrow("different content");
  });
  it("serializes competing revisions, rejects stale deletion and retries the accepted edit", async () => {
    const f = await fixture();
    await f.repo.create(f.root, f.scope, f.annotation, signal());
    const one = applyAnnotationChanges(f.annotation, { body: "one" });
    const two = applyAnnotationChanges(f.annotation, { body: "two" });
    const results = await Promise.allSettled([one, two].map((updated) => f.repo.update(f.root, f.scope, f.annotation, updated, signal())));
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    await expect(f.repo.delete(f.root, f.scope, f.annotation, signal())).rejects.toThrow("changed elsewhere");
    expect(await f.repo.update(f.root, f.scope, f.annotation, one, signal())).toEqual(one);
    expect((await f.repo.list(f.root, f.scope, 0, signal())).annotations).toEqual([one]);
  });
  it("soft-deletes atomically, preserves read-tool compatibility and prevents resurrection", async () => {
    const f = await fixture();
    await f.repo.create(f.root, f.scope, f.annotation, signal());
    expect((await getLocalPilotAnnotation(f.root, f.scope.paperId, f.annotation.id)).annotation.body).toBe("Why?");
    await f.repo.delete(f.root, f.scope, f.annotation, signal());
    expect(await f.repo.delete(f.root, f.scope, f.annotation, signal())).toEqual({ deleted: true });
    expect((await f.repo.list(f.root, f.scope, 0, signal())).annotations).toEqual([]);
    expect((await listLocalPilotAnnotations(f.root, { paperId: f.scope.paperId })).annotations).toEqual([]);
    await expect(f.repo.create(f.root, f.scope, f.annotation, signal())).rejects.toThrow("deleted");
    const path = join(f.root, annotationFilePath(f.scope.paperId, f.annotation.id)).replace(/\.json$/u, ".deleted");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(f.annotation);
  });
  it("rejects foreign scopes, mutable anchors and changed manifests", async () => {
    const f = await fixture();
    await expect(f.repo.create(f.root, { ...f.scope, libraryId: "pilot-foreign" }, f.annotation, signal())).rejects.toThrow();
    await f.repo.create(f.root, f.scope, f.annotation, signal());
    const after = applyAnnotationChanges(f.annotation, { body: "new" });
    await expect(f.repo.update(f.root, f.scope, f.annotation, { ...after, page: 2 }, signal())).rejects.toThrow("anchor");
    await writeFile(f.manifestPath, JSON.stringify({ ...f.manifest, libraryId: "pilot-foreign" }));
    await expect(f.repo.update(f.root, f.scope, f.annotation, after, signal())).rejects.toThrow("no longer matches");
  });
  it("does not acknowledge ambiguous active/recovery records as deleted", async () => {
    const f = await fixture();
    await f.repo.create(f.root, f.scope, f.annotation, signal());
    const file = join(f.root, annotationFilePath(f.scope.paperId, f.annotation.id));
    await writeFile(file.replace(/\.json$/u, ".deleted"), JSON.stringify(f.annotation));
    await expect(f.repo.delete(f.root, f.scope, f.annotation, signal())).rejects.toThrow("Conflicting active");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(f.annotation);
  });
  it("bounds reads and rejects annotation symlinks rather than exposing other files", async () => {
    const f = await fixture();
    await f.repo.create(f.root, f.scope, f.annotation, signal());
    const file = join(f.root, annotationFilePath(f.scope.paperId, f.annotation.id));
    await writeFile(file, "x".repeat(32 * 1024 + 1));
    expect((await f.repo.list(f.root, f.scope, 0, signal())).warnings[0]).toContain("bounded");
    await rm(file);
    await symlink(f.manifestPath, file);
    expect((await f.repo.list(f.root, f.scope, 0, signal())).warnings[0]).toContain("symlink");
  });
  it("honors cancellation before publication and does not leave temporary files", async () => {
    const f = await fixture();
    const controller = new AbortController(); controller.abort();
    await expect(f.repo.create(f.root, f.scope, f.annotation, controller.signal)).rejects.toThrow();
    await f.repo.create(f.root, f.scope, f.annotation, signal());
    await expect(f.repo.update(f.root, f.scope, f.annotation, applyAnnotationChanges(f.annotation, { body: "changed" }), controller.signal)).rejects.toThrow();
    const file = join(f.root, annotationFilePath(f.scope.paperId, f.annotation.id));
    expect(await readdir(dirname(file))).toEqual([`${f.annotation.id}.json`]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(f.annotation);
  });
});
