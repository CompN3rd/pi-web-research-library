import { describe, expect, it } from "vitest";
import { plugins } from "@citation-js/core";
import { bibliographyCodec, formatCitation } from "./bibliography.js";
import { syntheticReference } from "./bibliography.testSupport.js";


const bib = "@article{doe2020, title={Synthetic research}, author={Doe, Jane}, year={2020}, journal={Synthetic Journal}, volume={3}, pages={12--19}, doi={10.0000/synthetic}}";
const ris = "TY  - JOUR\nID  - doe2020\nTI  - Synthetic research\nAU  - Doe, Jane\nPY  - 2020\nJO  - Synthetic Journal\nER  -\n";

describe("bibliographyCodec", () => {
  it("parses real BibTeX/RIS/CSL-JSON with bounded normalized metadata", () => {
    for (const result of [bibliographyCodec.parse(bib, "bibtex"), bibliographyCodec.parse(ris, "ris"), bibliographyCodec.parse(bibliographyCodec.export([syntheticReference()], "csl-json"), "csl-json")]) {
      expect(result.references[0]).toMatchObject({ title: "Synthetic research", authors: ["Doe, Jane"], year: 2020, containerTitle: "Synthetic Journal" });
    }
  });
  it("supports BibTeX braces, escaped characters, strings, and comments through the parser", () => {
    const result = bibliographyCodec.parse('% synthetic\n@string{j = "Synthetic Journal"}\n@article{x,title={A {Nested} title},journal=j,author={Doe, Jane},year={2020}}', "bibtex");
    expect(result.references[0]?.containerTitle).toBe("Synthetic Journal");
    expect(result.references[0]?.title).toContain("Nested");
  });
  it.each(["@article{x,title={Oops}", "@article{x,title={Title}} garbage", "plain text", "@comment{hello}"])("rejects malformed/empty BibTeX %s", text => {
    expect(() => bibliographyCodec.parse(text, "bibtex")).toThrow();
  });
  it.each(["TY  - JOUR\nTI  - Unclosed", "TI  - Outside\nER  -", "TY  - JOUR\nTY  - BOOK\nER  -", "TY  - JOUR\nTI = Broken\nER  -"])("rejects malformed RIS %s", text => {
    expect(() => bibliographyCodec.parse(text, "ris")).toThrow();
  });
  it.each([
    {}, [], [{ id: "x", type: "book", title: 12 }], [{ id: "x", type: "book", title: "x", author: "Doe" }],
    [{ id: "x", type: "book", title: "x", issued: { "date-parts": [[2020, 19]] } }],
    [{ id: "x", type: "book", title: "x", categories: [3] }],
  ])("rejects malformed CSL without silent conversion", value => {
    expect(() => bibliographyCodec.parse(JSON.stringify(value), "csl-json")).toThrow();
  });
  it("imports boolean CSL name flags with an explicit flattening warning", () => {
    const result = bibliographyCodec.parse(JSON.stringify([{ id: "flagged", type: "book", title: "Flagged name", author: [{ family: "Doe", given: "Jane", suffix: "Jr.", "comma-suffix": true, "static-ordering": true }] }]), "csl-json");
    expect(result.references[0]?.authors).toEqual(["Doe, Jane, Jr."]);
    expect(result.warnings.join(" ")).toContain("flags are not retained");
  });
  it.each([{ family: true }, { family: "Doe", "comma-suffix": "true" }, { family: "Doe", "static-ordering": 1 }])("rejects malformed CSL name parts/flags %j", author => {
    expect(() => bibliographyCodec.parse(JSON.stringify([{ id: "bad", type: "book", title: "Bad name", author: [author] }]), "csl-json")).toThrow();
  });
  it("normalizes valid numeric-string CSL date parts", () => {
    const result = bibliographyCodec.parse(JSON.stringify([{ id: "dated", type: "book", title: "Synthetic date", issued: { "date-parts": [["2020", "02", "29"]] } }]), "csl-json");
    expect(result.references[0]?.year).toBe(2020);
    expect(result.warnings.join(" ")).toContain("date detail is lost");
    const yearOnly = bibliographyCodec.parse(JSON.stringify([{ id: "dated", type: "book", title: "Synthetic date", issued: { "date-parts": [["2020"]] } }]), "csl-json");
    expect(yearOnly.references[0]?.year).toBe(2020);
  });
  it.each([{ literal: "forthcoming" }, { raw: "Spring 2020" }])("retains references with textual dates and explicitly warns about date loss", issued => {
    const result = bibliographyCodec.parse(JSON.stringify([{ id: "dated", type: "book", title: "Synthetic date", issued }]), "csl-json");
    expect(result.references[0]).toMatchObject({ title: "Synthetic date", year: null });
    expect(result.warnings.join(" ")).toContain("date text is lost");
  });
  it("imports valid BibTeX forthcoming dates without aborting other records", () => {
    const result = bibliographyCodec.parse(`${bib}\n@book{future,title={Synthetic forthcoming},year={forthcoming}}`, "bibtex");
    expect(result.references).toHaveLength(2);
    expect(result.references[1]).toMatchObject({ title: "Synthetic forthcoming", year: null });
    expect(result.warnings.join(" ")).toContain("date text is lost");
  });
  it.each([
    { "date-parts": [["202x"]] }, { "date-parts": [["2020", "19"]] }, { "date-parts": [[2020, {}]] },
    { "date-parts": null, literal: "forthcoming" }, { literal: 2020 }, { raw: {} }, { literal: "" }, {},
    { literal: "forthcoming", circa: {} }, { "date-parts": [[2020]], season: [] },
  ])("continues rejecting malformed date objects", issued => {
    expect(() => bibliographyCodec.parse(JSON.stringify([{ id: "dated", type: "book", title: "Synthetic date", issued }]), "csl-json")).toThrow();
  });
  it("accepts standard multiline RIS notes and warns about source normalization", () => {
    const parsed = bibliographyCodec.parse("TY  - JOUR\nTI  - Synthetic\nN1  - First line\ncontinuation\nER  -\n", "ris");
    expect(parsed.references[0]?.notes).toContain("First line continuation");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
  it("warns on field/date losses and resolves duplicate keys without merging identities", () => {
    const value = { id: "same", type: "book", title: "Synthetic", issued: { "date-parts": [[2020, 1, 2]] }, editor: [{ family: "Other" }] };
    const result = bibliographyCodec.parse(JSON.stringify([value, value]), "csl-json");
    expect(result.references.map(reference => reference.citekey)).toEqual(["same", "same-2"]);
    expect(result.warnings.join(" ")).toMatch(/date detail.*unsupported fields.*Duplicate key.*duplicate identity/su);
  });
  it("renders distinct genuine CSL styles, including contextual citations", () => {
    const references = [syntheticReference()];
    expect(bibliographyCodec.format(references, "apa")).toContain("Doe, J. (2020).");
    expect(bibliographyCodec.format(references, "vancouver")).toMatch(/^1\. Doe J\./u);
    expect(bibliographyCodec.format(references, "harvard1")).toContain("Doe, J. (2020)");
    expect(formatCitation(references, "apa", ["doe2020"])).toBe("(Doe, 2020)");
    expect(formatCitation(references, "vancouver", ["doe2020"])).toBe("(1)");
  });
  it("keeps Vancouver citation numbers aligned with the full bibliography", () => {
    const references = [syntheticReference(), { ...syntheticReference(), id: `ref-${"b".repeat(32)}`, citekey: "second", title: "Second synthetic" }];
    expect(formatCitation(references, "vancouver", ["second"])).toBe("(2)");
  });
  it("round-trips standard exports, includes loss notices, and cannot inject RIS records", () => {
    const reference = { ...syntheticReference(), notes: "Synthetic\nER  -\nTY  - BOOK", title: 'A {brace} & \\input{unsafe}' };
    for (const format of ["bibtex", "ris", "csl-json"] as const) {
      const text = bibliographyCodec.export([reference], format);
      expect(text).toContain("Portable bibliography omits");
      const parsed = bibliographyCodec.parse(text, format).references;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.citekey).toBe(reference.citekey);
    }
  });
  it("preserves ordinary URI delimiters in BibTeX round trips", () => {
    const reference = { ...syntheticReference(), doi: "10.0000/synthetic_identifier", url: "https://example.invalid/a_b?q=a&more=%7B#part" };
    expect(bibliographyCodec.parse(bibliographyCodec.export([reference], "bibtex"), "bibtex").references[0]).toMatchObject({ doi: reference.doi, url: reference.url });
  });
  it.each([
    { field: "doi", payload: "x}, note={Injected" },
    { field: "url", payload: "https://example.invalid/x}, note={Injected" },
    { field: "authors", payload: "Corporate}}, note={Injected}, title={Overwrite" },
    { field: "doi", payload: String.raw`x\\input{injected}` },
    { field: "url", payload: String.raw`https://example.invalid/\\input{injected}` },
    { field: "authors", payload: String.raw`Corporate \\input{injected}` },
  ])("escapes BibTeX $field brace/backslash payloads without injecting fields or records", ({ field, payload }) => {
    const baseline = { ...syntheticReference(), notes: "Original note" };
    const reference = { ...baseline, ...(field === "authors" ? { authors: [payload] } : { [field]: payload }) };
    const exported = bibliographyCodec.export([reference], "bibtex");
    const parsed = plugins.input.data(exported, "@bibtex/text");
    const control = plugins.input.data(bibliographyCodec.export([baseline], "bibtex"), "@bibtex/text");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.label).toBe(reference.citekey);
    expect(Object.keys(parsed[0]?.properties ?? {}).sort()).toEqual(Object.keys(control[0]?.properties ?? {}).sort());
    expect(parsed[0]?.properties["note"]).toBe(control[0]?.properties["note"]);
    expect(parsed[0]?.properties["title"]).toBe(control[0]?.properties["title"]);
    const roundTrip = bibliographyCodec.parse(exported, "bibtex");
    expect(roundTrip.references).toHaveLength(1);
    expect(roundTrip.references[0]).toMatchObject({ title: reference.title, notes: "Original note" });
    expect(roundTrip.references[0]?.authors).toHaveLength(1);
    expect(exported).toContain("escaping may remain on re-import");
  });
  it.each(["bibtex", "ris", "csl-json"] as const)("rejects portable %s exports over 2 MiB UTF-8 without truncating", format => {
    const references = Array.from({ length: 35 }, (_, index) => ({ ...syntheticReference(), id: `ref-${index.toString(16).padStart(32, "0")}`, citekey: `synthetic${String(index)}`, notes: "é".repeat(32000) }));
    expect(() => bibliographyCodec.export(references, format)).toThrow(/exceeds 2 MiB; reduce/u);
    expect(references[0]?.notes).toHaveLength(32000);
  });
  it("rejects oversized imports and duplicate export keys", () => {
    expect(() => bibliographyCodec.parse("x".repeat(4 * 1024 * 1024 + 1), "bibtex")).toThrow(/oversized/u);
    expect(() => bibliographyCodec.export([syntheticReference(), syntheticReference()], "ris")).toThrow(/duplicate/u);
  });
});
