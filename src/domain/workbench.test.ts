import { describe, expect, it } from "vitest";
import { libraryPage, libraryPath, libraryText } from "./workbench.js";

describe("native shared scalar and pagination boundaries", () => {
  it("accepts Windows line endings and Unicode while rejecting invisible controls", () => {
    expect(libraryText("Citation\r\nUnicode: 🧪 日本語\tmore")).toBe("Citation\r\nUnicode: 🧪 日本語\tmore");
    for (const text of ["\u0000", "\u007f", "\u0085", "\u001b"]) expect(() => libraryText(text)).toThrow("text");
    for (const path of ["../secret", "C:/secret", "a\\b", "/root", "a//b", "a?query"]) expect(() => libraryPath(path)).toThrow();
    expect(libraryPath("raw/research-library/paper.pdf")).toBe("raw/research-library/paper.pdf");
  });
  it("paginates by count and encoded framed bytes without hiding records", () => {
    const rows = Array.from({ length: 4 }, (_, id) => ({ id, text: "漢".repeat(30_000) }));
    const first = libraryPage(rows, 0);
    expect(first.items).toHaveLength(2); expect(first.nextOffset).toBe(2);
    expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThanOrEqual(192 * 1024);
    const second = libraryPage(rows, first.nextOffset ?? 0);
    expect(second.items).toEqual(rows.slice(2)); expect(second.nextOffset).toBeNull();
    expect(libraryPage(Array.from({ length: 30 }, (_, id) => id), 0).items).toHaveLength(25);
    expect(() => libraryPage([{ text: "x".repeat(192 * 1024) }], 0)).toThrow("page limit");
  });
});
