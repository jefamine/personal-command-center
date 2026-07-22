import type { DocumentId } from "../../domain/documents/documentContract";
import type {
  DocumentScanError,
  DocumentScanResult,
  DocumentScanSummary,
  DocumentWorkspaceAccessState,
  DocumentWorkspaceDescriptor,
  ExternalDocumentState
} from "../../domain/documents/workspace/documentWorkspaceContract";
import { isValidPsozhId } from "../../domain/documents/workspace/documentWorkspaceIdentity";
import {
  isMarkdownWorkspacePath,
  normalizeWorkspaceRelativePath,
  shouldIgnoreWorkspaceEntry,
  workspacePathBasename
} from "../../domain/documents/workspace/workspacePaths";

export const BROWSER_WORKSPACE_DATABASE_NAME = "personal-command-center-document-workspaces";
export const BROWSER_WORKSPACE_DATABASE_VERSION = 1;

export const BROWSER_WORKSPACE_STORES = {
  descriptors: "workspace-descriptors",
  handles: "directory-handles",
  indexes: "document-indexes"
} as const;

export type BrowserWorkspaceStoreName =
  (typeof BROWSER_WORKSPACE_STORES)[keyof typeof BROWSER_WORKSPACE_STORES];

const ACTIVE_DESCRIPTOR_KEY = "active-workspace";
const PERSISTENCE_SCHEMA_VERSION = 1;

/**
 * Metadata-only projection retained for reconnect and an unavailable-folder tree.
 * Canonical Markdown, body previews and raw frontmatter deliberately have no field here.
 */
export interface PersistedDocumentIndexEntry {
  readonly documentId: DocumentId;
  readonly relativePath: string;
  readonly fileName: string;
  readonly title: string;
  readonly extension: ".md";
  readonly size: number;
  readonly lastModified: number;
  readonly contentHash: string;
  readonly psozhId: string | null;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly state: ExternalDocumentState;
}

export interface PersistedDocumentWorkspaceIndex {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly scannedAt: string;
  readonly folders: readonly string[];
  readonly documents: readonly PersistedDocumentIndexEntry[];
  readonly errors: readonly DocumentScanError[];
  readonly summary: DocumentScanSummary;
}

interface PersistedDescriptorEnvelope {
  readonly schemaVersion: 1;
  readonly descriptor: DocumentWorkspaceDescriptor;
}

/** Small injectable boundary; tests do not need a real IndexedDB implementation. */
export interface BrowserWorkspacePersistencePort {
  get(store: BrowserWorkspaceStoreName, key: string): Promise<unknown>;
  put(store: BrowserWorkspaceStoreName, key: string, value: unknown): Promise<void>;
  delete(store: BrowserWorkspaceStoreName, key: string): Promise<void>;
}

export interface DisconnectWorkspaceOptions {
  /** Explicitly forget browser permission data. Mapping/index metadata is still retained. */
  readonly removeHandle?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const accessStates: readonly DocumentWorkspaceAccessState[] = [
  "unsupported",
  "disconnected",
  "prompt",
  "granted",
  "denied"
];

const externalDocumentStates: readonly ExternalDocumentState[] = [
  "managed",
  "unmanaged",
  "malformed-frontmatter",
  "conflict",
  "inaccessible"
];

const scanErrorCodes: readonly DocumentScanError["code"][] = [
  "inaccessible",
  "malformed-frontmatter",
  "duplicate-id",
  "path-collision"
];

function normalizeDescriptor(value: unknown): DocumentWorkspaceDescriptor | null {
  if (!isRecord(value)) return null;
  if (
    (value.mode !== "internal" && value.mode !== "external-folder") ||
    !isNullableString(value.workspaceId) ||
    !isNullableString(value.displayName) ||
    !isNullableString(value.handleKey) ||
    !accessStates.includes(value.access as DocumentWorkspaceAccessState) ||
    !isNullableString(value.lastScanAt) ||
    !isNullableString(value.vaultName) ||
    !isNullableString(value.vaultRelativeRoot)
  ) {
    return null;
  }

  return {
    mode: value.mode,
    workspaceId: value.workspaceId,
    displayName: value.displayName,
    handleKey: value.handleKey,
    access: value.access as DocumentWorkspaceAccessState,
    lastScanAt: value.lastScanAt,
    vaultName: value.vaultName,
    vaultRelativeRoot: value.vaultRelativeRoot
  };
}

function descriptorEnvelope(value: unknown): PersistedDescriptorEnvelope | null {
  if (!isRecord(value) || value.schemaVersion !== PERSISTENCE_SCHEMA_VERSION) return null;
  const descriptor = normalizeDescriptor(value.descriptor);
  return descriptor ? { schemaVersion: 1, descriptor } : null;
}

function normalizeScanSummary(value: unknown): DocumentScanSummary | null {
  if (!isRecord(value)) return null;
  const fields: Array<keyof DocumentScanSummary> = [
    "folders",
    "markdownFiles",
    "managedFiles",
    "unmanagedFiles",
    "malformedFrontmatter",
    "duplicateIds",
    "pathCollisions",
    "unreadableFiles"
  ];
  if (!fields.every((field) => Number.isInteger(value[field]) && Number(value[field]) >= 0)) {
    return null;
  }
  return Object.fromEntries(fields.map((field) => [field, Number(value[field])])) as unknown as DocumentScanSummary;
}

function normalizeScanError(value: unknown): DocumentScanError | null {
  if (
    !isRecord(value) ||
    typeof value.relativePath !== "string" ||
    !scanErrorCodes.includes(value.code as DocumentScanError["code"]) ||
    typeof value.message !== "string"
  ) {
    return null;
  }
  return {
    relativePath: value.relativePath,
    code: value.code as DocumentScanError["code"],
    message: value.message
  };
}

function normalizeIndexEntry(value: unknown): PersistedDocumentIndexEntry | null {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" || !value.documentId.trim() ||
    typeof value.relativePath !== "string" ||
    typeof value.fileName !== "string" ||
    typeof value.title !== "string" ||
    value.extension !== ".md" ||
    !isFiniteNonNegativeNumber(value.size) ||
    !isFiniteNonNegativeNumber(value.lastModified) ||
    typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.contentHash) ||
    !isNullableString(value.psozhId) ||
    !isStringArray(value.tags) ||
    !isStringArray(value.aliases) ||
    !externalDocumentStates.includes(value.state as ExternalDocumentState)
  ) {
    return null;
  }

  let relativePath: string;
  try {
    relativePath = normalizeWorkspaceRelativePath(value.relativePath);
  } catch {
    return null;
  }
  if (relativePath !== value.relativePath || shouldIgnoreWorkspaceEntry(relativePath, "file") ||
    !isMarkdownWorkspacePath(relativePath) || workspacePathBasename(relativePath) !== value.fileName ||
    (value.psozhId !== null && !isValidPsozhId(value.psozhId))) return null;

  return {
    documentId: value.documentId as DocumentId,
    relativePath,
    fileName: value.fileName,
    title: value.title,
    extension: ".md",
    size: value.size,
    lastModified: value.lastModified,
    contentHash: value.contentHash,
    psozhId: value.psozhId,
    tags: [...value.tags],
    aliases: [...value.aliases],
    state: value.state as ExternalDocumentState
  };
}

function normalizeIndex(value: unknown): PersistedDocumentWorkspaceIndex | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PERSISTENCE_SCHEMA_VERSION ||
    typeof value.workspaceId !== "string" ||
    !value.workspaceId.trim() ||
    typeof value.scannedAt !== "string" || Number.isNaN(Date.parse(value.scannedAt)) ||
    !isStringArray(value.folders) ||
    !Array.isArray(value.documents) ||
    !Array.isArray(value.errors)
  ) {
    return null;
  }
  const documents = value.documents.map(normalizeIndexEntry);
  const errors = value.errors.map(normalizeScanError);
  const summary = normalizeScanSummary(value.summary);
  const folders = value.folders.map((folder) => {
    try {
      const normalized = normalizeWorkspaceRelativePath(folder);
      return normalized === folder && !shouldIgnoreWorkspaceEntry(normalized, "directory")
        ? normalized
        : null;
    } catch {
      return null;
    }
  });
  if (documents.some((entry) => entry === null) || errors.some((entry) => entry === null) ||
    folders.some((entry) => entry === null) || !summary) {
    return null;
  }
  return {
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    scannedAt: value.scannedAt,
    folders: folders as string[],
    documents: documents as PersistedDocumentIndexEntry[],
    errors: errors as DocumentScanError[],
    summary
  };
}

function cloneDescriptor(descriptor: DocumentWorkspaceDescriptor): DocumentWorkspaceDescriptor {
  return {
    mode: descriptor.mode,
    workspaceId: descriptor.workspaceId,
    displayName: descriptor.displayName,
    handleKey: descriptor.handleKey,
    access: descriptor.access,
    lastScanAt: descriptor.lastScanAt,
    vaultName: descriptor.vaultName,
    vaultRelativeRoot: descriptor.vaultRelativeRoot
  };
}

export function documentWorkspaceIndexFromScan(
  scan: DocumentScanResult
): PersistedDocumentWorkspaceIndex {
  return {
    schemaVersion: 1,
    workspaceId: scan.workspaceId,
    scannedAt: scan.scannedAt,
    folders: [...scan.folders],
    documents: scan.documents.map((document) => ({
      documentId: document.reference.documentId,
      relativePath: document.reference.relativePath,
      fileName: document.fileName,
      title: document.title,
      extension: ".md",
      size: document.size,
      lastModified: document.lastModified,
      contentHash: document.contentHash,
      psozhId: document.metadata.psozhId,
      tags: [...document.metadata.tags],
      aliases: [...document.metadata.aliases],
      state: document.state
    })),
    errors: scan.errors.map((error) => ({ ...error })),
    summary: { ...scan.summary }
  };
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (!isRecord(value)) return false;
  return value.kind === "directory" &&
    typeof value.name === "string" &&
    typeof value.getDirectoryHandle === "function" &&
    typeof value.getFileHandle === "function";
}

/**
 * High-level persistence for browser workspace coordination. It intentionally
 * cannot save canonical document bodies because its public index type omits them.
 */
export class BrowserWorkspacePersistence {
  constructor(private readonly port: BrowserWorkspacePersistencePort) {}

  async loadDescriptor(): Promise<DocumentWorkspaceDescriptor | null> {
    const envelope = descriptorEnvelope(
      await this.port.get(BROWSER_WORKSPACE_STORES.descriptors, ACTIVE_DESCRIPTOR_KEY)
    );
    return envelope ? cloneDescriptor(envelope.descriptor) : null;
  }

  async saveDescriptor(descriptor: DocumentWorkspaceDescriptor): Promise<void> {
    const normalized = normalizeDescriptor(descriptor);
    if (!normalized) throw new Error("Document workspace descriptor is invalid.");
    const envelope: PersistedDescriptorEnvelope = {
      schemaVersion: 1,
      descriptor: cloneDescriptor(normalized)
    };
    await this.port.put(BROWSER_WORKSPACE_STORES.descriptors, ACTIVE_DESCRIPTOR_KEY, envelope);
  }

  async loadDirectoryHandle(handleKey: string): Promise<FileSystemDirectoryHandle | null> {
    if (!handleKey.trim()) return null;
    const value = await this.port.get(BROWSER_WORKSPACE_STORES.handles, handleKey);
    return isDirectoryHandle(value) ? value : null;
  }

  async saveDirectoryHandle(handleKey: string, handle: FileSystemDirectoryHandle): Promise<void> {
    if (!handleKey.trim()) throw new Error("Directory handle key must not be empty.");
    await this.port.put(BROWSER_WORKSPACE_STORES.handles, handleKey, handle);
  }

  async removeDirectoryHandle(handleKey: string): Promise<void> {
    if (!handleKey.trim()) return;
    await this.port.delete(BROWSER_WORKSPACE_STORES.handles, handleKey);
  }

  async loadIndex(workspaceId: string): Promise<PersistedDocumentWorkspaceIndex | null> {
    if (!workspaceId.trim()) return null;
    const index = normalizeIndex(await this.port.get(BROWSER_WORKSPACE_STORES.indexes, workspaceId));
    return index?.workspaceId === workspaceId ? index : null;
  }

  async saveIndex(index: PersistedDocumentWorkspaceIndex): Promise<void> {
    const normalized = normalizeIndex(index);
    if (!normalized) throw new Error("Document workspace index is invalid.");
    await this.port.put(BROWSER_WORKSPACE_STORES.indexes, normalized.workspaceId, normalized);
  }

  async saveScanIndex(scan: DocumentScanResult): Promise<void> {
    await this.saveIndex(documentWorkspaceIndexFromScan(scan));
  }

  /**
   * Switches back to internal mode without deleting external files or metadata.
   * The index and stable mapping remain available for a later reconnect.
   */
  async disconnectWorkspace(
    options: DisconnectWorkspaceOptions = {}
  ): Promise<DocumentWorkspaceDescriptor | null> {
    const current = await this.loadDescriptor();
    if (!current) return null;
    const disconnected: DocumentWorkspaceDescriptor = {
      ...current,
      mode: "internal",
      access: "disconnected"
    };
    await this.saveDescriptor(disconnected);
    if (options.removeHandle && current.handleKey) {
      await this.removeDirectoryHandle(current.handleKey);
    }
    return disconnected;
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = factory.open(
      BROWSER_WORKSPACE_DATABASE_NAME,
      BROWSER_WORKSPACE_DATABASE_VERSION
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      Object.values(BROWSER_WORKSPACE_STORES).forEach((storeName) => {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName);
        }
      });
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Workspace database could not be opened."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Workspace database upgrade is blocked by another tab."));
    };
  });
}

/** Real IndexedDB port. All browser-specific calls remain in this file. */
export class IndexedDbBrowserWorkspacePersistencePort implements BrowserWorkspacePersistencePort {
  constructor(private readonly factory: IDBFactory) {}

  async get(storeName: BrowserWorkspaceStoreName, key: string): Promise<unknown> {
    const database = await openDatabase(this.factory);
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      let value: unknown;
      let failure: DOMException | null = null;
      request.onsuccess = () => { value = request.result as unknown; };
      request.onerror = () => { failure = request.error; };
      transaction.oncomplete = () => {
        database.close();
        if (failure) reject(failure);
        else resolve(value);
      };
      transaction.onerror = () => {
        database.close();
        reject(failure ?? transaction.error ?? new Error("Workspace metadata could not be read."));
      };
      transaction.onabort = () => {
        database.close();
        reject(failure ?? transaction.error ?? new Error("Workspace metadata read was aborted."));
      };
    });
  }

  async put(storeName: BrowserWorkspaceStoreName, key: string, value: unknown): Promise<void> {
    const database = await openDatabase(this.factory);
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("Workspace metadata could not be saved."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error("Workspace metadata save was aborted."));
      };
    });
  }

  async delete(storeName: BrowserWorkspaceStoreName, key: string): Promise<void> {
    const database = await openDatabase(this.factory);
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("Workspace metadata could not be removed."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error("Workspace metadata removal was aborted."));
      };
    });
  }
}

export function createBrowserWorkspacePersistence(
  factory: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB
): BrowserWorkspacePersistence | null {
  return factory
    ? new BrowserWorkspacePersistence(new IndexedDbBrowserWorkspacePersistencePort(factory))
    : null;
}
