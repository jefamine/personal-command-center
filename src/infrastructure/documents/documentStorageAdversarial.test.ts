import { describe, expect, it } from "vitest";
import type { DocumentId } from "../../domain/documents/documentContract";
import type {
  DocumentStorageResult,
  StoredFolderOperation
} from "../../domain/documents/workspace/documentWorkspaceContract";
import {
  BrowserDirectoryDocumentStorageAdapter
} from "./browserDirectoryDocumentStorageAdapter";
import type {
  BrowserDirectoryHandleLike,
  BrowserFileHandleLike,
  BrowserFileLike,
  BrowserWritableLike
} from "./browserDirectoryFilePort";
import { MemoryDocumentStorageAdapter } from "./memoryDocumentStorageAdapter";

const workspaceId = "adversarial-workspace";
const now = new Date("2026-07-22T15:00:00.000Z");

function managedMarkdown(id: string, body = "Body"): string {
  return `---\npsozh-id: ${JSON.stringify(id)}\n---\n${body}`;
}

function memoryAdapter(
  options: ConstructorParameters<typeof MemoryDocumentStorageAdapter>[0] = {}
): MemoryDocumentStorageAdapter {
  return new MemoryDocumentStorageAdapter({
    workspaceId,
    now: () => now,
    ...options
  });
}

function successful<T>(result: DocumentStorageResult<T>): T {
  if (result.status === "error") throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

describe("adversarial shared-workspace storage cases", () => {
  it("marks a readable case-collision peer as conflict even when the other file is unreadable", async () => {
    const storage = memoryAdapter({
      files: {
        "A.md": { content: "unreadable", readable: false },
        "a.md": "readable"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents).toHaveLength(1);
    expect(scan.documents[0]).toMatchObject({
      state: "conflict",
      reference: { relativePath: "a.md" },
      body: "readable"
    });
    expect(scan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "A.md", code: "inaccessible" }),
      expect.objectContaining({ relativePath: "A.md", code: "path-collision" }),
      expect.objectContaining({ relativePath: "a.md", code: "path-collision" })
    ]));
    expect(scan.summary).toMatchObject({ pathCollisions: 2, unreadableFiles: 1 });
  });

  it("rejects a duplicate supplied ID before creating either target or service metadata", async () => {
    const storage = memoryAdapter({
      files: { "Existing.md": managedMarkdown("taken-id") }
    });
    const before = storage.memory.snapshotFiles();

    const result = await storage.createDocument({
      workspaceId,
      relativePath: "Duplicate.md",
      documentId: "taken-id" as DocumentId,
      body: "must not be written"
    });

    expect(result).toMatchObject({ status: "error", code: "duplicate-id" });
    expect(storage.memory.hasFile("Duplicate.md")).toBe(false);
    expect(storage.memory.hasFile(".psozh/workspace.json")).toBe(false);
    expect(storage.memory.snapshotFiles()).toEqual(before);
  });

  it("rejects an invalid supplied ID without creating any file", async () => {
    const storage = memoryAdapter();

    const result = await storage.createDocument({
      workspaceId,
      relativePath: "Invalid.md",
      documentId: "bad\nid" as DocumentId,
      body: "must not be written"
    });

    expect(result).toMatchObject({ status: "error" });
    expect(storage.memory.snapshotFiles()).toEqual({});
    expect(storage.memory.hasFile("Invalid.md")).toBe(false);
    expect(storage.memory.hasFile(".psozh/workspace.json")).toBe(false);
  });

  it("reports external modification when psozh-id changes at the same path", async () => {
    const storage = memoryAdapter({
      files: { "Document.md": managedMarkdown("first-id", "Same body") }
    });
    const opened = (await storage.scan()).documents[0];
    storage.memory.externalWrite("Document.md", managedMarkdown("second-id", "Same body"));

    const result = await storage.readDocument(opened.reference);

    expect(result).toMatchObject({
      status: "error",
      code: "external-modification",
      current: {
        reference: { relativePath: "Document.md", documentId: "second-id" },
        metadata: { psozhId: "second-id" }
      }
    });
    expect(storage.memory.rawFile("Document.md")).toBe(managedMarkdown("second-id", "Same body"));
  });

  it("turns invalid UTF-8 into a per-file scan error at the browser boundary", async () => {
    const invalidBytes = new Uint8Array([0xc3, 0x28]);
    const file: BrowserFileHandleLike = {
      kind: "file",
      name: "Invalid.md",
      getFile: async (): Promise<BrowserFileLike> => ({
        size: invalidBytes.byteLength,
        lastModified: 1,
        arrayBuffer: async () => invalidBytes.slice().buffer
      }),
      createWritable: async (): Promise<BrowserWritableLike> => {
        throw new DOMException("Read-only test handle.", "NotAllowedError");
      }
    };
    const root: BrowserDirectoryHandleLike = {
      kind: "directory",
      name: "workspace",
      async *entries() {
        yield [file.name, file] as const;
      },
      getDirectoryHandle: async () => {
        throw new DOMException("Directory not found.", "NotFoundError");
      },
      getFileHandle: async (name) => {
        if (name === file.name) return file;
        throw new DOMException("File not found.", "NotFoundError");
      },
      removeEntry: async () => {
        throw new DOMException("Read-only test handle.", "NotAllowedError");
      }
    };
    const storage = new BrowserDirectoryDocumentStorageAdapter({
      workspaceId,
      directoryHandle: root,
      now: () => now
    });

    const scan = await storage.scan();

    expect(scan.documents).toEqual([]);
    expect(scan.errors).toContainEqual(expect.objectContaining({
      relativePath: "Invalid.md",
      code: "inaccessible"
    }));
    expect(scan.summary).toMatchObject({ markdownFiles: 1, unreadableFiles: 1 });
  });

  it("moves an empty nested folder tree without flattening or dropping directories", async () => {
    const storage = memoryAdapter({
      folders: ["Archive", "Source/Empty/Deep"]
    });

    const result = await storage.moveFolder({
      workspaceId,
      relativePath: "Source",
      destinationFolder: "Archive"
    });

    expect(result).toEqual({
      status: "ok",
      value: {
        relativePath: "Archive/Source",
        affectedDocuments: []
      } satisfies StoredFolderOperation
    });
    const snapshot = await storage.memory.list();
    expect(snapshot.folders).toEqual([
      "Archive",
      "Archive/Source",
      "Archive/Source/Empty",
      "Archive/Source/Empty/Deep"
    ]);
    expect(snapshot.folders.some((folder) => folder === "Source" || folder.startsWith("Source/")))
      .toBe(false);
  });

  it("rejects moving a folder that contains an ignored protected subtree", async () => {
    const storage = memoryAdapter({
      files: {
        "Source/Visible.md": "visible",
        "Source/.obsidian/Plugins/plugin.md": "protected"
      },
      folders: ["Archive"]
    });
    const before = storage.memory.snapshotFiles();

    const result = await storage.moveFolder({
      workspaceId,
      relativePath: "Source",
      destinationFolder: "Archive"
    });

    expect(result).toMatchObject({ status: "error", code: "unsupported" });
    expect(storage.memory.snapshotFiles()).toEqual(before);
    expect(storage.memory.hasFile("Archive/Source/Visible.md")).toBe(false);
    expect(storage.memory.hasFile(".psozh/workspace.json")).toBe(false);
  });

  it("rejects a case-insensitive move into the source's own descendant", async () => {
    const storage = memoryAdapter({
      files: { "Projects/One.md": "one" },
      folders: ["projects/Archive"]
    });
    const before = storage.memory.snapshotFiles();

    const result = await storage.moveFolder({
      workspaceId,
      relativePath: "Projects",
      destinationFolder: "PROJECTS/Archive"
    });

    expect(result).toMatchObject({ status: "error", code: "invalid-path" });
    expect(storage.memory.snapshotFiles()).toEqual(before);
    expect(storage.memory.hasFile(".psozh/workspace.json")).toBe(false);
  });

  it("does not overwrite an externally edited document through a stale reference", async () => {
    const originalContent = managedMarkdown("document-id", "Original");
    const externalContent = managedMarkdown("document-id", "Edited in Obsidian");
    const storage = memoryAdapter({ files: { "Document.md": originalContent } });
    const opened = (await storage.scan()).documents[0];
    storage.memory.externalWrite("Document.md", externalContent);

    const result = await storage.updateDocument({
      reference: opened.reference,
      body: "Edited in PSOZH"
    });

    expect(result).toMatchObject({ status: "error", code: "external-modification" });
    expect(storage.memory.rawFile("Document.md")).toBe(externalContent);
    expect(storage.memory.hasFile(".psozh/workspace.json")).toBe(false);
  });

  it("rolls back a document move when deleting the verified source fails", async () => {
    const source = managedMarkdown("document-id", "Original");
    const storage = memoryAdapter({ files: { "Source.md": source } });
    const opened = (await storage.scan()).documents[0];
    storage.memory.failNextDelete("source delete failed");

    const result = await storage.renameDocument({
      reference: opened.reference,
      nextFileName: "Destination.md"
    });

    expect(result).toMatchObject({ status: "error", code: "operation-failed" });
    expect(storage.memory.rawFile("Source.md")).toBe(source);
    expect(storage.memory.hasFile("Destination.md")).toBe(false);
  });

  it("rolls back copied files and folders when a folder source delete fails", async () => {
    const source = managedMarkdown("document-id", "Original");
    const storage = memoryAdapter({
      files: { "Source/Nested/Document.md": source },
      folders: ["Archive", "Source/Empty"]
    });
    storage.memory.failNextDelete("folder source delete failed");

    const result = await storage.moveFolder({
      workspaceId,
      relativePath: "Source",
      destinationFolder: "Archive"
    });

    expect(result).toMatchObject({ status: "error", recoveryRequired: false });
    expect(storage.memory.rawFile("Source/Nested/Document.md")).toBe(source);
    expect(storage.memory.hasFile("Archive/Source/Nested/Document.md")).toBe(false);
    const snapshot = await storage.memory.list();
    expect(snapshot.folders).toContain("Source/Empty");
    expect(snapshot.folders.some((folder) => folder === "Archive/Source" || folder.startsWith("Archive/Source/")))
      .toBe(false);
  });
});
