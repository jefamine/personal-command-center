import type { DocumentId, DocumentRecord } from "../../domain/documents/documentContract";
import type {
  DocumentCreateResult,
  DocumentDeleteResult,
  DocumentRepository,
  DocumentUpdateResult
} from "../../domain/documents/documentRepository";
import { hashDocumentContent } from "../../domain/documents/workspace/documentContentHash";
import type {
  CreateStoredDocumentCommand,
  CreateStoredFolderCommand,
  DeletedStoredDocument,
  DeleteStoredDocumentCommand,
  DocumentScanOptions,
  DocumentScanResult,
  DocumentStorageAdapter,
  DocumentStorageFailure,
  DocumentStorageReference,
  DocumentStorageResult,
  MakeStoredDocumentManagedCommand,
  MoveStoredDocumentCommand,
  MoveStoredFolderCommand,
  PurgeStoredDocumentCommand,
  RenameStoredDocumentCommand,
  RenameStoredFolderCommand,
  RestoreStoredDocumentCommand,
  SaveStoredDocumentConflictCopyCommand,
  StoredDocument,
  StoredFolderOperation,
  UpdateStoredDocumentCommand
} from "../../domain/documents/workspace/documentWorkspaceContract";
import {
  compareWorkspacePaths,
  MAX_WORKSPACE_PATH_SEGMENT_LENGTH,
  normalizeWorkspacePathSegment,
  normalizeWorkspaceRelativePath,
  removeOptionalMarkdownExtension,
  WorkspacePathError,
  workspacePathBasename,
  workspacePathCollisionKey,
  workspacePathDirname
} from "../../domain/documents/workspace/workspacePaths";

export const DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID = "internal";

export interface InternalDocumentStorageAdapterOptions {
  readonly workspaceId?: string;
  readonly now?: () => Date;
}

interface InternalProjection {
  readonly document: DocumentRecord;
  readonly relativePath: string;
}

const INTERNAL_UNSUPPORTED_MESSAGE =
  "Внутреннее хранилище ПСОЖ не использует физические папки или файловую корзину.";

function failure(
  code: DocumentStorageFailure["code"],
  message: string,
  relativePath?: string,
  current?: StoredDocument
): DocumentStorageFailure {
  return {
    status: "error",
    code,
    message,
    ...(relativePath ? { relativePath } : {}),
    ...(current ? { current } : {})
  };
}

function ok<T>(value: T): DocumentStorageResult<T> {
  return { status: "ok", value };
}

function unsupported<T>(message = INTERNAL_UNSUPPORTED_MESSAGE): DocumentStorageResult<T> {
  return failure("unsupported", message);
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function truncateStem(stem: string, suffixLength = 0): string {
  const maximum = MAX_WORKSPACE_PATH_SEGMENT_LENGTH - ".md".length - suffixLength;
  let value = stem.slice(0, Math.max(1, maximum)).replace(/[. ]+$/u, "");
  if (/[\uD800-\uDBFF]$/u.test(value)) value = value.slice(0, -1);
  return value || "Документ";
}

function safeDisplayFileName(title: string): string {
  let stem = removeOptionalMarkdownExtension(title.normalize("NFC").trim())
    .replace(/[<>:"|?*\\/\u0000-\u001f\u007f-\u009f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/u, "")
    .trim();
  if (!stem) stem = "Без названия";
  stem = truncateStem(stem);

  let candidate = `${stem}.md`;
  try {
    return normalizeWorkspacePathSegment(candidate);
  } catch (error) {
    if (!(error instanceof WorkspacePathError) || error.code !== "reserved-name") throw error;
    candidate = `_${truncateStem(stem, 1)}.md`;
    return normalizeWorkspacePathSegment(candidate);
  }
}

function collisionFileName(baseFileName: string, ordinal: number): string {
  const stem = removeOptionalMarkdownExtension(baseFileName);
  const suffix = ` (${ordinal})`;
  return normalizeWorkspacePathSegment(`${truncateStem(stem, suffix.length)}${suffix}.md`);
}

function buildInternalProjections(documents: readonly DocumentRecord[]): InternalProjection[] {
  const usedPaths = new Set<string>();
  const projections = [...documents]
    .sort((left, right) => {
      const leftId = String(left.id);
      const rightId = String(right.id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    })
    .map((document) => {
      const baseFileName = safeDisplayFileName(document.title);
      let relativePath = baseFileName;
      let ordinal = 2;
      while (usedPaths.has(workspacePathCollisionKey(relativePath))) {
        relativePath = collisionFileName(baseFileName, ordinal);
        ordinal += 1;
      }
      usedPaths.add(workspacePathCollisionKey(relativePath));
      return { document, relativePath };
    });

  return projections.sort((left, right) =>
    compareWorkspacePaths(left.relativePath, right.relativePath)
  );
}

function internalHashPayload(document: DocumentRecord): string {
  return JSON.stringify({
    id: document.id,
    title: document.title,
    content: document.content,
    tags: document.tags,
    pinned: document.pinned,
    projectId: document.projectId
  });
}

async function storedDocument(
  workspaceId: string,
  projection: InternalProjection
): Promise<StoredDocument> {
  const { document, relativePath } = projection;
  const contentHash = await hashDocumentContent(internalHashPayload(document));
  return {
    reference: {
      workspaceId,
      relativePath,
      documentId: document.id,
      expectedContentHash: contentHash
    },
    fileName: workspacePathBasename(relativePath),
    title: document.title,
    extension: ".md",
    size: utf8Size(document.content),
    lastModified: timestamp(document.updatedAt),
    contentHash,
    rawFrontmatter: null,
    body: document.content,
    metadata: {
      psozhId: String(document.id),
      tags: [...document.tags],
      aliases: []
    },
    state: "managed"
  };
}

function normalizeMarkdownFileName(value: string): string {
  const supplied = normalizeWorkspacePathSegment(value);
  const withExtension = /\.md$/iu.test(supplied) ? supplied : `${supplied}.md`;
  const normalized = normalizeWorkspacePathSegment(withExtension);
  if (!removeOptionalMarkdownExtension(normalized).trim()) {
    throw new WorkspacePathError("empty-path", value, "Имя Markdown-документа не может быть пустым.");
  }
  return normalized;
}

function pathFailure(error: unknown, relativePath?: string): DocumentStorageFailure {
  if (error instanceof WorkspacePathError) {
    return failure("invalid-path", error.message, relativePath ?? error.input);
  }
  const message = error instanceof Error ? error.message : "Не удалось обработать путь документа.";
  return failure("operation-failed", message, relativePath);
}

function createFailure(result: Exclude<DocumentCreateResult, { status: "created" }>): DocumentStorageFailure {
  return failure("operation-failed", result.message);
}

function updateFailure(result: Exclude<DocumentUpdateResult, { status: "accepted" }>): DocumentStorageFailure {
  if (result.status === "not-found" || result.status === "not-document" || result.status === "invalid-id") {
    return failure("not-found", "Документ не найден во внутреннем хранилище.");
  }
  if (result.status === "revision-conflict") {
    return failure("external-modification", "Документ уже был изменён другой командой.");
  }
  if (result.status === "command-rejected") {
    return failure("operation-failed", result.message);
  }
  return failure("unsupported", "Эта часть документа недоступна для изменения во внутреннем режиме.");
}

function deleteFailure(result: Exclude<DocumentDeleteResult, { status: "accepted" }>): DocumentStorageFailure {
  if (result.status === "not-found" || result.status === "not-document" || result.status === "invalid-id") {
    return failure("not-found", "Документ не найден во внутреннем хранилище.");
  }
  if (result.status === "command-rejected") {
    return failure("operation-failed", result.message);
  }
  return failure("unsupported", "Этот документ доступен только для чтения.");
}

/**
 * Async storage facade over the existing canonical synchronous repository.
 * Every StoredDocument is a disposable projection; no Markdown copy is saved.
 */
export function createInternalDocumentStorageAdapter(
  repository: DocumentRepository,
  options: InternalDocumentStorageAdapterOptions = {}
): DocumentStorageAdapter {
  const workspaceId = options.workspaceId ?? DEFAULT_INTERNAL_DOCUMENT_WORKSPACE_ID;
  const now = options.now ?? (() => new Date());

  const catalog = async (): Promise<StoredDocument[]> => {
    const projections = buildInternalProjections(repository.listDocuments());
    return Promise.all(projections.map((projection) => storedDocument(workspaceId, projection)));
  };

  const currentDocument = async (
    reference: DocumentStorageReference
  ): Promise<DocumentStorageResult<StoredDocument>> => {
    if (reference.workspaceId !== workspaceId) {
      return failure("not-found", "Подключено другое внутреннее пространство документов.", reference.relativePath);
    }
    const documents = await catalog();
    const current = documents.find((document) => document.reference.documentId === reference.documentId);
    return current
      ? ok(current)
      : failure("not-found", "Документ не найден во внутреннем хранилище.", reference.relativePath);
  };

  const checkedDocument = async (
    reference: DocumentStorageReference
  ): Promise<DocumentStorageResult<StoredDocument>> => {
    const result = await currentDocument(reference);
    if (result.status === "error") return result;
    if (reference.expectedContentHash && reference.expectedContentHash !== result.value.contentHash) {
      return failure(
        "external-modification",
        "Документ изменился после получения снимка.",
        result.value.reference.relativePath,
        result.value
      );
    }
    return result;
  };

  const projectedAfterPatch = async (
    current: StoredDocument,
    patch: { readonly title?: string; readonly content?: string; readonly tags?: readonly string[] }
  ): Promise<StoredDocument> => {
    const resolved = repository.getDocument(current.reference.documentId);
    if (resolved.status !== "found") throw new Error("Документ исчез после принятой команды.");
    const nextRecord: DocumentRecord = {
      ...resolved.document,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {})
    };
    const nextPath = patch.title === undefined
      ? current.reference.relativePath
      : normalizeMarkdownFileName(`${patch.title}.md`);
    return storedDocument(workspaceId, { document: nextRecord, relativePath: nextPath });
  };

  const scan = async (scanOptions?: DocumentScanOptions): Promise<DocumentScanResult> => {
    scanOptions?.signal?.throwIfAborted();
    const documents = await catalog();
    scanOptions?.signal?.throwIfAborted();
    return {
      workspaceId,
      scannedAt: now().toISOString(),
      documents,
      folders: [],
      errors: [],
      summary: {
        folders: 0,
        markdownFiles: documents.length,
        managedFiles: documents.length,
        unmanagedFiles: 0,
        malformedFrontmatter: 0,
        duplicateIds: 0,
        pathCollisions: 0,
        unreadableFiles: 0
      }
    };
  };

  const createDocument = async (
    command: CreateStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> => {
    if (command.workspaceId !== workspaceId) {
      return failure("not-found", "Подключено другое внутреннее пространство документов.", command.relativePath);
    }
    if (command.documentId !== undefined) {
      return unsupported("Внутренний репозиторий сам создаёт устойчивый DocumentId.");
    }
    if (command.aliases?.length) {
      return unsupported("Внутренние документы пока не сохраняют aliases.");
    }

    let fileName: string;
    try {
      const normalized = normalizeWorkspaceRelativePath(command.relativePath);
      if (workspacePathDirname(normalized)) {
        return unsupported("Внутреннее хранилище пока не содержит физических папок.");
      }
      fileName = normalizeMarkdownFileName(workspacePathBasename(normalized));
    } catch (error) {
      return pathFailure(error, command.relativePath);
    }

    const existing = await catalog();
    const collisionKey = workspacePathCollisionKey(fileName);
    if (existing.some((document) => workspacePathCollisionKey(document.reference.relativePath) === collisionKey)) {
      return failure("path-collision", "Документ с таким отображаемым путём уже существует.", fileName);
    }

    const result = repository.createDocument({
      title: removeOptionalMarkdownExtension(fileName),
      content: command.body ?? "",
      tags: command.tags ? [...command.tags] : undefined
    });
    if (result.status !== "created") return createFailure(result);
    return ok(await storedDocument(workspaceId, {
      document: result.document,
      relativePath: fileName
    }));
  };

  const updateDocument = async (
    command: UpdateStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> => {
    if (command.aliases?.length) {
      return unsupported("Внутренние документы пока не сохраняют aliases.");
    }
    const checked = await checkedDocument(command.reference);
    if (checked.status === "error") return checked;
    const result = repository.updateDocument(command.reference.documentId, {
      ...(command.body !== undefined ? { content: command.body } : {}),
      ...(command.tags !== undefined ? { tags: [...command.tags] } : {})
    });
    if (result.status !== "accepted") return updateFailure(result);
    try {
      return ok(await projectedAfterPatch(checked.value, {
        content: command.body,
        tags: command.tags
      }));
    } catch (error) {
      return failure("operation-failed", error instanceof Error ? error.message : "Команда принята, но снимок не прочитан.");
    }
  };

  const renameDocument = async (
    command: RenameStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> => {
    const checked = await checkedDocument(command.reference);
    if (checked.status === "error") return checked;

    let fileName: string;
    try {
      fileName = normalizeMarkdownFileName(command.nextFileName);
    } catch (error) {
      return pathFailure(error, command.nextFileName);
    }
    const collisionKey = workspacePathCollisionKey(fileName);
    const existing = await catalog();
    if (existing.some((document) =>
      document.reference.documentId !== command.reference.documentId &&
      workspacePathCollisionKey(document.reference.relativePath) === collisionKey
    )) {
      return failure("path-collision", "Документ с таким отображаемым путём уже существует.", fileName);
    }

    const title = removeOptionalMarkdownExtension(fileName);
    const result = repository.updateDocument(command.reference.documentId, { title });
    if (result.status !== "accepted") return updateFailure(result);
    try {
      return ok(await projectedAfterPatch(checked.value, { title }));
    } catch (error) {
      return failure("operation-failed", error instanceof Error ? error.message : "Команда принята, но снимок не прочитан.");
    }
  };

  const deleteDocument = async (
    command: DeleteStoredDocumentCommand
  ): Promise<DocumentStorageResult<DeletedStoredDocument>> => {
    const checked = await checkedDocument(command.reference);
    if (checked.status === "error") return checked;
    const result = repository.deleteDocument(command.reference.documentId);
    if (result.status !== "accepted") return deleteFailure(result);
    const deletedAt = now().toISOString();
    return ok({
      tombstoneId: `internal:${encodeURIComponent(String(command.reference.documentId))}:${encodeURIComponent(deletedAt)}`,
      originalReference: checked.value.reference,
      deletedAt,
      contentHash: checked.value.contentHash,
      documentId: command.reference.documentId
    });
  };

  const makeDocumentManaged = async (
    command: MakeStoredDocumentManagedCommand
  ): Promise<DocumentStorageResult<StoredDocument>> => {
    const checked = await checkedDocument(command.reference);
    if (checked.status === "error") return checked;
    if (command.documentId !== undefined && command.documentId !== command.reference.documentId) {
      return unsupported("У внутреннего документа уже есть другой устойчивый DocumentId.");
    }
    return checked;
  };

  const createFolder = async (
    _command: CreateStoredFolderCommand
  ): Promise<DocumentStorageResult<StoredFolderOperation>> => unsupported();
  const renameFolder = async (
    _command: RenameStoredFolderCommand
  ): Promise<DocumentStorageResult<StoredFolderOperation>> => unsupported();
  const moveFolder = async (
    _command: MoveStoredFolderCommand
  ): Promise<DocumentStorageResult<StoredFolderOperation>> => unsupported();

  return {
    scan,
    readDocument: currentDocument,
    createDocument,
    updateDocument,
    renameDocument,
    moveDocument: async (_command: MoveStoredDocumentCommand) => unsupported(),
    deleteDocument,
    restoreDocument: async (_command: RestoreStoredDocumentCommand) => unsupported(),
    makeDocumentManaged,
    saveConflictCopy: async (_command: SaveStoredDocumentConflictCopyCommand) =>
      unsupported("Внутренний режим не создаёт файловые conflict copies."),
    purgeDocument: async (_command: PurgeStoredDocumentCommand) => unsupported(),
    createFolder,
    renameFolder,
    moveFolder
  };
}
