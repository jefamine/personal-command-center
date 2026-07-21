import { describe, expect, it } from "vitest";
import { createInitialState } from "../../data/seed";
import type { DashboardState, Note, NoteUpdate, ReadingItem } from "../../types";
import {
  createTextBlock,
  createUniversalObject,
  ObjectGraphError,
  type UniversalObject
} from "../objects/objectGraph";
import {
  materialDocumentId,
  nativeDocumentId,
  noteDocumentId,
  resolveDocument
} from "./documentContract";
import {
  createDocumentRepository,
  type DocumentRepositoryDependencies
} from "./documentRepository";

const now = "2026-07-21T09:00:00.000Z";

function noteFixture(changes: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Заметка",
    body: "Исходный текст",
    projectId: "project-1",
    tags: ["мысль"],
    pinned: false,
    contentUpdatedAt: now,
    reflection: null,
    createdAt: now,
    updatedAt: now,
    ...changes
  };
}

function materialFixture(changes: Partial<ReadingItem> = {}): ReadingItem {
  return {
    id: "reading-1",
    title: "Материал",
    summary: "Кратко",
    body: "Полный текст",
    url: "https://example.com/article",
    source: "Источник",
    tags: ["чтение"],
    createdAt: now,
    ...changes
  };
}

function stateFixture(): DashboardState {
  const state = createInitialState();
  return {
    ...state,
    notes: [],
    readingItems: [],
    objectGraph: { ...state.objectGraph, objects: [], relations: [] }
  };
}

function nativeFixture(changes: Partial<UniversalObject> = {}): UniversalObject {
  return {
    ...createUniversalObject({
      id: "native-1",
      roles: ["document"],
      title: "Нативный документ",
      blocks: [createTextBlock("Исходный текст", "text-block-1")],
      properties: {
        "document.tags": ["native"],
        "document.pinned": false,
        unrelated: "сохранить"
      }
    }, { now }),
    ...changes
  };
}

function repositoryFor(
  state: DashboardState,
  overrides: Partial<DocumentRepositoryDependencies> = {}
) {
  const noteUpdates: Array<{ id: string; changes: NoteUpdate }> = [];
  const nativeUpdates: Array<{
    id: string;
    expectedRevision: number;
    changes: Parameters<DocumentRepositoryDependencies["updateNativeObject"]>[2];
  }> = [];
  const dependencies: DocumentRepositoryDependencies = {
    getState: () => state,
    updateNote: (id, changes) => { noteUpdates.push({ id, changes }); },
    updateNativeObject: (id, expectedRevision, changes) => {
      nativeUpdates.push({ id, expectedRevision, changes });
    },
    ...overrides
  };
  return {
    repository: createDocumentRepository(dependencies),
    noteUpdates,
    nativeUpdates
  };
}

describe("transitional document repository", () => {
  it("lists one Note, native document and material without source copies", () => {
    const state = stateFixture();
    const note = noteFixture();
    const native = nativeFixture();
    const material = materialFixture();
    state.notes = [note];
    state.objectGraph.objects = [native];
    state.readingItems = [material];

    const documents = repositoryFor(state).repository.listDocuments();

    expect(documents.map((document) => document.id)).toEqual([
      noteDocumentId(note.id),
      nativeDocumentId(native.id),
      materialDocumentId(material.id)
    ]);
  });

  it("excludes native objects without the document role", () => {
    const state = stateFixture();
    state.objectGraph.objects = [nativeFixture({ roles: ["task"] })];

    expect(repositoryFor(state).repository.listDocuments()).toEqual([]);
  });

  it("excludes archived and deleted native documents", () => {
    const state = stateFixture();
    state.objectGraph.objects = [
      nativeFixture({ id: "archived", status: "archived", archivedAt: now }),
      nativeFixture({ id: "deleted", status: "deleted", deletedAt: now })
    ];

    expect(repositoryFor(state).repository.listDocuments()).toEqual([]);
  });

  it("returns the same lookup contract as resolveDocument", () => {
    const state = stateFixture();
    const note = noteFixture();
    state.notes = [note];
    const { repository } = repositoryFor(state);

    expect(repository.getDocument(noteDocumentId(note.id))).toEqual(
      resolveDocument(state, noteDocumentId(note.id))
    );
  });

  it("delegates a Note patch to the canonical Note command without overwriting omitted fields", () => {
    const state = stateFixture();
    const note = noteFixture();
    state.notes = [note];
    const { repository, noteUpdates } = repositoryFor(state);

    const result = repository.updateDocument(noteDocumentId(note.id), {
      title: "Новое название",
      content: "Новый текст",
      pinned: true,
      projectId: "project-2"
    });

    expect(result).toMatchObject({ status: "accepted", source: { kind: "note" } });
    expect(noteUpdates).toEqual([{
      id: note.id,
      changes: {
        title: "Новое название",
        body: "Новый текст",
        pinned: true,
        projectId: "project-2"
      }
    }]);
    expect(note).toEqual(noteFixture());
  });

  it("updates a simple native document without losing unrelated properties or its text block id", () => {
    const state = stateFixture();
    const native = nativeFixture();
    state.objectGraph.objects = [native];
    const { repository, nativeUpdates } = repositoryFor(state);

    const result = repository.updateDocument(nativeDocumentId(native.id)!, {
      title: "Новое название",
      content: "Новый текст",
      tags: ["обновлено"],
      pinned: true
    });

    expect(result).toMatchObject({ status: "accepted", source: { kind: "native" } });
    expect(nativeUpdates).toEqual([{
      id: native.id,
      expectedRevision: native.revision,
      changes: {
        title: "Новое название",
        blocks: [expect.objectContaining({ id: "text-block-1", text: "Новый текст" })],
        properties: {
          "document.tags": ["обновлено"],
          "document.pinned": true,
          unrelated: "сохранить"
        }
      }
    }]);
    expect(native.blocks[0].text).toBe("Исходный текст");
  });

  it("rejects text replacement for a structured native document without changing its blocks", () => {
    const state = stateFixture();
    const structured = nativeFixture({
      blocks: [
        { ...createTextBlock("Заголовок", "heading-1"), type: "heading" },
        createTextBlock("Абзац", "text-1")
      ]
    });
    state.objectGraph.objects = [structured];
    const { repository, nativeUpdates } = repositoryFor(state);

    expect(repository.updateDocument(nativeDocumentId(structured.id)!, { content: "Новый текст" }))
      .toMatchObject({ status: "structured-content" });
    expect(nativeUpdates).toEqual([]);
    expect(structured.blocks.map((block) => block.id)).toEqual(["heading-1", "text-1"]);
  });

  it("allows a structured native document title update", () => {
    const state = stateFixture();
    const structured = nativeFixture({
      blocks: [
        { ...createTextBlock("Заголовок", "heading-1"), type: "heading" },
        createTextBlock("Абзац", "text-1")
      ]
    });
    state.objectGraph.objects = [structured];
    const { repository, nativeUpdates } = repositoryFor(state);

    expect(repository.updateDocument(nativeDocumentId(structured.id)!, { title: "Новое имя" }))
      .toMatchObject({ status: "accepted" });
    expect(nativeUpdates[0]).toMatchObject({
      id: structured.id,
      changes: { title: "Новое имя" }
    });
  });

  it("rejects every material update as read-only", () => {
    const state = stateFixture();
    const material = materialFixture();
    state.readingItems = [material];
    const { repository, noteUpdates, nativeUpdates } = repositoryFor(state);

    expect(repository.updateDocument(materialDocumentId(material.id), { title: "Нельзя" }))
      .toMatchObject({ status: "read-only", source: { kind: "material" } });
    expect(noteUpdates).toEqual([]);
    expect(nativeUpdates).toEqual([]);
  });

  it("rejects projectId for a native document without hidden storage", () => {
    const state = stateFixture();
    const native = nativeFixture();
    state.objectGraph.objects = [native];
    const { repository, nativeUpdates } = repositoryFor(state);

    expect(repository.updateDocument(nativeDocumentId(native.id)!, { projectId: "project-1" }))
      .toEqual({ status: "unsupported-field", id: nativeDocumentId(native.id), field: "projectId" });
    expect(nativeUpdates).toEqual([]);
  });

  it("reports a missing document without creating or updating anything", () => {
    const state = stateFixture();
    const { repository, noteUpdates, nativeUpdates } = repositoryFor(state);

    expect(repository.updateDocument(noteDocumentId("missing"), { title: "Нет" }))
      .toMatchObject({ status: "not-found", source: { kind: "note", entityId: "missing" } });
    expect(noteUpdates).toEqual([]);
    expect(nativeUpdates).toEqual([]);
  });

  it("keeps physical sources with the same raw id as distinct documents", () => {
    const state = stateFixture();
    const note = noteFixture({ id: "shared" });
    const native = nativeFixture({ id: "shared" });
    state.notes = [note];
    state.objectGraph.objects = [native];

    const documents = repositoryFor(state).repository.listDocuments();

    expect(documents.map((document) => document.id)).toEqual([
      noteDocumentId("shared"),
      nativeDocumentId("shared")
    ]);
  });

  it("does not mutate the supplied snapshot while listing, reading or routing an update", () => {
    const state = stateFixture();
    const note = noteFixture();
    const native = nativeFixture();
    state.notes = [note];
    state.objectGraph.objects = [native];
    const before = JSON.stringify(state);
    const { repository } = repositoryFor(state);

    repository.listDocuments();
    repository.getDocument(noteDocumentId(note.id));
    repository.updateDocument(nativeDocumentId(native.id)!, { content: "Новый текст" });

    expect(JSON.stringify(state)).toBe(before);
  });

  it("surfaces a native revision conflict reported by the canonical command", () => {
    const state = stateFixture();
    const native = nativeFixture();
    state.objectGraph.objects = [native];
    const { repository } = repositoryFor(state, {
      updateNativeObject: () => {
        throw new ObjectGraphError("revision_conflict", "Объект уже изменён.");
      }
    });

    expect(repository.updateDocument(nativeDocumentId(native.id)!, { title: "Новое имя" }))
      .toMatchObject({ status: "revision-conflict", source: { kind: "native" } });
  });
});
