import { vi } from "vitest";

export function previewFiles() {
  return {
    capabilityVersion: 1 as const,
    maxInlinePreviewBytes: 10 * 1024 * 1024,
    defaultUploadFolder: ".pi-web/uploads",
    previewUrl: (path: string) => `https://pi.example.test/${encodeURIComponent(path)}`,
    downloadUrl: (path: string) => `https://pi.example.test/${encodeURIComponent(path)}`,
    uploadFile: vi.fn(),
  };
}
