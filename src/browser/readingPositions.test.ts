import { describe, expect, it, vi } from "vitest";
import { ReadingPositions } from "./readingPositions.js";

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("browser-local reading pages", () => {
  it("reopens exact identities only, updates pages, and bounds retained entries to the last 100 saves", () => {
    const local = storage(), failure = vi.fn();
    const positions = new ReadingPositions(() => local, failure);
    for (let i = 0; i < 100; i++) positions.save(`source-${String(i)}`, i + 1);
    positions.save("source-0", 4); positions.save("new-source", 2);
    const reopened = new ReadingPositions(() => local, failure);
    expect(reopened.read("source-0")).toBe(4);
    expect(reopened.read("source-1")).toBeUndefined();
    expect(reopened.read("new-source")).toBe(2);
    expect(reopened.read("different-source")).toBeUndefined();
    expect(failure).not.toHaveBeenCalled();
  });
  it.each(["not JSON", "{}", '[{"key":"source","page":0}]', '[{"key":"source","page":1.5}]', "x".repeat(1024 * 1024 + 1)])("reports malformed/oversized storage without overwriting it (%#)", raw => {
    const local = storage(), failure = vi.fn();
    local.getItem = () => raw;
    const positions = new ReadingPositions(() => local, failure);
    expect(positions.read("source")).toBeUndefined(); positions.save("source", 2);
    expect(local.data.size).toBe(0); expect(failure).toHaveBeenCalledOnce();
  });
  it("reports storage access and quota failures once without failing the reader", () => {
    const failure = vi.fn();
    const denied = new ReadingPositions(() => { throw new Error("Access denied"); }, failure);
    expect(denied.read("source")).toBeUndefined(); denied.save("source", 4);
    expect(failure).toHaveBeenCalledOnce();
    const local = storage(); local.setItem = () => { throw new Error("Quota exceeded"); };
    const full = new ReadingPositions(() => local, failure);
    expect(() => { full.save("source", 2); }).not.toThrow();
    expect(failure).toHaveBeenLastCalledWith(new Error("Quota exceeded"));
  });
});
