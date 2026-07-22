import { describe, expect, it } from "vitest";
import {
  conflictingExternalDocumentId,
  isValidPsozhId,
  managedExternalDocumentId,
  unmanagedExternalDocumentId
} from "./documentWorkspaceIdentity";

describe("external document identity", () => {
  it("keeps an existing managed DocumentId verbatim", () => {
    expect(managedExternalDocumentId("legacy:note:existing-id")).toBe("legacy:note:existing-id");
  });

  it("uses distinct path identities for unmanaged and duplicate-id files", () => {
    const unmanaged = unmanagedExternalDocumentId("workspace", "People/Ada.md");
    const duplicate = conflictingExternalDocumentId("workspace", "People/Ada.md");
    expect(unmanaged).not.toBe(duplicate);
    expect(unmanaged).toContain("People%2FAda.md");
  });

  it("rejects empty, padded and control-character ids", () => {
    expect(isValidPsozhId("valid-id")).toBe(true);
    expect(isValidPsozhId(" padded ")).toBe(false);
    expect(isValidPsozhId("bad\nid")).toBe(false);
    expect(isValidPsozhId("")).toBe(false);
  });
});
