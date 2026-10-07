import { emptyReferenceFields, type LibraryReference } from "./workbench.js";

export function syntheticReference(): LibraryReference {
  return { ...emptyReferenceFields(), id: `ref-${"a".repeat(32)}`, revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null, documents: [], aliases: [], provenance: [], citekey: "doe2020", title: "Synthetic research", authors: ["Doe, Jane"], year: 2020, containerTitle: "Synthetic Journal", volume: "3", pages: "12-19", doi: "10.0000/synthetic" };
}
