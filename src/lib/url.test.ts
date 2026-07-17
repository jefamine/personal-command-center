import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./url";

describe("safeExternalUrl", () => {
  it("normalizes http and https links", () => {
    expect(safeExternalUrl("  https://example.com/article?q=1  ")).toBe("https://example.com/article?q=1");
    expect(safeExternalUrl("http://localhost:4173/path")).toBe("http://localhost:4173/path");
  });

  it.each(["", "not a url", "javascript:alert(1)", "data:text/html,unsafe", "file:///private.txt"])(
    "rejects unsupported input %s",
    (value) => expect(safeExternalUrl(value)).toBeNull()
  );
});
