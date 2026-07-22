import type { DocumentId } from "../../domain/documents/documentContract";
import { hashDocumentContent } from "../../domain/documents/workspace/documentContentHash";
import {
  addPsozhId,
  parseMarkdownDocument,
  patchMarkdownMetadata,
  replaceMarkdownBody
} from "../../domain/documents/workspace/markdownDocument";
import type {
  CreateStoredDocumentCommand,
  CreateStoredFolderCommand,
  DeleteStoredDocumentCommand,
  DeletedStoredDocument,
  DocumentScanError,
  DocumentScanOptions,
  DocumentScanResult,
  DocumentStorageAdapter,
  DocumentStorageErrorCode,
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
  conflictingExternalDocumentId,
  createWorkspaceId,
  isValidPsozhId,
  managedExternalDocumentId,
  unmanagedExternalDocumentId
} from "../../domain/documents/workspace/documentWorkspaceIdentity";
import {
  compareWorkspacePaths,
  hasIgnoredWorkspaceDirectory,
  isMarkdownWorkspacePath,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspacePathSegment,
  normalizeWorkspaceRelativePath,
  removeOptionalMarkdownExtension,
  shouldIgnoreWorkspaceEntry,
  workspacePathBasename,
  workspacePathCollisionKey,
  workspacePathDirname,
  WorkspacePathError
} from "../../domain/documents/workspace/workspacePaths";
import {
  isWorkspaceFileNotFound,
  isWorkspaceFilePermissionDenied,
  type DocumentWorkspaceFilePort,
  type WorkspaceFileReadResult
} from "./documentWorkspaceFilePort";

export interface MarkdownDocumentStorageAdapterOptions {
  readonly workspaceId: string;
  readonly filePort: DocumentWorkspaceFilePort;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

interface TrashManifest {
  readonly schemaVersion: 1;
  readonly tombstoneId: string;
  readonly workspaceId: string;
  readonly originalRelativePath: string;
  readonly deletedAt: string;
  readonly contentHash: string;
  readonly documentId: string;
}

interface WritableStoredDocument {
  readonly document: StoredDocument;
  readonly raw: WorkspaceFileReadResult;
}

function ok<T>(value: T): DocumentStorageResult<T> {
  return { status: "ok", value };
}

function failure(
  code: DocumentStorageErrorCode,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка файлового хранилища.";
}

function storageFailure(error: unknown, relativePath?: string): DocumentStorageFailure {
  if (error instanceof WorkspacePathError) {
    return failure("invalid-path", error.message, relativePath ?? error.input);
  }
  if (isWorkspaceFilePermissionDenied(error)) {
    return failure("permission-denied", errorMessage(error), relativePath);
  }
  if (isWorkspaceFileNotFound(error)) {
    return failure("not-found", errorMessage(error), relativePath);
  }
  if ((error instanceof DOMException || error instanceof Error) &&
    error.name === "InvalidModificationError") {
    return failure("already-exists", error.message, relativePath);
  }
  if ((error instanceof DOMException || error instanceof Error) && error.name === "VersionError") {
    return failure("external-modification", "Документ изменён в другом приложении.", relativePath);
  }
  return failure("operation-failed", errorMessage(error), relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trashManifest(value: unknown): TrashManifest | null {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
    typeof value.tombstoneId !== "string" || typeof value.workspaceId !== "string" ||
    typeof value.originalRelativePath !== "string" || typeof value.deletedAt !== "string" ||
    typeof value.contentHash !== "string" || typeof value.documentId !== "string") return null;
  return {
    schemaVersion: 1,
    tombstoneId: value.tombstoneId,
    workspaceId: value.workspaceId,
    originalRelativePath: value.originalRelativePath,
    deletedAt: value.deletedAt,
    contentHash: value.contentHash,
    documentId: value.documentId
  };
}

function storedMarkdownPath(relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  if (hasIgnoredWorkspaceDirectory(normalized)) {
    throw new WorkspacePathError(
      "forbidden-character",
      relativePath,
      "Служебные папки нельзя использовать как пользовательское пространство."
    );
  }
  if (!isMarkdownWorkspacePath(normalized)) {
    return normalizeWorkspaceRelativePath(`${normalized}.md`);
  }
  return normalized;
}

function renamedMarkdownPath(referencePath: string, nextFileName: string): string {
  const normalizedName = normalizeWorkspacePathSegment(nextFileName);
  const withExtension = /\.md$/iu.test(normalizedName) ? normalizedName : `${normalizedName}.md`;
  return normalizeWorkspaceRelativePath(
    workspacePathDirname(referencePath)
      ? `${workspacePathDirname(referencePath)}/${withExtension}`
      : withExtension
  );
}

function conflictSafeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, "-");
}

function markdownTitle(relativePath: string): string {
  return removeOptionalMarkdownExtension(workspacePathBasename(relativePath));
}

function newManagedMarkdown(
  documentId: string,
  body: string,
  tags: readonly string[] = [],
  aliases: readonly string[] = []
): string {
  const lines = [
    "---",
    `psozh-id: ${JSON.stringify(documentId)}`,
    ...(tags.length ? [`tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]`] : []),
    ...(aliases.length ? [`aliases: [${aliases.map((alias) => JSON.stringify(alias)).join(", ")}]`] : []),
    "---",
    body
  ];
  return lines.join("\n");
}

export class MarkdownDocumentStorageAdapter implements DocumentStorageAdapter {
  readonly workspaceId: string;
  protected readonly filePort: DocumentWorkspaceFilePort;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: MarkdownDocumentStorageAdapterOptions) {
    this.workspaceId = options.workspaceId;
    this.filePort = options.filePort;
    this.createId = options.createId ?? createWorkspaceId;
    this.now = options.now ?? (() => new Date());
  }

  private assertWorkspace(workspaceId: string): DocumentStorageFailure | null {
    return workspaceId === this.workspaceId
      ? null
      : failure("not-found", "Рабочее пространство не соответствует подключённой папке.");
  }

  private async storedFromRead(read: WorkspaceFileReadResult): Promise<StoredDocument> {
    const relativePath = normalizeWorkspaceRelativePath(read.relativePath);
    const parsed = parseMarkdownDocument(read.content);
    const contentHash = await hashDocumentContent(read.content);
    const validManagedId = isValidPsozhId(parsed.metadata.psozhId)
      ? parsed.metadata.psozhId
      : null;
    const malformed = parsed.frontmatterStatus === "malformed" ||
      parsed.frontmatterStatus === "unsupported" ||
      (parsed.metadata.psozhId !== null && !validManagedId);
    const documentId = validManagedId
      ? managedExternalDocumentId(validManagedId)
      : unmanagedExternalDocumentId(this.workspaceId, relativePath);
    return {
      reference: {
        workspaceId: this.workspaceId,
        relativePath,
        documentId,
        expectedContentHash: contentHash
      },
      fileName: workspacePathBasename(relativePath),
      title: markdownTitle(relativePath),
      extension: ".md",
      size: read.size,
      lastModified: read.lastModified,
      contentHash,
      rawFrontmatter: parsed.rawFrontmatter,
      body: parsed.body,
      metadata: {
        psozhId: validManagedId,
        tags: [...parsed.metadata.tags],
        aliases: [...parsed.metadata.aliases]
      },
      state: malformed ? "malformed-frontmatter" : validManagedId ? "managed" : "unmanaged"
    };
  }

  private async readPath(relativePath: string): Promise<DocumentStorageResult<StoredDocument>> {
    try {
      return ok(await this.storedFromRead(await this.filePort.read(relativePath)));
    } catch (error) {
      return storageFailure(error, relativePath);
    }
  }

  private async currentForWrite(
    reference: DocumentStorageReference
  ): Promise<DocumentStorageResult<WritableStoredDocument>> {
    const mismatch = this.assertWorkspace(reference.workspaceId);
    if (mismatch) return mismatch;
    let raw: WorkspaceFileReadResult;
    let document: StoredDocument;
    try {
      raw = await this.filePort.read(reference.relativePath);
      document = await this.storedFromRead(raw);
    } catch (error) {
      return storageFailure(error, reference.relativePath);
    }
    if (!reference.expectedContentHash || reference.expectedContentHash !== document.contentHash ||
      reference.documentId !== document.reference.documentId) {
      return failure(
        "external-modification",
        "Документ изменён в другом приложении.",
        reference.relativePath,
        document
      );
    }
    return ok({ document, raw });
  }

  private async existingCollision(
    relativePath: string,
    exceptPath?: string
  ): Promise<string | null> {
    const key = workspacePathCollisionKey(relativePath);
    const exceptKey = exceptPath ? workspacePathCollisionKey(exceptPath) : null;
    const snapshot = await this.filePort.list();
    const file = snapshot.files.find((entry) => {
      const candidateKey = workspacePathCollisionKey(entry.relativePath);
      return candidateKey === key && candidateKey !== exceptKey;
    });
    if (file) return file.relativePath;
    const folder = snapshot.folders.find((entry) => {
      const candidateKey = workspacePathCollisionKey(entry);
      return candidateKey === key && candidateKey !== exceptKey;
    });
    return folder ?? null;
  }

  private async ensureWorkspaceMetadata(): Promise<DocumentStorageFailure | null> {
    const metadataPath = ".psozh/workspace.json";
    try {
      const existing = await this.filePort.read(metadataPath);
      const parsed: unknown = JSON.parse(existing.content);
      if (!isRecord(parsed) || parsed.workspaceId !== this.workspaceId || parsed.schemaVersion !== 1) {
        return failure(
          "operation-failed",
          "Служебные сведения .psozh относятся к другому или повреждённому workspace.",
          metadataPath
        );
      }
      return null;
    } catch (error) {
      if (!isWorkspaceFileNotFound(error)) return storageFailure(error, metadataPath);
    }
    try {
      await this.filePort.createFolder(".psozh");
      await this.filePort.write(metadataPath, JSON.stringify({
        workspaceId: this.workspaceId,
        schemaVersion: 1,
        createdAt: this.now().toISOString()
      }, null, 2), { exclusive: true });
      return null;
    } catch (error) {
      if ((error instanceof DOMException || error instanceof Error) &&
        error.name === "InvalidModificationError") {
        try {
          const winner = JSON.parse((await this.filePort.read(metadataPath)).content) as unknown;
          if (isRecord(winner) && winner.workspaceId === this.workspaceId && winner.schemaVersion === 1) {
            return null;
          }
        } catch {
          // Fall through to the original typed collision below.
        }
      }
      return storageFailure(error, metadataPath);
    }
  }

  async scan(options: DocumentScanOptions = {}): Promise<DocumentScanResult> {
    const snapshot = await this.filePort.list(options.signal);
    const documents: StoredDocument[] = [];
    const errors: DocumentScanError[] = [];
    const markdownFiles = snapshot.files
      .filter((entry) => !shouldIgnoreWorkspaceEntry(entry.relativePath, "file"))
      .filter((entry) => isMarkdownWorkspacePath(entry.relativePath))
      .sort((left, right) => compareWorkspacePaths(left.relativePath, right.relativePath));

    const markdownPathGroups = new Map<string, string[]>();
    markdownFiles.forEach((entry) => {
      const key = workspacePathCollisionKey(entry.relativePath);
      markdownPathGroups.set(key, [...(markdownPathGroups.get(key) ?? []), entry.relativePath]);
    });
    const conflictPathKeys = new Set<string>();
    markdownPathGroups.forEach((paths, key) => {
      if (paths.length < 2) return;
      conflictPathKeys.add(key);
      paths.forEach((relativePath) => errors.push({
        relativePath,
        code: "path-collision",
        message: "Путь конфликтует с другим файлом без учёта регистра."
      }));
    });

    for (const entry of markdownFiles) {
      if (options.signal?.aborted) throw new DOMException("Сканирование отменено.", "AbortError");
      const result = await this.readPath(entry.relativePath);
      if (result.status === "error") {
        errors.push({
          relativePath: entry.relativePath,
          code: "inaccessible",
          message: result.message
        });
        continue;
      }
      documents.push(result.value);
      if (result.value.state === "malformed-frontmatter") {
        errors.push({
          relativePath: entry.relativePath,
          code: "malformed-frontmatter",
          message: `Свойства файла «${entry.relativePath}» нельзя безопасно изменить.`
        });
      }
    }

    const idGroups = new Map<string, StoredDocument[]>();
    documents.forEach((document) => {
      if (document.metadata.psozhId) {
        idGroups.set(document.metadata.psozhId, [
          ...(idGroups.get(document.metadata.psozhId) ?? []),
          document
        ]);
      }
    });

    const conflictPaths = new Set(
      markdownFiles
        .filter((entry) => conflictPathKeys.has(workspacePathCollisionKey(entry.relativePath)))
        .map((entry) => entry.relativePath)
    );
    idGroups.forEach((group) => {
      if (group.length < 2) return;
      group.forEach((document) => {
        conflictPaths.add(document.reference.relativePath);
        errors.push({
          relativePath: document.reference.relativePath,
          code: "duplicate-id",
          message: `psozh-id «${document.metadata.psozhId}» встречается более одного раза.`
        });
      });
    });

    const indexedDocuments = documents.map((document): StoredDocument => {
      if (!conflictPaths.has(document.reference.relativePath)) return document;
      return {
        ...document,
        reference: {
          ...document.reference,
          documentId: conflictingExternalDocumentId(
            this.workspaceId,
            document.reference.relativePath
          )
        },
        state: "conflict"
      };
    });
    const folders = snapshot.folders
      .filter((path) => !shouldIgnoreWorkspaceEntry(path, "directory"))
      .sort(compareWorkspacePaths);
    const duplicateErrors = errors.filter((entry) => entry.code === "duplicate-id").length;
    const pathErrors = errors.filter((entry) => entry.code === "path-collision").length;
    const unreadableErrors = errors.filter((entry) => entry.code === "inaccessible").length;
    return {
      workspaceId: this.workspaceId,
      scannedAt: this.now().toISOString(),
      documents: indexedDocuments,
      folders,
      errors,
      summary: {
        folders: folders.length,
        markdownFiles: markdownFiles.length,
        managedFiles: indexedDocuments.filter((document) =>
          document.state === "managed" ||
          (document.state === "conflict" && Boolean(document.metadata.psozhId))
        ).length,
        unmanagedFiles: indexedDocuments.filter((document) =>
          document.state === "unmanaged" ||
          (document.state === "conflict" && !document.metadata.psozhId)
        ).length,
        malformedFrontmatter: errors.filter((entry) => entry.code === "malformed-frontmatter").length,
        duplicateIds: duplicateErrors,
        pathCollisions: pathErrors,
        unreadableFiles: unreadableErrors
      }
    };
  }

  async readDocument(
    reference: DocumentStorageReference
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const mismatch = this.assertWorkspace(reference.workspaceId);
    if (mismatch) return mismatch;
    const current = await this.readPath(reference.relativePath);
    if (current.status === "error") return current;
    if (current.value.reference.documentId !== reference.documentId) {
      return failure(
        "external-modification",
        "У файла изменилась устойчивая идентичность.",
        reference.relativePath,
        current.value
      );
    }
    return current;
  }

  async createDocument(
    command: CreateStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const mismatch = this.assertWorkspace(command.workspaceId);
    if (mismatch) return mismatch;
    let relativePath: string;
    try {
      relativePath = storedMarkdownPath(command.relativePath);
      const collision = await this.existingCollision(relativePath);
      if (collision) return failure("path-collision", `Путь уже занят: ${collision}`, relativePath);
    } catch (error) {
      return storageFailure(error, command.relativePath);
    }
    let documentId: DocumentId;
    try {
      documentId = command.documentId
        ? managedExternalDocumentId(command.documentId)
        : managedExternalDocumentId(this.createId());
    } catch (error) {
      return failure("invalid-path", errorMessage(error), relativePath);
    }
    const scan = await this.scan();
    if (scan.documents.some((document) => document.metadata.psozhId === documentId)) {
      return failure("duplicate-id", `psozh-id «${documentId}» уже используется.`, relativePath);
    }
    const metadataFailure = await this.ensureWorkspaceMetadata();
    if (metadataFailure) return metadataFailure;
    const content = newManagedMarkdown(
      documentId,
      command.body ?? "",
      command.tags ?? [],
      command.aliases ?? []
    );
    const expectedHash = await hashDocumentContent(content);
    try {
      await this.filePort.write(relativePath, content, { exclusive: true });
      const created = await this.readPath(relativePath);
      if (created.status === "error" || created.value.contentHash !== expectedHash ||
        created.value.reference.documentId !== documentId || created.value.body !== (command.body ?? "")) {
        await this.filePort.delete(relativePath, { expectedContentHash: expectedHash }).catch(() => undefined);
        return failure("verification-failed", "Созданный документ не прошёл повторную проверку.", relativePath);
      }
      return created;
    } catch (error) {
      return storageFailure(error, relativePath);
    }
  }

  async updateDocument(
    command: UpdateStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const current = await this.currentForWrite(command.reference);
    if (current.status === "error") return current;
    let content = current.value.raw.content;
    if (command.body !== undefined) {
      const mutation = replaceMarkdownBody(content, command.body);
      if (mutation.status === "blocked") {
        return failure("malformed-frontmatter", mutation.message, command.reference.relativePath);
      }
      content = mutation.content;
    }
    if (command.tags !== undefined || command.aliases !== undefined) {
      const mutation = patchMarkdownMetadata(content, {
        ...(command.tags !== undefined ? { tags: [...command.tags] } : {}),
        ...(command.aliases !== undefined ? { aliases: [...command.aliases] } : {})
      });
      if (mutation.status === "blocked") {
        return failure("malformed-frontmatter", mutation.message, command.reference.relativePath);
      }
      content = mutation.content;
    }
    if (content === current.value.raw.content) return ok(current.value.document);
    const metadataFailure = await this.ensureWorkspaceMetadata();
    if (metadataFailure) return metadataFailure;
    const latest = await this.currentForWrite(command.reference);
    if (latest.status === "error") return latest;
    const intendedHash = await hashDocumentContent(content);
    try {
      await this.filePort.write(command.reference.relativePath, content, {
        exclusive: false,
        expectedContentHash: command.reference.expectedContentHash
      });
      const updated = await this.readPath(command.reference.relativePath);
      if (updated.status === "error") {
        return {
          ...failure("verification-failed", "Записанный документ не удалось перечитать.", command.reference.relativePath),
          recoveryRequired: true
        };
      }
      if (updated.value.contentHash !== intendedHash) {
        return failure(
          "external-modification",
          "Документ изменился сразу после записи; версия на диске сохранена.",
          command.reference.relativePath,
          updated.value
        );
      }
      return updated;
    } catch (error) {
      return storageFailure(error, command.reference.relativePath);
    }
  }

  private async verifiedMove(
    reference: DocumentStorageReference,
    destinationPath: string
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const current = await this.currentForWrite(reference);
    if (current.status === "error") return current;
    const sourcePath = normalizeWorkspaceRelativePath(reference.relativePath);
    const destination = normalizeWorkspaceRelativePath(destinationPath);
    if (workspacePathCollisionKey(sourcePath) === workspacePathCollisionKey(destination)) {
      return failure(
        "path-collision",
        "Переименование, отличающееся только регистром, требует нативного desktop-адаптера.",
        destination
      );
    }
    try {
      const collision = await this.existingCollision(destination, sourcePath);
      if (collision) return failure("path-collision", `Путь уже занят: ${collision}`, destination);
      const metadataFailure = await this.ensureWorkspaceMetadata();
      if (metadataFailure) return metadataFailure;
      const latest = await this.currentForWrite(reference);
      if (latest.status === "error") return latest;
      await this.filePort.write(destination, latest.value.raw.content, { exclusive: true });
      const copied = await this.filePort.read(destination);
      if (await hashDocumentContent(copied.content) !== latest.value.document.contentHash) {
        await this.filePort.delete(destination).catch(() => undefined);
        return failure("verification-failed", "Копия не совпала с исходным документом.", destination);
      }
      const beforeDelete = await this.currentForWrite(reference);
      if (beforeDelete.status === "error") {
        await this.filePort.delete(destination).catch(() => undefined);
        return beforeDelete;
      }
      try {
        await this.filePort.delete(sourcePath, {
          expectedContentHash: beforeDelete.value.document.contentHash
        });
      } catch (error) {
        await this.filePort.delete(destination).catch(() => undefined);
        return storageFailure(error, sourcePath);
      }
      return this.readPath(destination);
    } catch (error) {
      return storageFailure(error, destination);
    }
  }

  async renameDocument(
    command: RenameStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    try {
      return this.verifiedMove(
        command.reference,
        renamedMarkdownPath(command.reference.relativePath, command.nextFileName)
      );
    } catch (error) {
      return storageFailure(error, command.reference.relativePath);
    }
  }

  async moveDocument(
    command: MoveStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    try {
      const folder = normalizeWorkspaceDirectoryPath(command.destinationFolder);
      if (folder && hasIgnoredWorkspaceDirectory(folder)) {
        return failure("invalid-path", "Нельзя перемещать документ в служебную папку.", folder);
      }
      const destination = folder
        ? `${folder}/${workspacePathBasename(command.reference.relativePath)}`
        : workspacePathBasename(command.reference.relativePath);
      return this.verifiedMove(command.reference, destination);
    } catch (error) {
      return storageFailure(error, command.destinationFolder);
    }
  }

  async makeDocumentManaged(
    command: MakeStoredDocumentManagedCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const current = await this.currentForWrite(command.reference);
    if (current.status === "error") return current;
    const desiredId = command.documentId ?? managedExternalDocumentId(this.createId());
    if (current.value.document.metadata.psozhId) {
      return current.value.document.metadata.psozhId === desiredId
        ? ok(current.value.document)
        : failure("duplicate-id", "У документа уже есть другой psozh-id.", command.reference.relativePath);
    }
    const scan = await this.scan();
    if (scan.documents.some((document) =>
      document.reference.relativePath !== command.reference.relativePath &&
      document.metadata.psozhId === desiredId
    )) {
      return failure("duplicate-id", `psozh-id «${desiredId}» уже используется.`, command.reference.relativePath);
    }
    const metadataFailure = await this.ensureWorkspaceMetadata();
    if (metadataFailure) return metadataFailure;
    const latest = await this.currentForWrite(command.reference);
    if (latest.status === "error") return latest;
    const mutation = addPsozhId(latest.value.raw.content, desiredId);
    if (mutation.status === "blocked") {
      return failure("malformed-frontmatter", mutation.message, command.reference.relativePath);
    }
    const intendedHash = await hashDocumentContent(mutation.content);
    try {
      await this.filePort.write(command.reference.relativePath, mutation.content, {
        exclusive: false,
        expectedContentHash: command.reference.expectedContentHash
      });
      const updated = await this.readPath(command.reference.relativePath);
      if (updated.status === "error") return updated;
      if (updated.value.contentHash !== intendedHash || updated.value.metadata.psozhId !== desiredId ||
        updated.value.body !== current.value.document.body) {
        if (updated.value.contentHash === intendedHash) {
          await this.filePort.write(command.reference.relativePath, current.value.raw.content, {
            exclusive: false,
            expectedContentHash: intendedHash
          }).catch(() => undefined);
        }
        return failure("verification-failed", "Добавление устойчивой идентичности не прошло проверку.", command.reference.relativePath);
      }
      return updated;
    } catch (error) {
      return storageFailure(error, command.reference.relativePath);
    }
  }

  private trashPaths(tombstoneId: string): { readonly markdown: string; readonly manifest: string } {
    const safeId = encodeURIComponent(tombstoneId);
    return {
      markdown: `.psozh/trash/${safeId}.md`,
      manifest: `.psozh/trash/${safeId}.json`
    };
  }

  async deleteDocument(
    command: DeleteStoredDocumentCommand
  ): Promise<DocumentStorageResult<DeletedStoredDocument>> {
    const current = await this.currentForWrite(command.reference);
    if (current.status === "error") return current;
    const metadataFailure = await this.ensureWorkspaceMetadata();
    if (metadataFailure) return metadataFailure;
    const tombstoneId = this.createId();
    const deletedAt = this.now().toISOString();
    const paths = this.trashPaths(tombstoneId);
    const manifest: TrashManifest = {
      schemaVersion: 1,
      tombstoneId,
      workspaceId: this.workspaceId,
      originalRelativePath: command.reference.relativePath,
      deletedAt,
      contentHash: current.value.document.contentHash,
      documentId: current.value.document.reference.documentId
    };
    try {
      await this.filePort.createFolder(".psozh/trash");
      await this.filePort.write(paths.markdown, current.value.raw.content, { exclusive: true });
      const copied = await this.filePort.read(paths.markdown);
      if (await hashDocumentContent(copied.content) !== current.value.document.contentHash) {
        await this.filePort.delete(paths.markdown).catch(() => undefined);
        return failure("verification-failed", "Копия в корзине не прошла проверку.", command.reference.relativePath);
      }
      await this.filePort.write(paths.manifest, JSON.stringify(manifest, null, 2), { exclusive: true });
      const beforeDelete = await this.currentForWrite(command.reference);
      if (beforeDelete.status === "error") {
        await this.filePort.delete(paths.markdown).catch(() => undefined);
        await this.filePort.delete(paths.manifest).catch(() => undefined);
        return beforeDelete;
      }
      try {
        await this.filePort.delete(command.reference.relativePath, {
          expectedContentHash: beforeDelete.value.document.contentHash
        });
      } catch (error) {
        await this.filePort.delete(paths.markdown).catch(() => undefined);
        await this.filePort.delete(paths.manifest).catch(() => undefined);
        return storageFailure(error, command.reference.relativePath);
      }
      return ok({
        tombstoneId,
        originalReference: command.reference,
        deletedAt,
        contentHash: current.value.document.contentHash,
        documentId: current.value.document.reference.documentId
      });
    } catch (error) {
      return storageFailure(error, command.reference.relativePath);
    }
  }

  private async readTrashManifest(
    workspaceId: string,
    tombstoneId: string
  ): Promise<DocumentStorageResult<TrashManifest>> {
    const mismatch = this.assertWorkspace(workspaceId);
    if (mismatch) return mismatch;
    const paths = this.trashPaths(tombstoneId);
    try {
      const read = await this.filePort.read(paths.manifest);
      const manifest = trashManifest(JSON.parse(read.content) as unknown);
      if (!manifest || manifest.workspaceId !== this.workspaceId || manifest.tombstoneId !== tombstoneId) {
        return failure("verification-failed", "Сведения элемента корзины повреждены.", paths.manifest);
      }
      return ok(manifest);
    } catch (error) {
      return storageFailure(error, paths.manifest);
    }
  }

  async restoreDocument(
    command: RestoreStoredDocumentCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const manifestResult = await this.readTrashManifest(command.workspaceId, command.tombstoneId);
    if (manifestResult.status === "error") return manifestResult;
    const manifest = manifestResult.value;
    let destination: string;
    try {
      destination = storedMarkdownPath(command.alternativeRelativePath ?? manifest.originalRelativePath);
      const collision = await this.existingCollision(destination);
      if (collision) return failure("path-collision", `Путь уже занят: ${collision}`, destination);
    } catch (error) {
      return storageFailure(error, command.alternativeRelativePath ?? manifest.originalRelativePath);
    }
    const paths = this.trashPaths(command.tombstoneId);
    try {
      const trashed = await this.filePort.read(paths.markdown);
      if (await hashDocumentContent(trashed.content) !== manifest.contentHash) {
        return failure("verification-failed", "Файл в корзине изменён или повреждён.", paths.markdown);
      }
      await this.filePort.write(destination, trashed.content, { exclusive: true });
      const restored = await this.readPath(destination);
      if (restored.status === "error" || restored.value.contentHash !== manifest.contentHash) {
        await this.filePort.delete(destination).catch(() => undefined);
        return failure("verification-failed", "Восстановленный файл не прошёл проверку.", destination);
      }
      await this.filePort.delete(paths.markdown);
      await this.filePort.delete(paths.manifest);
      return restored;
    } catch (error) {
      return storageFailure(error, destination);
    }
  }

  async purgeDocument(
    command: PurgeStoredDocumentCommand
  ): Promise<DocumentStorageResult<DeletedStoredDocument>> {
    const manifestResult = await this.readTrashManifest(command.workspaceId, command.tombstoneId);
    if (manifestResult.status === "error") return manifestResult;
    const manifest = manifestResult.value;
    const paths = this.trashPaths(command.tombstoneId);
    try {
      await this.filePort.delete(paths.markdown);
      await this.filePort.delete(paths.manifest);
      return ok({
        tombstoneId: manifest.tombstoneId,
        originalReference: {
          workspaceId: manifest.workspaceId,
          relativePath: manifest.originalRelativePath,
          documentId: manifest.documentId as DocumentId,
          expectedContentHash: manifest.contentHash
        },
        deletedAt: manifest.deletedAt,
        contentHash: manifest.contentHash,
        documentId: manifest.documentId as DocumentId
      });
    } catch (error) {
      return storageFailure(error, paths.markdown);
    }
  }

  async saveConflictCopy(
    command: SaveStoredDocumentConflictCopyCommand
  ): Promise<DocumentStorageResult<StoredDocument>> {
    const mismatch = this.assertWorkspace(command.reference.workspaceId);
    if (mismatch) return mismatch;
    const metadataFailure = await this.ensureWorkspaceMetadata();
    if (metadataFailure) return metadataFailure;
    const id = managedExternalDocumentId(this.createId());
    const base = markdownTitle(command.reference.relativePath);
    const relativePath = `.psozh/conflicts/${base}-${conflictSafeTimestamp(this.now())}-${encodeURIComponent(id)}.md`;
    try {
      await this.filePort.createFolder(".psozh/conflicts");
      await this.filePort.write(relativePath, newManagedMarkdown(id, command.body), { exclusive: true });
      return this.readPath(relativePath);
    } catch (error) {
      return storageFailure(error, relativePath);
    }
  }

  async createFolder(
    command: CreateStoredFolderCommand
  ): Promise<DocumentStorageResult<StoredFolderOperation>> {
    const mismatch = this.assertWorkspace(command.workspaceId);
    if (mismatch) return mismatch;
    try {
      const relativePath = normalizeWorkspaceRelativePath(command.relativePath);
      if (hasIgnoredWorkspaceDirectory(relativePath)) {
        return failure("invalid-path", "Нельзя создать пользовательскую служебную папку.", relativePath);
      }
      const collision = await this.existingCollision(relativePath);
      if (collision) return failure("path-collision", `Путь уже занят: ${collision}`, relativePath);
      const metadataFailure = await this.ensureWorkspaceMetadata();
      if (metadataFailure) return metadataFailure;
      await this.filePort.createFolder(relativePath);
      return ok({ relativePath, affectedDocuments: [] });
    } catch (error) {
      return storageFailure(error, command.relativePath);
    }
  }

  private async moveFolderContents(
    sourcePath: string,
    destinationPath: string
  ): Promise<DocumentStorageResult<StoredFolderOperation>> {
    const source = normalizeWorkspaceRelativePath(sourcePath);
    const destination = normalizeWorkspaceRelativePath(destinationPath);
    if (hasIgnoredWorkspaceDirectory(source) || hasIgnoredWorkspaceDirectory(destination)) {
      return failure("invalid-path", "Служебные папки нельзя перемещать или переименовывать.", source);
    }
    const sourceCollisionKey = workspacePathCollisionKey(source);
    const destinationCollisionKey = workspacePathCollisionKey(destination);
    if (destinationCollisionKey.startsWith(`${sourceCollisionKey}/`)) {
      return failure("invalid-path", "Нельзя переместить папку внутрь неё самой.", destination);
    }
    if (workspacePathCollisionKey(source) === workspacePathCollisionKey(destination)) {
      return failure("path-collision", "Папки различаются только регистром.", destination);
    }
    const snapshot = await this.filePort.list();
    const sourcePrefix = `${source}/`;
    const files = snapshot.files.filter((entry) => entry.relativePath.startsWith(sourcePrefix));
    const sourceFolders = snapshot.folders
      .filter((folder) => folder === source || folder.startsWith(sourcePrefix));
    if (!sourceFolders.some((folder) => workspacePathCollisionKey(folder) === workspacePathCollisionKey(source))) {
      return failure("not-found", "Исходная папка не найдена.", source);
    }
    if ((snapshot.protectedFolders ?? []).some((folder) =>
      folder.startsWith(sourcePrefix) || workspacePathCollisionKey(folder) === workspacePathCollisionKey(source)
    )) {
      return failure(
        "unsupported",
        "Папка содержит служебное поддерево (.obsidian, .psozh или .git) и не будет перемещена частично.",
        source
      );
    }
    const destinationKey = workspacePathCollisionKey(destination);
    const destinationCollision = snapshot.files.find((entry) =>
      workspacePathCollisionKey(entry.relativePath) === destinationKey
    ) ?? snapshot.folders.find((entry) =>
      workspacePathCollisionKey(entry) === destinationKey &&
      entry !== source && !entry.startsWith(sourcePrefix)
    );
    if (destinationCollision) {
      return failure(
        "path-collision",
        `Путь назначения занят: ${typeof destinationCollision === "string" ? destinationCollision : destinationCollision.relativePath}`,
        destination
      );
    }
    if (files.some((entry) => !isMarkdownWorkspacePath(entry.relativePath))) {
      return failure(
        "unsupported",
        "Папка содержит не-Markdown файлы; браузерный текстовый адаптер не будет перемещать их вслепую.",
        source
      );
    }
    const movingKeys = new Set(files.map((entry) => workspacePathCollisionKey(entry.relativePath)));
    const movingFolderKeys = new Set(sourceFolders.map(workspacePathCollisionKey));
    const destinations = files.map((entry) => ({
      source: entry.relativePath,
      destination: `${destination}/${entry.relativePath.slice(sourcePrefix.length)}`
    }));
    const folderDestinations = sourceFolders.map((folder) => ({
      source: folder,
      destination: folder === source
        ? destination
        : `${destination}/${folder.slice(sourcePrefix.length)}`
    }));
    for (const entry of destinations) {
      const key = workspacePathCollisionKey(entry.destination);
      const collision = snapshot.files.find((candidate) =>
        workspacePathCollisionKey(candidate.relativePath) === key &&
        !movingKeys.has(workspacePathCollisionKey(candidate.relativePath))
      ) ?? snapshot.folders.find((candidate) => workspacePathCollisionKey(candidate) === key);
      if (collision) {
        return failure(
          "path-collision",
          `Путь назначения занят: ${typeof collision === "string" ? collision : collision.relativePath}`,
          entry.destination
        );
      }
    }
    for (const entry of folderDestinations) {
      const key = workspacePathCollisionKey(entry.destination);
      const collision = snapshot.files.find((candidate) =>
        workspacePathCollisionKey(candidate.relativePath) === key &&
        !movingKeys.has(workspacePathCollisionKey(candidate.relativePath))
      ) ?? snapshot.folders.find((candidate) =>
        workspacePathCollisionKey(candidate) === key &&
        !movingFolderKeys.has(workspacePathCollisionKey(candidate))
      );
      if (collision) {
        return failure(
          "path-collision",
          `Папка назначения занята: ${typeof collision === "string" ? collision : collision.relativePath}`,
          entry.destination
        );
      }
    }

    const metadataFailure = await this.ensureWorkspaceMetadata();
    if (metadataFailure) return metadataFailure;

    const copied: Array<{
      readonly source: string;
      readonly destination: string;
      readonly contentHash: string;
    }> = [];
    const createdFolders: string[] = [];
    const cleanupCopies = async (): Promise<void> => {
      await Promise.all(copied.map((entry) =>
        this.filePort.delete(entry.destination).catch(() => undefined)
      ));
      const copiedFolders = new Set<string>(createdFolders);
      copied.forEach((entry) => {
        let folder = workspacePathDirname(entry.destination);
        while (folder && (folder === destination || folder.startsWith(`${destination}/`))) {
          copiedFolders.add(folder);
          folder = workspacePathDirname(folder);
        }
      });
      for (const folder of [...copiedFolders].sort((left, right) => right.length - left.length)) {
        await this.filePort.deleteFolder(folder).catch(() => undefined);
      }
    };
    try {
      for (const entry of [...folderDestinations].sort((left, right) => left.destination.length - right.destination.length)) {
        await this.filePort.createFolder(entry.destination);
        createdFolders.push(entry.destination);
      }
      for (const entry of destinations.sort((left, right) => compareWorkspacePaths(left.source, right.source))) {
        const read = await this.filePort.read(entry.source);
        const expected = await hashDocumentContent(read.content);
        await this.filePort.write(entry.destination, read.content, { exclusive: true });
        const verification = await this.filePort.read(entry.destination);
        if (await hashDocumentContent(verification.content) !== expected) {
          throw new Error(`Не удалось проверить «${entry.destination}».`);
        }
        copied.push({ ...entry, contentHash: expected });
      }
    } catch (error) {
      await cleanupCopies();
      return storageFailure(error, destination);
    }

    for (const entry of copied) {
      try {
        const latest = await this.filePort.read(entry.source);
        if (await hashDocumentContent(latest.content) !== entry.contentHash) {
          await cleanupCopies();
          return failure(
            "external-modification",
            `Файл «${entry.source}» изменён в другом приложении; папка не перемещена.`,
            entry.source
          );
        }
      } catch (error) {
        await cleanupCopies();
        return storageFailure(error, entry.source);
      }
    }

    const deletedSources: typeof copied = [];
    try {
      for (const entry of [...copied].sort((left, right) => compareWorkspacePaths(right.source, left.source))) {
        await this.filePort.delete(entry.source, { expectedContentHash: entry.contentHash });
        deletedSources.push(entry);
      }
      for (const folder of [...sourceFolders].sort((left, right) => right.length - left.length)) {
        await this.filePort.deleteFolder(folder);
      }
      return ok({
        relativePath: destination,
        affectedDocuments: destinations.map((entry) => entry.destination)
      });
    } catch (error) {
      const restorationFailures: string[] = [];
      for (const entry of deletedSources) {
        try {
          const destinationCopy = await this.filePort.read(entry.destination);
          await this.filePort.write(entry.source, destinationCopy.content, { exclusive: true });
          const restored = await this.filePort.read(entry.source);
          if (await hashDocumentContent(restored.content) !== entry.contentHash) {
            restorationFailures.push(entry.source);
          }
        } catch {
          restorationFailures.push(entry.source);
        }
      }
      if (!restorationFailures.length) await cleanupCopies();
      return {
        ...storageFailure(error, source),
        affectedPaths: restorationFailures.length
          ? [...new Set([...restorationFailures, ...copied.map((entry) => entry.destination)])]
          : deletedSources.map((entry) => entry.source),
        recoveryRequired: restorationFailures.length > 0
      };
    }
  }

  async renameFolder(
    command: RenameStoredFolderCommand
  ): Promise<DocumentStorageResult<StoredFolderOperation>> {
    const mismatch = this.assertWorkspace(command.workspaceId);
    if (mismatch) return mismatch;
    try {
      const source = normalizeWorkspaceRelativePath(command.relativePath);
      const name = normalizeWorkspacePathSegment(command.nextName);
      const parent = workspacePathDirname(source);
      const destination = parent ? `${parent}/${name}` : name;
      return this.moveFolderContents(source, destination);
    } catch (error) {
      return storageFailure(error, command.relativePath);
    }
  }

  async moveFolder(
    command: MoveStoredFolderCommand
  ): Promise<DocumentStorageResult<StoredFolderOperation>> {
    const mismatch = this.assertWorkspace(command.workspaceId);
    if (mismatch) return mismatch;
    try {
      const source = normalizeWorkspaceRelativePath(command.relativePath);
      const destinationFolder = normalizeWorkspaceDirectoryPath(command.destinationFolder);
      const destination = destinationFolder
        ? `${destinationFolder}/${workspacePathBasename(source)}`
        : workspacePathBasename(source);
      return this.moveFolderContents(source, destination);
    } catch (error) {
      return storageFailure(error, command.relativePath);
    }
  }
}
