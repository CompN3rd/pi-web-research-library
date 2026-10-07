import type { ReferenceFields } from "./workbench.js";

export type DiscoveryProvider = "local" | "crossref" | "openalex";
export interface DiscoveryCandidate {
  externalId: string;
  fields: ReferenceFields;
  sourceUrl: string;
  openAccessUrl: string;
  citationCount: number | null;
}
export interface DiscoveryResults {
  searchId: string;
  provider: DiscoveryProvider;
  query: string;
  page: number;
  nextPage: number | null;
  total: number;
  candidates: DiscoveryCandidate[];
  warnings: string[];
}
export interface LibraryConnection {
  from: string;
  to: string;
  kind: "shared-author" | "shared-tag" | "model-claim";
  label: string;
}
export interface LibraryGraph {
  nodes: { id: string; title: string; citekey: string }[];
  edges: LibraryConnection[];
  warnings: string[];
}
