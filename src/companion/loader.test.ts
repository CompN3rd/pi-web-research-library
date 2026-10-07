import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("installed-shape research-library extension discovery", () => {
  it("loads exactly the six catalog tools without source discovery or helper extensions", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-web-extension-loader-"));
    tempDirs.push(agentDir);

    const result = await discoverAndLoadExtensions([resolve("src/companion.ts")], process.cwd(), agentDir);

    expect(result.errors).toEqual([]);
    const researchExtension = result.extensions.find((extension) => extension.resolvedPath.endsWith("companion.ts"));
    expect(researchExtension).toBeDefined();
    expect(researchExtension?.commands.has("research-library")).toBe(true);
    expect([...(researchExtension?.tools.keys() ?? [])].sort()).toEqual(["catalog_search", "get_evidence", "read_passage", "resolve_citations", "search_text", "submit_result"].map(name => `research_library_native_${name}`));
    expect(researchExtension?.handlers.has("session_start")).toBe(false);
    expect(researchExtension?.handlers.has("session_shutdown")).toBe(true);
    expect(result.extensions).toHaveLength(1);
  });
});
