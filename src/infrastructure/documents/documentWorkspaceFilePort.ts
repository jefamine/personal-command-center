export interface WorkspaceFileInfo {
  readonly relativePath: string;
  readonly size: number;
  readonly lastModified: number;
}

export interface WorkspaceDirectorySnapshot {
  readonly files: readonly WorkspaceFileInfo[];
  readonly folders: readonly string[];
  /** Ignored service subtrees seen during traversal but never read as documents. */
  readonly protectedFolders?: readonly string[];
}

export interface WorkspaceFileReadResult extends WorkspaceFileInfo {
  readonly content: string;
}

export interface WorkspaceFileWriteOptions {
  /** Fails instead of overwriting when the destination already exists. */
  readonly exclusive: boolean;
  /** Optional compare-before-write guard for an existing file. */
  readonly expectedContentHash?: string;
}

export interface WorkspaceFileDeleteOptions {
  readonly expectedContentHash?: string;
}

/** Minimal filesystem port used by the shared Markdown storage engine. */
export interface DocumentWorkspaceFilePort {
  list(signal?: AbortSignal): Promise<WorkspaceDirectorySnapshot>;
  read(relativePath: string): Promise<WorkspaceFileReadResult>;
  write(
    relativePath: string,
    content: string,
    options: WorkspaceFileWriteOptions
  ): Promise<WorkspaceFileInfo>;
  delete(relativePath: string, options?: WorkspaceFileDeleteOptions): Promise<void>;
  createFolder(relativePath: string): Promise<void>;
  deleteFolder(relativePath: string): Promise<void>;
}

export function workspaceFileErrorName(error: unknown): string {
  return error instanceof DOMException || error instanceof Error ? error.name : "Error";
}

export function isWorkspaceFileNotFound(error: unknown): boolean {
  return workspaceFileErrorName(error) === "NotFoundError";
}

export function isWorkspaceFilePermissionDenied(error: unknown): boolean {
  return ["NotAllowedError", "SecurityError"].includes(workspaceFileErrorName(error));
}
