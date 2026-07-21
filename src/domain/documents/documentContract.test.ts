import { describe, expect, it } from "vitest";
import { createInitialState } from "../../data/seed";
import { noteTrashEntry } from "../safety/dataSafety";
import {
  createTextBlock,
  createUniversalObject,
  type UniversalObjectBlock
} from "../objects/objectGraph";
import { adaptLegacyObjects, legacyObjectReference } from "../objects/legacyAdapter";
import type { Note, ReadingItem } from "../../types";
import {
  documentDraftToNoteDraft,
  documentFromNativeObject,
  documentFromNote,
  documentFromReadingItem,
  materialDocumentId,
  nativeDocumentId,
  noteDocumentId,
  parseDocumentId,
  resolveDocument
} from "./documentContract";

const now = "2026-07-21T09:00:00.000Z";

function noteFixture(changes: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Наблюдение",
    body: "Полный текст заметки",
    projectId: "project-1",
    tags: ["мысль", "важно"],
    pinned: true,
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
    summary: "Краткое описание",
    body: "Основной текст",
    url: "https://example.com/article",
    source: "Пример",
    tags: ["чтение"],
    createdAt: now,
    ...changes
  };
}

describe("document application contract", () => {
  it("projects Note without losing text, title, tags, pin or project", () => {
    const note = noteFixture();

    const document = documentFromNote(note);

    expect(document).toMatchObject({
      id: noteDocumentId(note.id),
      source: { kind: "note", entityId: note.id },
      kind: "document",
      title: note.title,
      content: note.body,
      tags: note.tags,
      pinned: true,
      projectId: note.projectId,
      capabilities: {
        canEdit: true,
        canEditContent: true,
        canDelete: true,
        supportsSimpleTextEditing: true
      }
    });
    expect(note).toEqual(noteFixture());
  });

  it("projects a simple native document as safely editable", () => {
    const object = createUniversalObject({
      id: "native-document",
      roles: ["document"],
      title: "Нативный текст",
      blocks: [createTextBlock("Содержание", "block-1")],
      properties: { "document.tags": ["native"], "document.pinned": true }
    }, { now });

    const document = documentFromNativeObject(object);

    expect(document).toMatchObject({
      id: nativeDocumentId(object.id),
      source: { kind: "native", entityId: object.id },
      content: "Содержание",
      tags: ["native"],
      pinned: true,
      contentStructure: { kind: "plain-text", blockCount: 1 },
      capabilities: {
        canEditContent: true,
        supportsSimpleTextEditing: true
      }
    });
  });

  it("does not mark multiblock or non-text native content safe for the simple editor", () => {
    const imageBlock: UniversalObjectBlock = {
      id: "image-1",
      type: "image",
      text: "Иллюстрация",
      url: "https://example.com/image.png",
      checked: null,
      metadata: {}
    };
    const structured = createUniversalObject({
      id: "structured-document",
      roles: ["document"],
      blocks: [
        { ...createTextBlock("Раздел", "heading-1"), type: "heading" },
        createTextBlock("Абзац", "text-1")
      ]
    }, { now });
    const nonText = createUniversalObject({
      id: "image-document",
      roles: ["document"],
      blocks: [imageBlock]
    }, { now });

    for (const object of [structured, nonText]) {
      const document = documentFromNativeObject(object);
      expect(document?.contentStructure.kind).toBe("structured");
      expect(document?.capabilities).toMatchObject({
        canEdit: true,
        canEditTitle: true,
        canEditContent: false,
        supportsSimpleTextEditing: false
      });
    }
  });

  it("projects ReadingItem as a read-only material document", () => {
    const item = materialFixture();

    const document = documentFromReadingItem(item);

    expect(document).toMatchObject({
      id: materialDocumentId(item.id),
      source: { kind: "material", entityId: item.id },
      kind: "material",
      title: item.title,
      content: "Краткое описание\n\nОсновной текст",
      tags: item.tags,
      capabilities: {
        canEdit: false,
        canEditTitle: false,
        canEditContent: false,
        canEditMetadata: false,
        canDelete: false,
        supportsSimpleTextEditing: false
      }
    });
  });

  it("keeps document ids tied to one source without creating a source copy", () => {
    const note = noteFixture();
    const state = createInitialState();
    state.notes.push(note);
    const object = createUniversalObject({
      id: "native-document",
      roles: ["document"],
      blocks: [createTextBlock("До")]
    }, { now });
    const noteDocument = documentFromNote(note);
    const nativeDocument = documentFromNativeObject(object);

    expect(parseDocumentId(noteDocument.id)?.source).toEqual({ kind: "note", entityId: note.id });
    expect(parseDocumentId(nativeDocument!.id)?.source).toEqual({ kind: "native", entityId: object.id });
    expect(noteDocument.source).not.toHaveProperty("entity");
    expect(nativeDocument?.source).not.toHaveProperty("entity");
    expect(object.blocks[0].text).toBe("До");
    const legacyProjection = adaptLegacyObjects(state).objects.find(
      (entry) => entry.id === noteDocument.id
    );
    expect(legacyProjection).toBeDefined();
    expect(documentFromNativeObject(legacyProjection!)).toBeNull();
  });

  it("keeps ordinary document creation targeted at Note", () => {
    const noteDraft = documentDraftToNoteDraft({
      title: "Новый документ",
      content: "Текст",
      tags: ["черновик"],
      pinned: true,
      projectId: "project-1"
    });

    expect(noteDraft).toEqual({
      title: "Новый документ",
      body: "Текст",
      tags: ["черновик"],
      pinned: true,
      projectId: "project-1"
    });
  });

  it("preserves all Note document data through the current trash snapshot", () => {
    const note = noteFixture();
    const before = documentFromNote(note);
    const trash = noteTrashEntry(note, "2026-07-21T10:00:00.000Z", "trash-1");

    expect(trash.snapshot.kind).toBe("note");
    if (trash.snapshot.kind !== "note") throw new Error("Expected Note trash snapshot");
    const restored = documentFromNote(trash.snapshot.note);

    expect(restored).toEqual(before);
  });

  it("converts current route ids and legacy ids to DocumentId without changing them", () => {
    const noteReference = legacyObjectReference("note", "заметка/1");
    const materialReference = legacyObjectReference("reading", "материал:1");

    expect(parseDocumentId(noteReference)).toEqual({
      id: noteReference,
      source: { kind: "note", entityId: "заметка/1" }
    });
    expect(parseDocumentId(materialReference)).toEqual({
      id: materialReference,
      source: { kind: "material", entityId: "материал:1" }
    });
    expect(parseDocumentId("native-document")?.id).toBe("native-document");
  });

  it("does not merge distinct physical sources that reuse the same raw id", () => {
    const sharedId = "shared-id";
    const note = noteFixture({ id: sharedId });
    const object = createUniversalObject({
      id: sharedId,
      roles: ["document"],
      blocks: [createTextBlock("Нативное содержание")]
    }, { now });

    expect(documentFromNote(note).id).toBe(legacyObjectReference("note", sharedId));
    expect(documentFromNativeObject(object)?.id).toBe(sharedId);
    expect(documentFromNote(note).id).not.toBe(documentFromNativeObject(object)?.id);
  });

  it("reports invalid, missing and non-document sources without fabricating a document", () => {
    const state = createInitialState();
    const nativeTask = createUniversalObject({
      id: "native-task",
      roles: ["task"],
      title: "Не документ"
    }, { now });
    state.objectGraph.objects.push(nativeTask);

    expect(resolveDocument(state, legacyObjectReference("task", state.tasks[0].id)))
      .toEqual({
        status: "invalid-id",
        reference: legacyObjectReference("task", state.tasks[0].id)
      });
    expect(resolveDocument(state, noteDocumentId("missing-note"))).toEqual({
      status: "not-found",
      id: noteDocumentId("missing-note"),
      source: { kind: "note", entityId: "missing-note" }
    });
    expect(resolveDocument(state, "native-task")).toEqual({
      status: "not-document",
      id: "native-task",
      source: { kind: "native", entityId: "native-task" }
    });
    expect(resolveDocument(state, "")).toEqual({ status: "invalid-id", reference: "" });
  });
});
