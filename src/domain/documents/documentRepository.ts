import type { DashboardState, Note, NoteUpdate } from "../../types";
import {
  createTextBlock,
  ObjectGraphError,
  type UniversalObject
} from "../objects/objectGraph";
import {
  documentFromNativeObject,
  documentFromNote,
  documentFromReadingItem,
  documentDraftToNoteDraft,
  hasSimpleDocumentContent,
  noteDocumentId,
  resolveDocument,
  type DocumentDraft,
  type DocumentId,
  type DocumentLookupResult,
  type DocumentPatch,
  type DocumentRecord,
  type DocumentSource
} from "./documentContract";

type DocumentState = Pick<DashboardState, "notes" | "readingItems" | "objectGraph">;
type NativeObjectPatch = Partial<Pick<UniversalObject, "title" | "blocks" | "properties" | "status">>;

export interface DocumentRepositoryDependencies {
  /** Returns the current canonical snapshot for every repository operation. */
  readonly getState: () => DocumentState;
  /** Existing canonical creation command; it owns Note identity and activity logging. */
  readonly addNote: (draft: ReturnType<typeof documentDraftToNoteDraft>) => Note;
  /** Existing canonical Note command; it owns Note revisions and side effects. */
  readonly updateNote: (id: string, changes: NoteUpdate) => void;
  /** Existing canonical native-object command; it owns revision checks and history. */
  readonly updateNativeObject: (
    id: string,
    expectedRevision: number,
    changes: NativeObjectPatch
  ) => void;
  /** Existing canonical commands; they own trash snapshots, relations and activity logging. */
  readonly removeNote: (id: string) => void;
  readonly removeNativeObject: (id: string) => void;
}

export type DocumentCreateResult =
  | { readonly status: "created"; readonly id: DocumentId; readonly document: DocumentRecord }
  | { readonly status: "command-rejected"; readonly message: string };

/** Accepted means the current canonical delete command accepted the routed request. */
export type DocumentDeleteResult =
  | { readonly status: "accepted"; readonly id: DocumentId }
  | { readonly status: "not-found"; readonly id: DocumentId }
  | { readonly status: "not-document"; readonly id: DocumentId }
  | { readonly status: "invalid-id"; readonly reference: string }
  | { readonly status: "read-only"; readonly id: DocumentId }
  | { readonly status: "command-rejected"; readonly id: DocumentId; readonly message: string };

export type DocumentUpdateResult =
  | { readonly status: "accepted"; readonly id: DocumentId; readonly source: DocumentSource }
  | { readonly status: "not-found"; readonly id: DocumentId; readonly source: DocumentSource }
  | { readonly status: "not-document"; readonly id: DocumentId; readonly source: Extract<DocumentSource, { kind: "native" }> }
  | { readonly status: "invalid-id"; readonly reference: string }
  | { readonly status: "read-only"; readonly id: DocumentId; readonly source: Extract<DocumentSource, { kind: "material" }> }
  | { readonly status: "structured-content"; readonly id: DocumentId; readonly source: Extract<DocumentSource, { kind: "native" }> }
  | { readonly status: "unsupported-field"; readonly id: DocumentId; readonly field: "projectId" }
  | { readonly status: "revision-conflict"; readonly id: DocumentId; readonly source: Extract<DocumentSource, { kind: "native" }> }
  | { readonly status: "command-rejected"; readonly id: DocumentId; readonly message: string };

export interface DocumentRepository {
  getDocument(reference: string): DocumentLookupResult;
  listDocuments(): readonly DocumentRecord[];
  createDocument(draft: DocumentDraft): DocumentCreateResult;
  updateDocument(id: DocumentId, patch: DocumentPatch): DocumentUpdateResult;
  deleteDocument(id: DocumentId): DocumentDeleteResult;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function noteUpdateFromPatch(patch: DocumentPatch): NoteUpdate {
  const changes: NoteUpdate = {};
  if (typeof patch.title === "string") changes.title = patch.title;
  if (typeof patch.content === "string") changes.body = patch.content;
  if (Array.isArray(patch.tags)) changes.tags = [...patch.tags];
  if (typeof patch.pinned === "boolean") changes.pinned = patch.pinned;
  if (patch.projectId === null || typeof patch.projectId === "string") {
    changes.projectId = patch.projectId;
  }
  return changes;
}

function simpleTextBlocks(object: UniversalObject, content: string) {
  return object.blocks.length
    ? [{ ...object.blocks[0], text: content }]
    : [createTextBlock(content)];
}

function commandMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Каноническая команда отклонила операцию с документом.";
}

function updateFailure(
  error: unknown,
  id: DocumentId,
  source: DocumentSource
): DocumentUpdateResult {
  if (error instanceof ObjectGraphError && error.code === "revision_conflict" && source.kind === "native") {
    return { status: "revision-conflict", id, source };
  }
  return { status: "command-rejected", id, message: commandMessage(error) };
}

function updateLookupFailure(result: Exclude<DocumentLookupResult, { readonly status: "found" }>): DocumentUpdateResult {
  if (result.status === "not-found") return result;
  if (result.status === "not-document") return result;
  return result;
}

function deleteLookupFailure(
  result: Exclude<DocumentLookupResult, { readonly status: "found" }>
): DocumentDeleteResult {
  if (result.status === "invalid-id") return result;
  if (result.status === "not-document") return { status: "not-document", id: result.id };
  return { status: "not-found", id: result.id };
}

/**
 * Transitional application repository over existing canonical document sources.
 * It computes DocumentRecord values and routes writes to existing commands; it
 * never persists a second document representation or mutates a state snapshot.
 */
export function createDocumentRepository(
  dependencies: DocumentRepositoryDependencies
): DocumentRepository {
  const getDocument = (reference: string): DocumentLookupResult =>
    resolveDocument(dependencies.getState(), reference);

  const createDocument = (draft: DocumentDraft): DocumentCreateResult => {
    try {
      const note = dependencies.addNote(documentDraftToNoteDraft(draft));
      return {
        status: "created",
        id: noteDocumentId(note.id),
        document: documentFromNote(note)
      };
    } catch (error) {
      return { status: "command-rejected", message: commandMessage(error) };
    }
  };

  const listDocuments = (): readonly DocumentRecord[] => {
    const state = dependencies.getState();
    return [
      ...state.notes.map(documentFromNote),
      ...state.objectGraph.objects
        .filter((object) =>
          object.roles.includes("document") &&
          object.status !== "archived" &&
          object.status !== "deleted"
        )
        .flatMap((object) => {
          const document = documentFromNativeObject(object);
          return document ? [document] : [];
        }),
      ...state.readingItems.map(documentFromReadingItem)
    ];
  };

  const updateDocument = (id: DocumentId, patch: DocumentPatch): DocumentUpdateResult => {
    const state = dependencies.getState();
    const resolved = resolveDocument(state, id);
    if (resolved.status !== "found") return updateLookupFailure(resolved);

    const document = resolved.document;
    if (document.source.kind === "material") {
      return { status: "read-only", id, source: document.source };
    }

    if (document.source.kind === "note") {
      try {
        dependencies.updateNote(document.source.entityId, noteUpdateFromPatch(patch));
        return { status: "accepted", id, source: document.source };
      } catch (error) {
        return updateFailure(error, id, document.source);
      }
    }

    if (hasOwn(patch, "projectId") && patch.projectId !== undefined) {
      return { status: "unsupported-field", id, field: "projectId" };
    }

    const object = state.objectGraph.objects.find((entry) => entry.id === document.source.entityId);
    if (!object) return { status: "not-found", id, source: document.source };

    if (typeof patch.content === "string" && !hasSimpleDocumentContent(object)) {
      return { status: "structured-content", id, source: document.source };
    }

    const changes: NativeObjectPatch = {};
    if (typeof patch.title === "string") changes.title = patch.title;
    if (typeof patch.content === "string") changes.blocks = simpleTextBlocks(object, patch.content);

    if (Array.isArray(patch.tags) || typeof patch.pinned === "boolean") {
      changes.properties = {
        ...object.properties,
        ...(Array.isArray(patch.tags) ? { "document.tags": [...patch.tags] } : {}),
        ...(typeof patch.pinned === "boolean" ? { "document.pinned": patch.pinned } : {})
      };
    }

    if (Object.keys(changes).length === 0) {
      return { status: "accepted", id, source: document.source };
    }

    try {
      dependencies.updateNativeObject(object.id, object.revision, changes);
      return { status: "accepted", id, source: document.source };
    } catch (error) {
      return updateFailure(error, id, document.source);
    }
  };

  const deleteDocument = (id: DocumentId): DocumentDeleteResult => {
    const resolved = resolveDocument(dependencies.getState(), id);
    if (resolved.status !== "found") return deleteLookupFailure(resolved);

    const document = resolved.document;
    if (document.source.kind === "material") return { status: "read-only", id };

    try {
      if (document.source.kind === "note") {
        dependencies.removeNote(document.source.entityId);
      } else {
        dependencies.removeNativeObject(document.source.entityId);
      }
      return { status: "accepted", id };
    } catch (error) {
      return { status: "command-rejected", id, message: commandMessage(error) };
    }
  };

  return { getDocument, listDocuments, createDocument, updateDocument, deleteDocument };
}
