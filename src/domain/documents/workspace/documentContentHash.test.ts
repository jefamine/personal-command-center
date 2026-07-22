import { describe, expect, it } from "vitest";
import { hashDocumentContent } from "./documentContentHash";

describe("document content hash", () => {
  it("is deterministic and changes with exact file text", async () => {
    const first = await hashDocumentContent("---\r\ntags: [one]\r\n---\r\nText");
    const repeated = await hashDocumentContent("---\r\ntags: [one]\r\n---\r\nText");
    const lineEndingChange = await hashDocumentContent("---\ntags: [one]\n---\nText");

    expect(first).toBe(repeated);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(lineEndingChange).not.toBe(first);
  });
});
