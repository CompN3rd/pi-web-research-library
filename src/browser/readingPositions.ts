const storageKey = "research-library:reading-pages:v1";
const maxEntries = 100;
const maxKeyLength = 8192;
interface ReadingPage { key: string; page: number }
type PositionStorage = Pick<Storage, "getItem" | "setItem">;

/** Browser-local convenience state, never workspace/catalog authority. */
export class ReadingPositions {
  private failed = false;
  constructor(private readonly storage: () => PositionStorage, private readonly reportFailure: (error: unknown) => void) {}

  read(key: string): number | undefined {
    return this.attempt(() => this.entries().find(entry => entry.key === key)?.page);
  }

  save(key: string, page: number): void {
    this.attempt(() => {
      if (key.length > maxKeyLength || !Number.isSafeInteger(page) || page < 1) throw new Error("Invalid remembered PDF page");
      const entries = this.entries().filter(entry => entry.key !== key);
      entries.push({ key, page });
      this.storage().setItem(storageKey, JSON.stringify(entries.slice(-maxEntries)));
    });
  }

  private entries(): ReadingPage[] {
    const raw = this.storage().getItem(storageKey);
    if (raw === null) return [];
    if (raw.length > 1024 * 1024) throw new Error("Remembered PDF pages exceed the browser storage limit");
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > maxEntries) throw new Error("Invalid remembered PDF pages in browser storage");
    return entries.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || !("key" in entry) || !("page" in entry)
        || typeof entry.key !== "string" || entry.key.length > maxKeyLength
        || typeof entry.page !== "number" || !Number.isSafeInteger(entry.page) || entry.page < 1) throw new Error("Invalid remembered PDF page in browser storage");
      return { key: entry.key, page: entry.page };
    });
  }

  private attempt<T>(action: () => T): T | undefined {
    if (this.failed) return undefined;
    try { return action(); }
    catch (error) {
      // Do not replace malformed state or repeatedly retry unavailable/quota-limited storage.
      this.failed = true;
      this.reportFailure(error);
      return undefined;
    }
  }
}
