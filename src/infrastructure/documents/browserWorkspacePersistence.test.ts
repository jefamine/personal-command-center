import { describe, expect, it } from "vitest";
import { nativeDocumentId } from "../../domain/documents/documentContract";
import type {
  DocumentScanResult,
  DocumentWorkspaceDescriptor
} from "../../domain/documents/workspace/documentWorkspaceContract";
import {
  BROWSER_WORKSPACE_STORES,
  BrowserWorkspacePersistence,
  createBrowserWorkspacePersistence,
  documentWorkspaceIndexFromScan,
  type BrowserWorkspacePersistencePort,
  type BrowserWorkspaceStoreName,
  type PersistedDocumentWorkspaceIndex
} from "./browserWorkspacePersistence";

class MemoryPersistencePort implements BrowserWorkspacePersistencePort {
  private readonly values = new Map<string, unknown>();

  private key(store: BrowserWorkspaceStoreName, key: string): string {
    return `${store}\u0000${key}`;
  }

  async get(store: BrowserWorkspaceStoreName, key: string): Promise<unknown> {
    return this.values.get(this.key(store, key));
  }

  async put(store: BrowserWorkspaceStoreName, key: string, value: unknown): Promise<void> {
    this.values.set(this.key(store, key), value);
  }

  async delete(store: BrowserWorkspaceStoreName, key: string): Promise<void> {
    this.values.delete(this.key(store, key));
  }

  peek(store: BrowserWorkspaceStoreName, key: string): unknown {
    return this.values.get(this.key(store, key));
  }
}

const descriptor: DocumentWorkspaceDescriptor = {
  mode: "external-folder",
  workspaceId: "workspace-1",
  displayName: "Тестовое пространство",
  handleKey: "handle-1",
  access: "granted",
  lastScanAt: "2026-07-22T04:00:00.000Z",
  vaultName: "Тестовый vault",
  vaultRelativeRoot: "ПСОЖ"
};

const summary = {
  folders: 1,
  markdownFiles: 1,
  managedFiles: 1,
  unmanagedFiles: 0,
  malformedFrontmatter: 0,
  duplicateIds: 0,
  pathCollisions: 0,
  unreadableFiles: 0
} as const;

function scanFixture(): DocumentScanResult {
  return {
    workspaceId: "workspace-1",
    scannedAt: "2026-07-22T04:00:00.000Z",
    folders: ["Личное"],
    documents: [{
      reference: {
        workspaceId: "workspace-1",
        relativePath: "Личное/Мысль.md",
        documentId: nativeDocumentId("managed-1")!
      },
      fileName: "Мысль.md",
      title: "Мысль",
      extension: ".md",
      size: 128,
      lastModified: 1_753_159_200_000,
      contentHash: "a".repeat(64),
      rawFrontmatter: "---\npsozh-id: managed-1\nsecret: do-not-cache\n---\n",
      body: "Канонический секретный текст находится только в файле.",
      metadata: {
        psozhId: "managed-1",
        tags: ["личное"],
        aliases: ["Мысль дня"]
      },
      state: "managed"
    }],
    errors: [],
    summary
  };
}

function directoryHandle(name = "Тестовая папка"): FileSystemDirectoryHandle {
  const handle = {
    kind: "directory",
    name,
    getDirectoryHandle: async () => handle,
    getFileHandle: async () => { throw new Error("Not used in persistence tests."); }
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

describe("browser document workspace persistence", () => {
  it("stores the portable descriptor independently from the directory handle", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const handle = directoryHandle();

    await persistence.saveDescriptor(descriptor);
    await persistence.saveDirectoryHandle(descriptor.handleKey!, handle);

    expect(await persistence.loadDescriptor()).toEqual(descriptor);
    expect(await persistence.loadDirectoryHandle("handle-1")).toBe(handle);
    expect(JSON.stringify(port.peek(BROWSER_WORKSPACE_STORES.descriptors, "active-workspace")))
      .not.toContain("getDirectoryHandle");
    expect(port.peek(BROWSER_WORKSPACE_STORES.handles, "handle-1")).toBe(handle);
  });

  it("persists only a metadata projection and never canonical body or raw frontmatter", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const scan = scanFixture();

    const index = documentWorkspaceIndexFromScan(scan);
    await persistence.saveScanIndex(scan);
    const loaded = await persistence.loadIndex(scan.workspaceId);

    expect(index.documents[0]).toEqual({
      documentId: nativeDocumentId("managed-1"),
      relativePath: "Личное/Мысль.md",
      fileName: "Мысль.md",
      title: "Мысль",
      extension: ".md",
      size: 128,
      lastModified: 1_753_159_200_000,
      contentHash: "a".repeat(64),
      psozhId: "managed-1",
      tags: ["личное"],
      aliases: ["Мысль дня"],
      state: "managed"
    });
    expect(loaded).toEqual(index);
    const persisted = JSON.stringify(port.peek(BROWSER_WORKSPACE_STORES.indexes, scan.workspaceId));
    expect(persisted).not.toContain("Канонический секретный текст");
    expect(persisted).not.toContain("secret: do-not-cache");
    expect(index.documents[0]).not.toHaveProperty("body");
    expect(index.documents[0]).not.toHaveProperty("rawFrontmatter");
  });

  it("copies arrays so caller mutations cannot rewrite the saved metadata", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const scan = scanFixture();
    const index = documentWorkspaceIndexFromScan(scan);

    await persistence.saveIndex(index);
    (scan.folders as string[]).push("Поздняя папка");
    (scan.documents[0].metadata.tags as string[]).push("поздний-тег");
    const firstLoad = await persistence.loadIndex(scan.workspaceId);
    (firstLoad?.folders as string[]).push("Изменение результата");
    (firstLoad?.documents[0].tags as string[]).push("изменение-результата");

    const secondLoad = await persistence.loadIndex(scan.workspaceId);
    expect(secondLoad?.folders).toEqual(["Личное"]);
    expect(secondLoad?.documents[0].tags).toEqual(["личное"]);
  });

  it("disconnects to internal mode without deleting handle, index or stable mapping", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const handle = directoryHandle();
    await persistence.saveDescriptor(descriptor);
    await persistence.saveDirectoryHandle("handle-1", handle);
    await persistence.saveScanIndex(scanFixture());

    const disconnected = await persistence.disconnectWorkspace();

    expect(disconnected).toEqual({
      ...descriptor,
      mode: "internal",
      access: "disconnected"
    });
    expect(await persistence.loadDirectoryHandle("handle-1")).toBe(handle);
    expect((await persistence.loadIndex("workspace-1"))?.documents[0]).toMatchObject({
      documentId: nativeDocumentId("managed-1"),
      relativePath: "Личное/Мысль.md",
      psozhId: "managed-1"
    });
  });

  it("can explicitly forget only the handle while retaining reconnect mapping", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    await persistence.saveDescriptor(descriptor);
    await persistence.saveDirectoryHandle("handle-1", directoryHandle());
    await persistence.saveScanIndex(scanFixture());

    await persistence.disconnectWorkspace({ removeHandle: true });

    expect(await persistence.loadDirectoryHandle("handle-1")).toBeNull();
    expect(await persistence.loadIndex("workspace-1")).not.toBeNull();
    expect(await persistence.loadDescriptor()).toMatchObject({
      mode: "internal",
      workspaceId: "workspace-1",
      handleKey: "handle-1",
      access: "disconnected"
    });
  });

  it("treats corrupted descriptor, handle and index values as unavailable without deleting them", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    await port.put(BROWSER_WORKSPACE_STORES.descriptors, "active-workspace", {
      schemaVersion: 99,
      descriptor
    });
    await port.put(BROWSER_WORKSPACE_STORES.handles, "broken", { kind: "directory", name: "Нет методов" });
    await port.put(BROWSER_WORKSPACE_STORES.indexes, "workspace-1", {
      schemaVersion: 1,
      workspaceId: "workspace-1",
      scannedAt: "now",
      folders: [],
      documents: [{ body: "unexpected canonical copy" }],
      errors: [],
      summary
    });

    expect(await persistence.loadDescriptor()).toBeNull();
    expect(await persistence.loadDirectoryHandle("broken")).toBeNull();
    expect(await persistence.loadIndex("workspace-1")).toBeNull();
    expect(port.peek(BROWSER_WORKSPACE_STORES.indexes, "workspace-1")).toBeDefined();
  });

  it("rejects an invalid index instead of persisting a partial projection", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const invalid = {
      ...documentWorkspaceIndexFromScan(scanFixture()),
      workspaceId: ""
    } as PersistedDocumentWorkspaceIndex;

    await expect(persistence.saveIndex(invalid)).rejects.toThrow("index is invalid");
    expect(port.peek(BROWSER_WORKSPACE_STORES.indexes, "")).toBeUndefined();
  });

  it("rejects an index whose workspace id does not match its persistence key", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const mismatched = {
      ...documentWorkspaceIndexFromScan(scanFixture()),
      workspaceId: "workspace-2"
    };
    await port.put(BROWSER_WORKSPACE_STORES.indexes, "workspace-1", mismatched);

    expect(await persistence.loadIndex("workspace-1")).toBeNull();
    expect(port.peek(BROWSER_WORKSPACE_STORES.indexes, "workspace-1")).toBe(mismatched);
  });

  it("rejects invalid, non-canonical and ignored paths in a persisted index", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const base = documentWorkspaceIndexFromScan(scanFixture());
    const document = base.documents[0];
    const invalidIndexes: readonly unknown[] = [
      {
        ...base,
        documents: [{
          ...document,
          relativePath: "Personal\\Thought.md",
          fileName: "Thought.md"
        }]
      },
      {
        ...base,
        documents: [{
          ...document,
          relativePath: ".obsidian/Thought.md",
          fileName: "Thought.md"
        }]
      },
      { ...base, folders: ["../outside"] },
      { ...base, folders: [".psozh/trash"] }
    ];

    for (const invalid of invalidIndexes) {
      await port.put(BROWSER_WORKSPACE_STORES.indexes, "workspace-1", invalid);
      expect(await persistence.loadIndex("workspace-1")).toBeNull();
    }
  });

  it("rejects invalid content hashes, scan dates and psozh ids", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const base = documentWorkspaceIndexFromScan(scanFixture());
    const document = base.documents[0];
    const invalidIndexes: readonly unknown[] = [
      {
        ...base,
        documents: [{ ...document, contentHash: "not-a-sha-256" }]
      },
      { ...base, scannedAt: "not-a-date" },
      {
        ...base,
        documents: [{ ...document, psozhId: " managed-1 " }]
      }
    ];

    for (const invalid of invalidIndexes) {
      await port.put(BROWSER_WORKSPACE_STORES.indexes, "workspace-1", invalid);
      expect(await persistence.loadIndex("workspace-1")).toBeNull();
    }
  });

  it("refuses to save an invalid descriptor", async () => {
    const port = new MemoryPersistencePort();
    const persistence = new BrowserWorkspacePersistence(port);
    const invalid = {
      ...descriptor,
      access: "unexpected-access-state"
    } as unknown as DocumentWorkspaceDescriptor;

    await expect(persistence.saveDescriptor(invalid)).rejects.toThrow("descriptor is invalid");
    expect(port.peek(BROWSER_WORKSPACE_STORES.descriptors, "active-workspace")).toBeUndefined();
  });

  it("reports unsupported persistence when IndexedDB is unavailable", () => {
    expect(createBrowserWorkspacePersistence(null)).toBeNull();
  });
});
