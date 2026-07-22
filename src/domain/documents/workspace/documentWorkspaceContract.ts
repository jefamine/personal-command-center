import type { DocumentId } from "../documentContract";

/** Selects the canonical document storage used by the workspace. */
export type DocumentWorkspaceMode = "internal" | "external-folder";

export type DocumentWorkspaceAccessState =
  | "unsupported"
  | "disconnected"
  | "prompt"
  | "granted"
  | "denied";

/**
 * Portable connection metadata. A browser directory handle is stored under
 * handleKey in a separate local store and is never serialized into DashboardState.
 */
export interface DocumentWorkspaceDescriptor {
  readonly mode: DocumentWorkspaceMode;
  readonly workspaceId: string | null;
  readonly displayName: string | null;
  readonly handleKey: string | null;
  readonly access: DocumentWorkspaceAccessState;
  readonly lastScanAt: string | null;
  readonly vaultName: string | null;
  readonly vaultRelativeRoot: string | null;
}

export type ExternalDocumentState =
  | "managed"
  | "unmanaged"
  | "malformed-frontmatter"
  | "conflict"
  | "inaccessible";

export interface DocumentStorageReference {
  readonly workspaceId: string;
  /** Normalized POSIX-style path relative to the selected workspace root. */
  readonly relativePath: string;
  readonly documentId: DocumentId;
  readonly expectedContentHash?: string;
}

export interface StoredDocumentMetadata {
  readonly psozhId: string | null;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
}

/**
 * A fresh projection of one canonical Markdown file. body is not a cache to
 * persist in DashboardState; adapters recreate it by reading the physical file.
 */
export interface StoredDocument {
  readonly reference: DocumentStorageReference;
  readonly fileName: string;
  readonly title: string;
  readonly extension: ".md";
  readonly size: number;
  readonly lastModified: number;
  readonly contentHash: string;
  readonly rawFrontmatter: string | null;
  readonly body: string;
  readonly metadata: StoredDocumentMetadata;
  readonly state: ExternalDocumentState;
}

export interface DocumentScanError {
  readonly relativePath: string;
  readonly code: "inaccessible" | "malformed-frontmatter" | "duplicate-id" | "path-collision";
  readonly message: string;
}

export interface DocumentScanSummary {
  readonly folders: number;
  readonly markdownFiles: number;
  readonly managedFiles: number;
  readonly unmanagedFiles: number;
  readonly malformedFrontmatter: number;
  readonly duplicateIds: number;
  readonly pathCollisions: number;
  readonly unreadableFiles: number;
}

export interface DocumentScanResult {
  readonly workspaceId: string;
  readonly scannedAt: string;
  readonly documents: readonly StoredDocument[];
  readonly folders: readonly string[];
  readonly errors: readonly DocumentScanError[];
  readonly summary: DocumentScanSummary;
}

export interface CreateStoredDocumentCommand {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
  /** Existing IDs are supplied by migration; ordinary creation generates one. */
  readonly documentId?: DocumentId;
}

export interface UpdateStoredDocumentCommand {
  readonly reference: DocumentStorageReference;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
}

export interface RenameStoredDocumentCommand {
  readonly reference: DocumentStorageReference;
  readonly nextFileName: string;
}

export interface MoveStoredDocumentCommand {
  readonly reference: DocumentStorageReference;
  readonly destinationFolder: string;
}

export interface DeleteStoredDocumentCommand {
  readonly reference: DocumentStorageReference;
}

export interface DeletedStoredDocument {
  readonly tombstoneId: string;
  readonly originalReference: DocumentStorageReference;
  readonly deletedAt: string;
  readonly contentHash: string;
  readonly documentId: DocumentId;
}

export interface RestoreStoredDocumentCommand {
  readonly workspaceId: string;
  readonly tombstoneId: string;
  readonly alternativeRelativePath?: string;
}

export interface MakeStoredDocumentManagedCommand {
  readonly reference: DocumentStorageReference;
  readonly documentId?: DocumentId;
}

export interface SaveStoredDocumentConflictCopyCommand {
  readonly reference: DocumentStorageReference;
  readonly body: string;
}

export interface PurgeStoredDocumentCommand {
  readonly workspaceId: string;
  readonly tombstoneId: string;
}

export interface CreateStoredFolderCommand {
  readonly workspaceId: string;
  readonly relativePath: string;
}

export interface RenameStoredFolderCommand {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly nextName: string;
}

export interface MoveStoredFolderCommand {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly destinationFolder: string;
}

export interface StoredFolderOperation {
  readonly relativePath: string;
  readonly affectedDocuments: readonly string[];
}

export type DocumentStorageErrorCode =
  | "unsupported"
  | "permission-denied"
  | "not-found"
  | "already-exists"
  | "invalid-path"
  | "path-collision"
  | "external-modification"
  | "malformed-frontmatter"
  | "duplicate-id"
  | "inaccessible"
  | "verification-failed"
  | "operation-failed";

export interface DocumentStorageFailure {
  readonly status: "error";
  readonly code: DocumentStorageErrorCode;
  readonly message: string;
  readonly relativePath?: string;
  readonly current?: StoredDocument;
  /** Paths involved in a reported partial multi-file operation. */
  readonly affectedPaths?: readonly string[];
  readonly recoveryRequired?: boolean;
}

export type DocumentStorageResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | DocumentStorageFailure;

export interface DocumentScanOptions {
  readonly signal?: AbortSignal;
}

/**
 * Asynchronous, React-independent boundary over canonical document storage.
 * Implementations must check expectedContentHash before destructive writes.
 */
export interface DocumentStorageAdapter {
  scan(options?: DocumentScanOptions): Promise<DocumentScanResult>;
  readDocument(reference: DocumentStorageReference): Promise<DocumentStorageResult<StoredDocument>>;
  createDocument(command: CreateStoredDocumentCommand): Promise<DocumentStorageResult<StoredDocument>>;
  updateDocument(command: UpdateStoredDocumentCommand): Promise<DocumentStorageResult<StoredDocument>>;
  renameDocument(command: RenameStoredDocumentCommand): Promise<DocumentStorageResult<StoredDocument>>;
  moveDocument(command: MoveStoredDocumentCommand): Promise<DocumentStorageResult<StoredDocument>>;
  deleteDocument(command: DeleteStoredDocumentCommand): Promise<DocumentStorageResult<DeletedStoredDocument>>;
  restoreDocument(command: RestoreStoredDocumentCommand): Promise<DocumentStorageResult<StoredDocument>>;
  makeDocumentManaged(command: MakeStoredDocumentManagedCommand): Promise<DocumentStorageResult<StoredDocument>>;
  saveConflictCopy(command: SaveStoredDocumentConflictCopyCommand): Promise<DocumentStorageResult<StoredDocument>>;
  purgeDocument(command: PurgeStoredDocumentCommand): Promise<DocumentStorageResult<DeletedStoredDocument>>;
  createFolder(command: CreateStoredFolderCommand): Promise<DocumentStorageResult<StoredFolderOperation>>;
  renameFolder(command: RenameStoredFolderCommand): Promise<DocumentStorageResult<StoredFolderOperation>>;
  moveFolder(command: MoveStoredFolderCommand): Promise<DocumentStorageResult<StoredFolderOperation>>;
}
