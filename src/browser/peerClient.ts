import type { JsonValue, PluginPeer } from "@jmfederico/pi-web/plugin-api";
import { RESEARCH_PROTOCOL_VERSION } from "../domain/protocol.js";

export type ResearchPeer = Pick<Extract<PluginPeer, { request: unknown }>, "request">;

export function researchRequest(peer: PluginPeer | undefined, operation: string, payload: unknown, signal?: AbortSignal): Promise<JsonValue> {
  if (peer?.request === undefined) return Promise.reject(new Error("Research Library server is unavailable. Enable the paired plugin and restart the target daemon when safe."));
  return peer.request(operation, { version: RESEARCH_PROTOCOL_VERSION, payload: toJson(payload) }, signal === undefined ? {} : { signal });
}

export function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  throw new Error("Research protocol accepts only JSON values");
}
