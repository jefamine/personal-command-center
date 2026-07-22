import { describe, expect, it } from "vitest";
import type { DocumentId } from "../../domain/documents/documentContract";
import { noteDocumentId } from "../../domain/documents/documentContract";
import type {
  DocumentStorageResult,
  StoredDocument
} from "../../domain/documents/workspace/documentWorkspaceContract";
import {
  conflictingExternalDocumentId,
  unmanagedExternalDocumentId
} from "../../domain/documents/workspace/documentWorkspaceIdentity";
import { MemoryDocumentStorageAdapter } from "./memoryDocumentStorageAdapter";

const workspaceId = "scanning-workspace";
const fixedNow = new Date("2026-07-22T12:00:00.000Z");

function managedMarkdown(
  id: string,
  body = "Body",
  metadata: readonly string[] = []
): string {
  return [
    "---",
    `psozh-id: ${JSON.stringify(id)}`,
    ...metadata,
    "---",
    body
  ].join("\n");
}

function adapter(options: ConstructorParameters<typeof MemoryDocumentStorageAdapter>[0] = {}) {
  return new MemoryDocumentStorageAdapter({
    workspaceId,
    now: () => fixedNow,
    ...options
  });
}

function valueOf<T>(result: DocumentStorageResult<T>): T {
  if (result.status === "error") {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.value;
}

function byPath(documents: readonly StoredDocument[], relativePath: string): StoredDocument {
  const document = documents.find((entry) => entry.reference.relativePath === relativePath);
  if (!document) throw new Error(`Missing scanned document: ${relativePath}`);
  return document;
}

describe("shared Markdown workspace scanning", () => {
  it("1. recursively scans Markdown files and projects complete file metadata", async () => {
    const storage = adapter({
      files: {
        "Root.md": "Root body",
        "People/Ada.md": managedMarkdown("ada-id", "Ada body", [
          "tags: [person, pioneer]",
          "aliases:",
          "  - Augusta Ada"
        ]),
        "People/History/Notes.MD": "Nested body"
      },
      folders: ["Empty"]
    });

    const scan = await storage.scan();

    expect(scan.documents.map((document) => document.reference.relativePath)).toEqual([
      "People/Ada.md",
      "People/History/Notes.MD",
      "Root.md"
    ]);
    expect(byPath(scan.documents, "People/Ada.md")).toMatchObject({
      fileName: "Ada.md",
      title: "Ada",
      extension: ".md",
      body: "Ada body",
      state: "managed",
      metadata: {
        psozhId: "ada-id",
        tags: ["person", "pioneer"],
        aliases: ["Augusta Ada"]
      },
      reference: {
        workspaceId,
        relativePath: "People/Ada.md",
        documentId: "ada-id"
      }
    });
    expect(byPath(scan.documents, "People/Ada.md").size).toBeGreaterThan(0);
    expect(byPath(scan.documents, "People/Ada.md").lastModified).toBeGreaterThan(0);
    expect(byPath(scan.documents, "People/Ada.md").contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(byPath(scan.documents, "People/Ada.md").rawFrontmatter).toContain("psozh-id");
    expect(scan.folders).toEqual(["Empty", "People", "People/History"]);
    expect(scan.summary).toMatchObject({ markdownFiles: 3, managedFiles: 1, unmanagedFiles: 2 });
  });

  it("2. completely ignores .obsidian files and folders", async () => {
    const storage = adapter({
      files: {
        ".obsidian/Plugins.md": managedMarkdown("hidden"),
        ".ObSiDiAn/Nested/Also.md": "hidden",
        "Visible.md": "visible"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents.map((document) => document.reference.relativePath)).toEqual(["Visible.md"]);
    expect(scan.folders).not.toContain(".obsidian");
    expect(scan.folders).not.toContain(".ObSiDiAn");
  });

  it("3. completely ignores .psozh service files", async () => {
    const storage = adapter({
      files: {
        ".psozh/workspace.md": managedMarkdown("service"),
        ".psozh/trash/deleted.md": managedMarkdown("deleted"),
        "Visible.md": "visible"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents.map((document) => document.reference.relativePath)).toEqual(["Visible.md"]);
    expect(scan.folders.some((folder) => folder.startsWith(".psozh"))).toBe(false);
  });

  it("4. completely ignores .git regardless of case", async () => {
    const storage = adapter({
      files: {
        ".git/Description.md": "hidden",
        ".GIT/objects/Object.md": "hidden",
        "Visible.md": "visible"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents.map((document) => document.reference.relativePath)).toEqual(["Visible.md"]);
    expect(scan.folders.some((folder) => folder.toLocaleLowerCase("en-US").startsWith(".git")))
      .toBe(false);
  });

  it("5. leaves non-Markdown and editor temporary files outside the document index", async () => {
    const storage = adapter({
      files: {
        "Assets/photo.png": "binary-looking data",
        "Data.json": "{}",
        "Draft.md~": "backup",
        ".#Locked.md": "lock",
        "#Scratch.md#": "temporary",
        "Real.md": "document"
      }
    });
    const before = storage.memory.snapshotFiles();

    const scan = await storage.scan();

    expect(scan.documents.map((document) => document.reference.relativePath)).toEqual(["Real.md"]);
    expect(scan.summary.markdownFiles).toBe(1);
    expect(storage.memory.snapshotFiles()).toEqual(before);
  });

  it("6. reports an unreadable file without fabricating a document", async () => {
    const storage = adapter({
      files: {
        "Denied.md": { content: "secret", readable: false },
        "Visible.md": "visible"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents.map((document) => document.reference.relativePath)).toEqual(["Visible.md"]);
    expect(scan.errors).toContainEqual(expect.objectContaining({
      relativePath: "Denied.md",
      code: "inaccessible"
    }));
    expect(scan.summary).toMatchObject({ markdownFiles: 2, unreadableFiles: 1 });
  });

  it("7. keeps scanning after one malformed document and exposes its readable body", async () => {
    const malformed = "---\ntags: { nested: true }\n---\nReadable body";
    const storage = adapter({
      files: {
        "Broken.md": malformed,
        "Good.md": managedMarkdown("good-id", "Good body")
      }
    });

    const scan = await storage.scan();

    expect(scan.documents).toHaveLength(2);
    expect(byPath(scan.documents, "Broken.md")).toMatchObject({
      body: "Readable body",
      state: "malformed-frontmatter"
    });
    expect(byPath(scan.documents, "Good.md").state).toBe("managed");
    expect(scan.errors).toContainEqual(expect.objectContaining({
      relativePath: "Broken.md",
      code: "malformed-frontmatter"
    }));
    expect(scan.summary.malformedFrontmatter).toBe(1);
  });

  it("8. normalizes separators and dot segments to portable relative paths", async () => {
    const storage = adapter({
      files: {
        "Folder\\Drafts\\..\\Note.md": "normalized"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents).toHaveLength(1);
    expect(scan.documents[0].reference.relativePath).toBe("Folder/Note.md");
    expect(scan.documents[0].fileName).toBe("Note.md");
  });

  it("9. detects case-insensitive path collisions and keeps both files distinct", async () => {
    const storage = adapter({
      files: {
        "People/Ada.md": "first",
        "people/ADA.MD": "second"
      }
    });

    const scan = await storage.scan();

    expect(scan.documents).toHaveLength(2);
    expect(scan.documents.every((document) => document.state === "conflict")).toBe(true);
    expect(new Set(scan.documents.map((document) => document.reference.documentId)).size).toBe(2);
    expect(scan.documents.map((document) => document.reference.documentId)).toEqual([
      conflictingExternalDocumentId(workspaceId, "People/Ada.md"),
      conflictingExternalDocumentId(workspaceId, "people/ADA.MD")
    ]);
    expect(scan.errors.filter((error) => error.code === "path-collision")).toHaveLength(2);
    expect(scan.summary.pathCollisions).toBe(2);
  });

  it("10. detects duplicate psozh-id without merging or rewriting either file", async () => {
    const first = managedMarkdown("duplicate-id", "first");
    const second = managedMarkdown("duplicate-id", "second");
    const storage = adapter({ files: { "First.md": first, "Second.md": second } });
    const before = storage.memory.snapshotFiles();

    const scan = await storage.scan();

    expect(scan.documents).toHaveLength(2);
    expect(scan.documents.every((document) => document.state === "conflict")).toBe(true);
    expect(scan.documents.map((document) => document.metadata.psozhId)).toEqual([
      "duplicate-id",
      "duplicate-id"
    ]);
    expect(new Set(scan.documents.map((document) => document.reference.documentId).values()).size)
      .toBe(2);
    expect(scan.errors.filter((error) => error.code === "duplicate-id")).toHaveLength(2);
    expect(storage.memory.snapshotFiles()).toEqual(before);
  });

  it("11. never modifies any file or creates workspace metadata during scan", async () => {
    const storage = adapter({
      files: {
        "Managed.md": managedMarkdown("managed"),
        "Unmanaged.md": "body",
        "Malformed.md": "---\nnot yaml\n---\nbody",
        ".obsidian/config.md": "hidden"
      }
    });
    const before = storage.memory.snapshotFiles();

    await storage.scan();

    expect(storage.memory.snapshotFiles()).toEqual(before);
    expect(storage.memory.hasFile(".psozh/workspace.json")).toBe(false);
  });

  it("12. produces a deterministic result on repeated unchanged scans", async () => {
    const storage = adapter({
      files: {
        "Zeta.md": managedMarkdown("zeta"),
        "alpha/Two.md": "two",
        "Alpha/one.md": "one",
        "Broken.md": "---\ntags: { complex: true }\n---\nbody"
      }
    });

    const first = await storage.scan();
    const second = await storage.scan();

    expect(second).toEqual(first);
  });

  it("honors cancellation before a scan touches the workspace", async () => {
    const storage = adapter({ files: { "One.md": "one" } });
    const controller = new AbortController();
    controller.abort();

    await expect(storage.scan({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});

describe("external Markdown document identity integration", () => {
  it("projects managed identity from psozh-id and path identity for unmanaged files", async () => {
    const storage = adapter({
      files: {
        "Managed.md": managedMarkdown("managed-id"),
        "Unmanaged.md": "Unmanaged body"
      }
    });

    const scan = await storage.scan();

    expect(byPath(scan.documents, "Managed.md")).toMatchObject({
      state: "managed",
      reference: { documentId: "managed-id" },
      metadata: { psozhId: "managed-id" }
    });
    expect(byPath(scan.documents, "Unmanaged.md")).toMatchObject({
      state: "unmanaged",
      reference: {
        documentId: unmanagedExternalDocumentId(workspaceId, "Unmanaged.md")
      },
      metadata: { psozhId: null }
    });
  });

  it("keeps a managed ID stable across physical rename and move", async () => {
    const storage = adapter({ files: { "People/Ada.md": managedMarkdown("ada-id") } });
    const original = byPath((await storage.scan()).documents, "People/Ada.md");

    const renamed = valueOf(await storage.renameDocument({
      reference: original.reference,
      nextFileName: "Augusta.md"
    }));
    const moved = valueOf(await storage.moveDocument({
      reference: renamed.reference,
      destinationFolder: "Archive"
    }));

    expect(renamed.reference).toMatchObject({
      relativePath: "People/Augusta.md",
      documentId: original.reference.documentId
    });
    expect(moved.reference).toMatchObject({
      relativePath: "Archive/Augusta.md",
      documentId: original.reference.documentId
    });
    expect(moved.metadata.psozhId).toBe("ada-id");
  });

  it("opens an unmanaged document without changing the file", async () => {
    const source = "# Existing Obsidian note\n\nNo frontmatter";
    const storage = adapter({ files: { "Existing.md": source } });
    const before = storage.memory.snapshotFiles();

    const scanned = byPath((await storage.scan()).documents, "Existing.md");
    const opened = valueOf(await storage.readDocument(scanned.reference));

    expect(opened).toMatchObject({ state: "unmanaged", body: source });
    expect(storage.memory.snapshotFiles()).toEqual(before);
  });

  it("explicitly makes an unmanaged document managed without changing body or unknown YAML", async () => {
    const source = [
      "---",
      "# preserve comment",
      "unknown:  keep formatting",
      "aliases: [Old name]",
      "---",
      "Original body"
    ].join("\n");
    const storage = adapter({ files: { "Existing.md": source } });
    const unmanaged = byPath((await storage.scan()).documents, "Existing.md");

    const managed = valueOf(await storage.makeDocumentManaged({
      reference: unmanaged.reference,
      documentId: "explicit-id" as DocumentId
    }));

    expect(managed).toMatchObject({
      state: "managed",
      body: "Original body",
      reference: { documentId: "explicit-id" },
      metadata: { psozhId: "explicit-id", aliases: ["Old name"] }
    });
    expect(storage.memory.rawFile("Existing.md")).toBe([
      "---",
      "# preserve comment",
      "unknown:  keep formatting",
      "aliases: [Old name]",
      "psozh-id: \"explicit-id\"",
      "---",
      "Original body"
    ].join("\n"));
  });

  it("refuses make-managed when the desired ID already belongs to another file", async () => {
    const storage = adapter({
      files: {
        "Managed.md": managedMarkdown("taken-id"),
        "Unmanaged.md": "body"
      }
    });
    const before = storage.memory.snapshotFiles();
    const unmanaged = byPath((await storage.scan()).documents, "Unmanaged.md");

    const result = await storage.makeDocumentManaged({
      reference: unmanaged.reference,
      documentId: "taken-id" as DocumentId
    });

    expect(result).toMatchObject({ status: "error", code: "duplicate-id" });
    expect(storage.memory.snapshotFiles()).toEqual(before);
  });

  it("does not make a document managed over an external edit", async () => {
    const storage = adapter({ files: { "Existing.md": "Before" } });
    const unmanaged = byPath((await storage.scan()).documents, "Existing.md");
    storage.memory.externalWrite("Existing.md", "Changed in Obsidian");

    const result = await storage.makeDocumentManaged({
      reference: unmanaged.reference,
      documentId: "explicit-id" as DocumentId
    });

    expect(result).toMatchObject({ status: "error", code: "external-modification" });
    expect(storage.memory.rawFile("Existing.md")).toBe("Changed in Obsidian");
  });

  it("creates new documents with distinct generated managed IDs", async () => {
    const ids = ["generated-one", "generated-two"];
    const storage = adapter({ createId: () => ids.shift() ?? "unexpected-id" });

    const first = valueOf(await storage.createDocument({
      workspaceId,
      relativePath: "First",
      body: "First body"
    }));
    const second = valueOf(await storage.createDocument({
      workspaceId,
      relativePath: "Second.md",
      body: "Second body"
    }));

    expect(first).toMatchObject({
      state: "managed",
      body: "First body",
      reference: { relativePath: "First.md", documentId: "generated-one" }
    });
    expect(second).toMatchObject({
      state: "managed",
      body: "Second body",
      reference: { relativePath: "Second.md", documentId: "generated-two" }
    });
    expect(first.reference.documentId).not.toBe(second.reference.documentId);
  });

  it("preserves an internal DocumentId supplied by migration", async () => {
    const oldId = noteDocumentId("legacy-note");
    const storage = adapter();

    const migrated = valueOf(await storage.createDocument({
      workspaceId,
      relativePath: "Migrated.md",
      documentId: oldId,
      body: "Migrated body",
      tags: ["migration"]
    }));

    expect(migrated).toMatchObject({
      state: "managed",
      body: "Migrated body",
      reference: { documentId: oldId },
      metadata: { psozhId: oldId, tags: ["migration"] }
    });
    expect(storage.memory.rawFile("Migrated.md")).toContain(`psozh-id: ${JSON.stringify(oldId)}`);
  });

  it("preserves raw frontmatter exactly during an ordinary body update", async () => {
    const source = "\uFEFF---\r\npsozh-id: \"managed-id\"\r\n# comment\r\nunknown:  keep\r\ntags: [one]\r\n---\r\nOld body";
    const storage = adapter({ files: { "Managed.md": source } });
    const original = byPath((await storage.scan()).documents, "Managed.md");
    const rawPrefix = source.slice(0, source.indexOf("Old body"));

    const updated = valueOf(await storage.updateDocument({
      reference: original.reference,
      body: "New body\r\nSecond line"
    }));

    expect(storage.memory.rawFile("Managed.md")).toBe(`${rawPrefix}New body\r\nSecond line`);
    expect(updated).toMatchObject({
      body: "New body\r\nSecond line",
      metadata: { psozhId: "managed-id", tags: ["one"] }
    });
  });

  it("blocks metadata mutation for malformed frontmatter but still permits a safe body update", async () => {
    const source = "---\ntags: { nested: true }\n---\nOld body";
    const storage = adapter({ files: { "Malformed.md": source } });
    const malformed = byPath((await storage.scan()).documents, "Malformed.md");

    const metadataResult = await storage.updateDocument({
      reference: malformed.reference,
      tags: ["safe"]
    });
    const bodyResult = await storage.updateDocument({
      reference: malformed.reference,
      body: "New body"
    });

    expect(metadataResult).toMatchObject({ status: "error", code: "malformed-frontmatter" });
    expect(bodyResult).toMatchObject({ status: "ok", value: { body: "New body" } });
    expect(storage.memory.rawFile("Malformed.md")).toBe(
      "---\ntags: { nested: true }\n---\nNew body"
    );
  });

  it("gives a conflict copy a new managed ID and leaves the source untouched", async () => {
    const ids = ["conflict-copy-id"];
    const source = managedMarkdown("source-id", "Source body");
    const storage = adapter({
      files: { "Source.md": source },
      createId: () => ids.shift() ?? "unexpected-id"
    });
    const original = byPath((await storage.scan()).documents, "Source.md");

    const copy = valueOf(await storage.saveConflictCopy({
      reference: original.reference,
      body: "Conflicting draft"
    }));

    expect(copy).toMatchObject({
      state: "managed",
      body: "Conflicting draft",
      metadata: { psozhId: "conflict-copy-id" },
      reference: { documentId: "conflict-copy-id" }
    });
    expect(copy.reference.documentId).not.toBe(original.reference.documentId);
    expect(storage.memory.rawFile("Source.md")).toBe(source);
  });
});
