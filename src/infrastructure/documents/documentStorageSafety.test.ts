import { describe, expect, it } from "vitest";
import type {
  DocumentStorageResult,
  StoredDocument,
  UpdateStoredDocumentCommand
} from "../../domain/documents/workspace/documentWorkspaceContract";
import { MemoryDocumentStorageAdapter } from "./memoryDocumentStorageAdapter";

const WORKSPACE_ID = "safety-workspace";
const FIXED_NOW = new Date("2026-07-22T12:00:00.000Z");

function createAdapter(): MemoryDocumentStorageAdapter {
  let nextId = 0;
  return new MemoryDocumentStorageAdapter({
    workspaceId: WORKSPACE_ID,
    createId: () => `safety-id-${++nextId}`,
    now: () => FIXED_NOW
  });
}

function requireOk<T>(result: DocumentStorageResult<T>): T {
  expect(result.status).toBe("ok");
  if (result.status !== "ok") {
    throw new Error(`Expected a successful storage result: ${JSON.stringify(result)}.`);
  }
  return result.value;
}

async function createDocument(
  adapter: MemoryDocumentStorageAdapter,
  relativePath = "Notes/Document.md",
  body = "Original body"
): Promise<StoredDocument> {
  return requireOk(await adapter.createDocument({
    workspaceId: WORKSPACE_ID,
    relativePath,
    body
  }));
}

function trashPaths(tombstoneId: string): {
  readonly markdown: string;
  readonly manifest: string;
} {
  const safeId = encodeURIComponent(tombstoneId);
  return {
    markdown: `.psozh/trash/${safeId}.md`,
    manifest: `.psozh/trash/${safeId}.json`
  };
}

describe("document storage safety", () => {
  it("saves when the expected content hash still matches", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter);

    const updated = requireOk(await adapter.updateDocument({
      reference: original.reference,
      body: "Saved body"
    }));

    expect(updated.body).toBe("Saved body");
    expect(updated.contentHash).not.toBe(original.contentHash);
    expect(updated.reference.expectedContentHash).toBe(updated.contentHash);
    expect(adapter.memory.rawFile(original.reference.relativePath)).toContain("Saved body");
  });

  it("reports an external modification when the expected hash is stale", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter);
    const externalContent = adapter.memory.rawFile(original.reference.relativePath)!
      .replace("Original body", "External body");
    adapter.memory.externalWrite(original.reference.relativePath, externalContent);

    const result = await adapter.updateDocument({
      reference: original.reference,
      body: "Local body"
    });

    expect(result).toMatchObject({
      status: "error",
      code: "external-modification",
      current: { body: "External body" }
    });
  });

  it("does not overwrite the external version after a conflict", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter);
    const externalContent = adapter.memory.rawFile(original.reference.relativePath)!
      .replace("Original body", "External body");
    adapter.memory.externalWrite(original.reference.relativePath, externalContent);

    await adapter.updateDocument({
      reference: original.reference,
      body: "Local body that must not win"
    });

    expect(adapter.memory.rawFile(original.reference.relativePath)).toBe(externalContent);
    expect(adapter.memory.rawFile(original.reference.relativePath)).not.toContain("Local body");
  });

  it("accepts the external version on reload and then saves with its refreshed hash", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter);
    const externalContent = adapter.memory.rawFile(original.reference.relativePath)!
      .replace("Original body", "External body");
    adapter.memory.externalWrite(original.reference.relativePath, externalContent);

    const reloaded = requireOk(await adapter.readDocument(original.reference));
    expect(reloaded.body).toBe("External body");
    expect(reloaded.contentHash).not.toBe(original.contentHash);

    const saved = requireOk(await adapter.updateDocument({
      reference: reloaded.reference,
      body: "Body saved after reload"
    }));

    expect(saved.body).toBe("Body saved after reload");
    expect(saved.reference.expectedContentHash).toBe(saved.contentHash);
    expect(adapter.memory.rawFile(original.reference.relativePath)).toContain("Body saved after reload");
  });

  it("saves a conflict copy with a new identity while preserving the external original", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter);
    const externalContent = adapter.memory.rawFile(original.reference.relativePath)!
      .replace("Original body", "External body");
    adapter.memory.externalWrite(original.reference.relativePath, externalContent);

    const conflict = requireOk(await adapter.saveConflictCopy({
      reference: original.reference,
      body: "Local conflict body"
    }));

    expect(adapter.memory.rawFile(original.reference.relativePath)).toBe(externalContent);
    expect(conflict.reference.relativePath).toMatch(/^\.psozh\/conflicts\//u);
    expect(conflict.reference.documentId).not.toBe(original.reference.documentId);
    expect(conflict.metadata.psozhId).toBe(conflict.reference.documentId);
    expect(conflict.body).toBe("Local conflict body");
    expect(adapter.memory.rawFile(conflict.reference.relativePath)).toContain("Local conflict body");
  });

  it("copies and verifies a moved document before removing the source", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter, "Inbox/Move me.md", "Bytes to preserve");
    const originalContent = adapter.memory.rawFile(original.reference.relativePath);

    const moved = requireOk(await adapter.moveDocument({
      reference: original.reference,
      destinationFolder: "Archive"
    }));

    expect(moved.reference.relativePath).toBe("Archive/Move me.md");
    expect(moved.reference.documentId).toBe(original.reference.documentId);
    expect(moved.contentHash).toBe(original.contentHash);
    expect(adapter.memory.rawFile(moved.reference.relativePath)).toBe(originalContent);
    expect(adapter.memory.hasFile(original.reference.relativePath)).toBe(false);
  });

  it("preserves the old document when writing a move target fails", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter, "Inbox/Move me.md", "Must survive");
    const originalContent = adapter.memory.rawFile(original.reference.relativePath);
    adapter.memory.failNextWrite("Injected target write failure.");

    const result = await adapter.moveDocument({
      reference: original.reference,
      destinationFolder: "Archive"
    });

    expect(result).toMatchObject({ status: "error", code: "operation-failed" });
    expect(adapter.memory.rawFile(original.reference.relativePath)).toBe(originalContent);
    expect(adapter.memory.hasFile("Archive/Move me.md")).toBe(false);
  });

  it("rejects a destination collision without overwriting either document", async () => {
    const adapter = createAdapter();
    const first = await createDocument(adapter, "First.md", "First content");
    await createDocument(adapter, "Second.md", "Second content");
    const before = adapter.memory.snapshotFiles();

    const result = await adapter.renameDocument({
      reference: first.reference,
      nextFileName: "Second.md"
    });

    expect(result).toMatchObject({ status: "error", code: "path-collision" });
    expect(adapter.memory.snapshotFiles()).toEqual(before);
  });

  it("blocks path traversal outside the workspace", async () => {
    const adapter = createAdapter();

    const result = await adapter.createDocument({
      workspaceId: WORKSPACE_ID,
      relativePath: "../outside.md",
      body: "Must not be written"
    });

    expect(result).toMatchObject({ status: "error", code: "invalid-path" });
    expect(adapter.memory.snapshotFiles()).toEqual({});
  });

  it("blocks Windows-reserved, forbidden and trailing names", async () => {
    const adapter = createAdapter();
    const paths = ["CON.md", "bad?.md", "trailing "];

    const results = await Promise.all(paths.map((relativePath) => adapter.createDocument({
      workspaceId: WORKSPACE_ID,
      relativePath,
      body: "Must not be written"
    })));

    expect(results).toHaveLength(paths.length);
    expect(results.every((result) => result.status === "error" && result.code === "invalid-path"))
      .toBe(true);
    expect(adapter.memory.snapshotFiles()).toEqual({});
  });

  it("handles a case-only rename as a safe collision", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter, "Folder/Name.md", "Case-safe body");
    const before = adapter.memory.snapshotFiles();

    const result = await adapter.renameDocument({
      reference: original.reference,
      nextFileName: "name.md"
    });

    expect(result).toMatchObject({ status: "error", code: "path-collision" });
    expect(adapter.memory.snapshotFiles()).toEqual(before);
    expect(adapter.memory.hasFile("Folder/Name.md")).toBe(true);
  });

  it("moves a deleted document into the managed trash", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter, "Journal/Entry.md", "Delete safely");
    const originalContent = adapter.memory.rawFile(original.reference.relativePath);

    const deleted = requireOk(await adapter.deleteDocument({ reference: original.reference }));
    const paths = trashPaths(deleted.tombstoneId);

    expect(adapter.memory.hasFile(original.reference.relativePath)).toBe(false);
    expect(adapter.memory.rawFile(paths.markdown)).toBe(originalContent);
    expect(adapter.memory.rawFile(paths.manifest)).toContain(deleted.tombstoneId);
    expect((await adapter.scan()).documents).toEqual([]);
  });

  it("restores a trashed document with its original identity and bytes", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter, "Journal/Entry.md", "Restore safely");
    const originalContent = adapter.memory.rawFile(original.reference.relativePath);
    const deleted = requireOk(await adapter.deleteDocument({ reference: original.reference }));
    const paths = trashPaths(deleted.tombstoneId);

    const restored = requireOk(await adapter.restoreDocument({
      workspaceId: WORKSPACE_ID,
      tombstoneId: deleted.tombstoneId
    }));

    expect(restored.reference.relativePath).toBe(original.reference.relativePath);
    expect(restored.reference.documentId).toBe(original.reference.documentId);
    expect(restored.contentHash).toBe(original.contentHash);
    expect(adapter.memory.rawFile(original.reference.relativePath)).toBe(originalContent);
    expect(adapter.memory.hasFile(paths.markdown)).toBe(false);
    expect(adapter.memory.hasFile(paths.manifest)).toBe(false);
  });

  it("does not overwrite a new file when restore meets a path collision", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter, "Journal/Entry.md", "Trashed version");
    const deleted = requireOk(await adapter.deleteDocument({ reference: original.reference }));
    const replacement = await createDocument(adapter, "Journal/Entry.md", "New version");
    const replacementContent = adapter.memory.rawFile(replacement.reference.relativePath);
    const paths = trashPaths(deleted.tombstoneId);

    const result = await adapter.restoreDocument({
      workspaceId: WORKSPACE_ID,
      tombstoneId: deleted.tombstoneId
    });

    expect(result).toMatchObject({ status: "error", code: "path-collision" });
    expect(adapter.memory.rawFile(replacement.reference.relativePath)).toBe(replacementContent);
    expect(adapter.memory.hasFile(paths.markdown)).toBe(true);
    expect(adapter.memory.hasFile(paths.manifest)).toBe(true);
  });

  it("permanently purges only the selected tombstone", async () => {
    const adapter = createAdapter();
    const first = await createDocument(adapter, "First.md", "First deleted body");
    const second = await createDocument(adapter, "Second.md", "Second deleted body");
    const firstDeleted = requireOk(await adapter.deleteDocument({ reference: first.reference }));
    const secondDeleted = requireOk(await adapter.deleteDocument({ reference: second.reference }));
    const firstPaths = trashPaths(firstDeleted.tombstoneId);
    const secondPaths = trashPaths(secondDeleted.tombstoneId);

    const purged = requireOk(await adapter.purgeDocument({
      workspaceId: WORKSPACE_ID,
      tombstoneId: firstDeleted.tombstoneId
    }));

    expect(purged.tombstoneId).toBe(firstDeleted.tombstoneId);
    expect(adapter.memory.hasFile(firstPaths.markdown)).toBe(false);
    expect(adapter.memory.hasFile(firstPaths.manifest)).toBe(false);
    expect(adapter.memory.hasFile(secondPaths.markdown)).toBe(true);
    expect(adapter.memory.hasFile(secondPaths.manifest)).toBe(true);
  });

  it("does not mutate input commands, references or metadata arrays", async () => {
    const adapter = createAdapter();
    const original = await createDocument(adapter);
    const reference = { ...original.reference };
    const tags = ["one", "two"];
    const aliases = ["First alias", "Second alias"];
    const command: UpdateStoredDocumentCommand = {
      reference,
      body: "Updated without mutating inputs",
      tags,
      aliases
    };
    const before = {
      reference: { ...reference },
      body: command.body,
      tags: [...tags],
      aliases: [...aliases]
    };

    requireOk(await adapter.updateDocument(command));

    expect(command).toEqual(before);
    expect(reference).toEqual(before.reference);
    expect(tags).toEqual(before.tags);
    expect(aliases).toEqual(before.aliases);
  });
});
