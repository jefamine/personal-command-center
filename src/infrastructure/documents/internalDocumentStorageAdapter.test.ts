import { describe, expect, it } from "vitest";
import type { Note, ReadingItem } from "../../types";
import {
  documentFromNote,
  documentFromReadingItem,
  noteDocumentId,
  type DocumentId,
  type DocumentLookupResult,
  type DocumentPatch,
  type DocumentRecord
} from "../../domain/documents/documentContract";
import type {
  DocumentCreateResult,
  DocumentDeleteResult,
  DocumentRepository,
  DocumentUpdateResult
} from "../../domain/documents/documentRepository";
import { workspacePathCollisionKey } from "../../domain/documents/workspace/workspacePaths";
import {
  createInternalDocumentStorageAdapter,
  DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID
} from "./internalDocumentStorageAdapter";

const now = "2026-07-22T12:00:00.000Z";
const later = "2026-07-22T12:05:00.000Z";

function note(id: string, title: string, body = "", tags: readonly string[] = []): DocumentRecord {
  const value: Note = {
    id,
    title,
    body,
    projectId: null,
    tags: [...tags],
    pinned: false,
    contentUpdatedAt: now,
    reflection: null,
    createdAt: now,
    updatedAt: now
  };
  return documentFromNote(value);
}

function material(id: string, title: string, body = ""): DocumentRecord {
  const value: ReadingItem = {
    id,
    title,
    summary: "",
    body,
    url: "",
    source: "",
    tags: [],
    createdAt: now
  };
  return documentFromReadingItem(value);
}

interface RepositoryHarness {
  readonly repository: DocumentRepository;
  readonly createCalls: Array<{ readonly title: string; readonly content?: string; readonly tags?: readonly string[] }>;
  readonly updateCalls: Array<{ readonly id: DocumentId; readonly patch: DocumentPatch }>;
  readonly deleteCalls: DocumentId[];
  readonly documents: () => readonly DocumentRecord[];
}

function missingLookup(reference: string): DocumentLookupResult {
  const id = reference as DocumentId;
  return {
    status: "not-found",
    id,
    source: { kind: "native", entityId: reference }
  };
}

function repositoryHarness(initial: readonly DocumentRecord[]): RepositoryHarness {
  let documents = [...initial];
  let created = 0;
  const createCalls: RepositoryHarness["createCalls"] = [];
  const updateCalls: RepositoryHarness["updateCalls"] = [];
  const deleteCalls: DocumentId[] = [];

  const getDocument = (reference: string): DocumentLookupResult => {
    const document = documents.find((entry) => entry.id === reference);
    return document ? { status: "found", document } : missingLookup(reference);
  };

  const repository: DocumentRepository = {
    getDocument,
    listDocuments: () => documents,
    createDocument: (draft): DocumentCreateResult => {
      createCalls.push({
        title: draft.title,
        ...(draft.content !== undefined ? { content: draft.content } : {}),
        ...(draft.tags !== undefined ? { tags: [...draft.tags] } : {})
      });
      created += 1;
      const document = note(`created-${created}`, draft.title, draft.content ?? "", draft.tags ?? []);
      documents = [...documents, document];
      return { status: "created", id: document.id, document };
    },
    updateDocument: (id, patch): DocumentUpdateResult => {
      const index = documents.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return {
          status: "not-found",
          id,
          source: { kind: "native", entityId: String(id) }
        };
      }
      const current = documents[index];
      if (current.kind === "material") {
        return { status: "read-only", id, source: current.source as Extract<typeof current.source, { kind: "material" }> };
      }
      updateCalls.push({ id, patch });
      const updated: DocumentRecord = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
        updatedAt: later
      };
      documents = documents.map((entry, entryIndex) => entryIndex === index ? updated : entry);
      return { status: "accepted", id, source: current.source };
    },
    deleteDocument: (id): DocumentDeleteResult => {
      const index = documents.findIndex((entry) => entry.id === id);
      if (index < 0) return { status: "not-found", id };
      if (documents[index].kind === "material") return { status: "read-only", id };
      deleteCalls.push(id);
      documents = documents.filter((entry) => entry.id !== id);
      return { status: "accepted", id };
    }
  };

  return {
    repository,
    createCalls,
    updateCalls,
    deleteCalls,
    documents: () => documents
  };
}

function adapterFor(harness: RepositoryHarness) {
  return createInternalDocumentStorageAdapter(harness.repository, {
    now: () => new Date(now)
  });
}

describe("internal document storage adapter", () => {
  it("scans disposable flat Markdown projections with stable ids and deterministic collision-safe paths", async () => {
    const source = [
      note("b", "Одинаково", "Второй"),
      note("a", " одинаково ", "Первый", ["мысль"]),
      note("reserved", "CON", "Служебное имя"),
      note("invalid", "Папка/тема: черновик.", "Текст")
    ];
    const harness = repositoryHarness(source);
    const adapter = adapterFor(harness);

    const first = await adapter.scan();
    const second = await adapter.scan();
    const paths = first.documents.map((document) => document.reference.relativePath);

    expect(first).toEqual(second);
    expect(first.workspaceId).toBe(DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID);
    expect(first.folders).toEqual([]);
    expect(first.errors).toEqual([]);
    expect(first.summary).toMatchObject({ markdownFiles: 4, managedFiles: 4, pathCollisions: 0 });
    expect(new Set(paths.map(workspacePathCollisionKey)).size).toBe(paths.length);
    expect(paths.every((path) => !path.includes("/") && path.endsWith(".md"))).toBe(true);
    expect(paths).toContain("_CON.md");
    expect(paths.some((path) => path.includes("Папка-тема- черновик"))).toBe(true);
    expect(first.documents.every((document) =>
      document.reference.documentId === document.metadata.psozhId &&
      document.reference.expectedContentHash === document.contentHash &&
      /^[a-f0-9]{64}$/u.test(document.contentHash)
    )).toBe(true);
    expect(harness.documents()).toEqual(source);
    expect(harness.createCalls).toEqual([]);
    expect(harness.updateCalls).toEqual([]);
  });

  it("reads through stable DocumentId without persisting the computed projection", async () => {
    const source = note("one", "Документ", "Текст", ["тег"]);
    const harness = repositoryHarness([source]);
    const adapter = adapterFor(harness);
    const scanned = (await adapter.scan()).documents[0];

    const result = await adapter.readDocument({
      ...scanned.reference,
      relativePath: "устаревшее-имя.md"
    });

    expect(result).toMatchObject({
      status: "ok",
      value: {
        title: "Документ",
        body: "Текст",
        rawFrontmatter: null,
        metadata: { tags: ["тег"], aliases: [] },
        reference: { documentId: source.id, relativePath: "Документ.md" }
      }
    });
    expect(harness.documents()).toEqual([source]);
  });

  it("creates an ordinary document only through DocumentRepository", async () => {
    const harness = repositoryHarness([]);
    const adapter = adapterFor(harness);
    const result = await adapter.createDocument({
      workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID,
      relativePath: "Новая заметка.md",
      body: "Текст",
      tags: ["черновик"]
    });

    expect(result).toMatchObject({
      status: "ok",
      value: {
        title: "Новая заметка",
        body: "Текст",
        reference: { documentId: noteDocumentId("created-1"), relativePath: "Новая заметка.md" }
      }
    });
    expect(harness.createCalls).toEqual([{
      title: "Новая заметка",
      content: "Текст",
      tags: ["черновик"]
    }]);
  });

  it("rejects collisions, folders, supplied ids and aliases before canonical creation", async () => {
    const existing = note("one", "Заметка");
    const harness = repositoryHarness([existing]);
    const adapter = adapterFor(harness);
    const base = { workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID } as const;

    await expect(adapter.createDocument({ ...base, relativePath: "заметка.MD" }))
      .resolves.toMatchObject({ status: "error", code: "path-collision" });
    await expect(adapter.createDocument({ ...base, relativePath: "Папка/Новая.md" }))
      .resolves.toMatchObject({ status: "error", code: "unsupported" });
    await expect(adapter.createDocument({ ...base, relativePath: "Новая.md", documentId: existing.id }))
      .resolves.toMatchObject({ status: "error", code: "unsupported" });
    await expect(adapter.createDocument({ ...base, relativePath: "Новая.md", aliases: ["Псевдоним"] }))
      .resolves.toMatchObject({ status: "error", code: "unsupported" });
    expect(harness.createCalls).toEqual([]);
  });

  it("updates body and tags through the repository and rejects a stale hash", async () => {
    const source = note("one", "Документ", "Первая версия", ["старый"]);
    const harness = repositoryHarness([source]);
    const adapter = adapterFor(harness);
    const original = (await adapter.scan()).documents[0];

    const updated = await adapter.updateDocument({
      reference: original.reference,
      body: "Новая версия",
      tags: ["новый"]
    });
    expect(updated).toMatchObject({
      status: "ok",
      value: { body: "Новая версия", metadata: { tags: ["новый"] } }
    });
    if (updated.status !== "ok") throw new Error("Update must succeed.");
    expect(updated.value.contentHash).not.toBe(original.contentHash);
    expect(harness.updateCalls).toEqual([{
      id: source.id,
      patch: { content: "Новая версия", tags: ["новый"] }
    }]);

    await expect(adapter.updateDocument({ reference: original.reference, body: "Устаревшая запись" }))
      .resolves.toMatchObject({ status: "error", code: "external-modification", current: { body: "Новая версия" } });
    expect(harness.updateCalls).toHaveLength(1);
  });

  it("renames through the repository, keeps identity and blocks display-path collisions", async () => {
    const first = note("first", "Первый");
    const second = note("second", "Второй");
    const harness = repositoryHarness([first, second]);
    const adapter = adapterFor(harness);
    const scanned = await adapter.scan();
    const firstStored = scanned.documents.find((document) => document.reference.documentId === first.id)!;

    const renamed = await adapter.renameDocument({
      reference: firstStored.reference,
      nextFileName: "Новое имя.md"
    });
    expect(renamed).toMatchObject({
      status: "ok",
      value: { title: "Новое имя", reference: { documentId: first.id, relativePath: "Новое имя.md" } }
    });
    expect(harness.updateCalls[0]).toEqual({ id: first.id, patch: { title: "Новое имя" } });

    if (renamed.status !== "ok") throw new Error("Rename must succeed.");
    await expect(adapter.renameDocument({
      reference: renamed.value.reference,
      nextFileName: "ВТОРОЙ.md"
    })).resolves.toMatchObject({ status: "error", code: "path-collision" });
    expect(harness.updateCalls).toHaveLength(1);
  });

  it("deletes only through the repository after checking the content hash", async () => {
    const source = note("one", "Документ", "Текст");
    const harness = repositoryHarness([source]);
    const adapter = adapterFor(harness);
    const stored = (await adapter.scan()).documents[0];

    const result = await adapter.deleteDocument({ reference: stored.reference });

    expect(result).toMatchObject({
      status: "ok",
      value: {
        originalReference: stored.reference,
        deletedAt: now,
        contentHash: stored.contentHash,
        documentId: source.id
      }
    });
    expect(harness.deleteCalls).toEqual([source.id]);
    expect(harness.documents()).toEqual([]);
  });

  it("keeps read-only materials read-only", async () => {
    const source = material("reading", "Материал", "Текст");
    const harness = repositoryHarness([source]);
    const adapter = adapterFor(harness);
    const stored = (await adapter.scan()).documents[0];

    await expect(adapter.updateDocument({ reference: stored.reference, body: "Нельзя" }))
      .resolves.toMatchObject({ status: "error", code: "unsupported" });
    await expect(adapter.deleteDocument({ reference: stored.reference }))
      .resolves.toMatchObject({ status: "error", code: "unsupported" });
    expect(harness.updateCalls).toEqual([]);
    expect(harness.deleteCalls).toEqual([]);
  });

  it("treats stable internal identity as already managed", async () => {
    const source = note("one", "Документ");
    const harness = repositoryHarness([source]);
    const adapter = adapterFor(harness);
    const stored = (await adapter.scan()).documents[0];

    await expect(adapter.makeDocumentManaged({ reference: stored.reference }))
      .resolves.toMatchObject({ status: "ok", value: { reference: { documentId: source.id } } });
    await expect(adapter.makeDocumentManaged({
      reference: stored.reference,
      documentId: noteDocumentId("different")
    })).resolves.toMatchObject({ status: "error", code: "unsupported" });
  });

  it("reports filesystem-only operations as unsupported without touching the repository", async () => {
    const source = note("one", "Документ");
    const harness = repositoryHarness([source]);
    const adapter = adapterFor(harness);
    const stored = (await adapter.scan()).documents[0];

    const results = await Promise.all([
      adapter.moveDocument({ reference: stored.reference, destinationFolder: "Папка" }),
      adapter.restoreDocument({ workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID, tombstoneId: "missing" }),
      adapter.saveConflictCopy({ reference: stored.reference, body: "Моя версия" }),
      adapter.purgeDocument({ workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID, tombstoneId: "missing" }),
      adapter.createFolder({ workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID, relativePath: "Папка" }),
      adapter.renameFolder({ workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID, relativePath: "Папка", nextName: "Новая" }),
      adapter.moveFolder({ workspaceId: DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID, relativePath: "Папка", destinationFolder: "Другая" })
    ]);

    expect(results.every((result) => result.status === "error" && result.code === "unsupported")).toBe(true);
    expect(harness.createCalls).toEqual([]);
    expect(harness.updateCalls).toEqual([]);
    expect(harness.deleteCalls).toEqual([]);
  });
});
