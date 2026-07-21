import type {
  DashboardState,
  Note,
  NoteDraft,
  ReadingItem
} from "../../types";
import {
  legacyObjectReference,
  parseLegacyObjectReference
} from "../objects/legacyAdapter";
import type {
  JsonValue,
  UniversalBlockType,
  UniversalObject
} from "../objects/objectGraph";

declare const documentIdBrand: unique symbol;

/**
 * Stable application identity of a document. At this transition stage its
 * runtime value is the existing catalog id, so current URLs do not change.
 */
export type DocumentId = string & { readonly [documentIdBrand]: "DocumentId" };

/**
 * Physical source of the canonical entity represented by a document record.
 * The application layer and a future document repository use it to route
 * operations to that canonical entity. React components must not choose their
 * behaviour from the physical source; user-facing behaviour is determined by
 * DocumentCapabilities and other domain properties instead.
 */
export type DocumentSource =
  | { readonly kind: "note"; readonly entityId: string }
  | { readonly kind: "native"; readonly entityId: string }
  | { readonly kind: "material"; readonly entityId: string };

export interface DocumentCapabilities {
  /** At least one part of the document can be changed through current domain commands. */
  readonly canEdit: boolean;
  readonly canEditTitle: boolean;
  readonly canEditContent: boolean;
  readonly canEditMetadata: boolean;
  readonly canEditProject: boolean;
  readonly canDelete: boolean;
  /** The current single-textarea editor can save the content without flattening blocks. */
  readonly supportsSimpleTextEditing: boolean;
}

export interface DocumentContentStructure {
  readonly kind: "plain-text" | "structured";
  readonly blockCount: number;
  readonly blockTypes: readonly UniversalBlockType[];
}

/**
 * Read model shared by the document workspace. It is a computed view of one
 * canonical source entity and is never persisted as a second document.
 */
export interface DocumentRecord {
  readonly id: DocumentId;
  readonly source: DocumentSource;
  readonly kind: "document" | "material";
  readonly title: string;
  /**
   * For a plain-text document this is the complete editable text content.
   * For a structured document it is only a text projection for reading,
   * searching, and previewing. The projection must never be written back in
   * place of the original structured blocks.
  */
  readonly content: string;
  readonly tags: readonly string[];
  /** Computed reflection facet; it is never persisted as separate document data. */
  readonly isReflection: boolean;
  readonly pinned: boolean;
  readonly projectId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contentStructure: DocumentContentStructure;
  readonly capabilities: DocumentCapabilities;
}

export interface DocumentDraft {
  title: string;
  content?: string;
  tags?: readonly string[];
  pinned?: boolean;
  projectId?: string | null;
}

export type DocumentPatch = Partial<
  Pick<DocumentRecord, "title" | "content" | "tags" | "pinned" | "projectId">
>;

export type DocumentLookupResult =
  | { readonly status: "found"; readonly document: DocumentRecord }
  | {
      readonly status: "not-found";
      readonly id: DocumentId;
      readonly source: DocumentSource;
    }
  | {
      readonly status: "not-document";
      readonly id: DocumentId;
      readonly source: Extract<DocumentSource, { kind: "native" }>;
    }
  | { readonly status: "invalid-id"; readonly reference: string };

const editableNoteCapabilities: DocumentCapabilities = {
  canEdit: true,
  canEditTitle: true,
  canEditContent: true,
  canEditMetadata: true,
  canEditProject: true,
  canDelete: true,
  supportsSimpleTextEditing: true
};

const editableNativeCapabilities: DocumentCapabilities = {
  canEdit: true,
  canEditTitle: true,
  canEditContent: true,
  canEditMetadata: true,
  canEditProject: false,
  canDelete: true,
  supportsSimpleTextEditing: true
};

const structuredNativeCapabilities: DocumentCapabilities = {
  canEdit: true,
  canEditTitle: true,
  canEditContent: false,
  canEditMetadata: true,
  canEditProject: false,
  canDelete: true,
  supportsSimpleTextEditing: false
};

const readOnlyMaterialCapabilities: DocumentCapabilities = {
  canEdit: false,
  canEditTitle: false,
  canEditContent: false,
  canEditMetadata: false,
  canEditProject: false,
  canDelete: false,
  supportsSimpleTextEditing: false
};

function asDocumentId(value: string): DocumentId {
  return value as DocumentId;
}

function stringArrayProperty(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function hasReflectionTag(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление");
}

function nativeContent(object: UniversalObject): string {
  return object.blocks
    .filter((block) => ["text", "heading", "quote"].includes(block.type))
    .map((block) => block.text)
    .join("\n\n");
}

export function hasSimpleDocumentContent(object: UniversalObject): boolean {
  return object.blocks.length <= 1 && object.blocks.every((block) => block.type === "text");
}

export function noteDocumentId(noteId: string): DocumentId {
  return asDocumentId(legacyObjectReference("note", noteId));
}

export function materialDocumentId(readingItemId: string): DocumentId {
  return asDocumentId(legacyObjectReference("reading", readingItemId));
}

export function nativeDocumentId(objectId: string): DocumentId | null {
  return objectId.trim() && !objectId.startsWith("legacy:")
    ? asDocumentId(objectId)
    : null;
}

export function parseDocumentId(reference: string): {
  readonly id: DocumentId;
  readonly source: DocumentSource;
} | null {
  if (!reference.trim()) return null;
  const legacy = parseLegacyObjectReference(reference);
  if (legacy?.type === "note") {
    return {
      id: noteDocumentId(legacy.rawId),
      source: { kind: "note", entityId: legacy.rawId }
    };
  }
  if (legacy?.type === "reading") {
    return {
      id: materialDocumentId(legacy.rawId),
      source: { kind: "material", entityId: legacy.rawId }
    };
  }
  if (reference.startsWith("legacy:")) return null;
  return {
    id: asDocumentId(reference),
    source: { kind: "native", entityId: reference }
  };
}

export function documentFromNote(note: Note): DocumentRecord {
  return {
    id: noteDocumentId(note.id),
    source: { kind: "note", entityId: note.id },
    kind: "document",
    title: note.title,
    content: note.body,
    tags: [...note.tags],
    isReflection: Boolean(note.reflection) || note.origin === "reflection" || hasReflectionTag(note.tags),
    pinned: note.pinned,
    projectId: note.projectId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    contentStructure: {
      kind: "plain-text",
      blockCount: note.body ? 1 : 0,
      blockTypes: note.body ? ["text"] : []
    },
    capabilities: editableNoteCapabilities
  };
}

export function documentFromNativeObject(object: UniversalObject): DocumentRecord | null {
  const id = object.source.kind === "native" ? nativeDocumentId(object.id) : null;
  if (!id || !object.roles.includes("document")) return null;
  const simple = hasSimpleDocumentContent(object);
  const tags = stringArrayProperty(object.properties["document.tags"]);
  return {
    id,
    source: { kind: "native", entityId: object.id },
    kind: "document",
    title: object.title,
    content: nativeContent(object),
    tags,
    isReflection: hasReflectionTag(tags),
    pinned: object.properties["document.pinned"] === true,
    projectId: null,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    contentStructure: {
      kind: simple ? "plain-text" : "structured",
      blockCount: object.blocks.length,
      blockTypes: object.blocks.map((block) => block.type)
    },
    capabilities: simple ? editableNativeCapabilities : structuredNativeCapabilities
  };
}

export function documentFromReadingItem(item: ReadingItem): DocumentRecord {
  return {
    id: materialDocumentId(item.id),
    source: { kind: "material", entityId: item.id },
    kind: "material",
    title: item.title,
    content: [item.summary, item.body].filter(Boolean).join("\n\n"),
    tags: [...item.tags],
    isReflection: hasReflectionTag(item.tags),
    pinned: false,
    projectId: null,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    contentStructure: {
      kind: "plain-text",
      blockCount: item.summary || item.body ? 1 : 0,
      blockTypes: item.summary || item.body ? ["text"] : []
    },
    capabilities: readOnlyMaterialCapabilities
  };
}

/**
 * Characterizes the current ordinary-document creation path without writing
 * anything: a future application command still delegates this draft to Note.
 */
export function documentDraftToNoteDraft(draft: DocumentDraft): NoteDraft {
  return {
    title: draft.title,
    body: draft.content,
    tags: draft.tags ? [...draft.tags] : undefined,
    pinned: draft.pinned,
    projectId: draft.projectId
  };
}

export function resolveDocument(
  state: Pick<DashboardState, "notes" | "readingItems" | "objectGraph">,
  reference: string
): DocumentLookupResult {
  const parsed = parseDocumentId(reference);
  if (!parsed) return { status: "invalid-id", reference };

  if (parsed.source.kind === "note") {
    const note = state.notes.find((entry) => entry.id === parsed.source.entityId);
    return note
      ? { status: "found", document: documentFromNote(note) }
      : { status: "not-found", ...parsed };
  }

  if (parsed.source.kind === "material") {
    const item = state.readingItems.find((entry) => entry.id === parsed.source.entityId);
    return item
      ? { status: "found", document: documentFromReadingItem(item) }
      : { status: "not-found", ...parsed };
  }

  const object = state.objectGraph.objects.find((entry) => entry.id === parsed.source.entityId);
  if (!object) return { status: "not-found", ...parsed };
  const document = documentFromNativeObject(object);
  return document
    ? { status: "found", document }
    : { status: "not-document", id: parsed.id, source: parsed.source };
}
