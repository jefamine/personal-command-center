import {
  compareWorkspacePaths,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspaceRelativePath,
  shouldIgnoreWorkspaceEntry,
  workspacePathBasename,
  workspacePathDirname
} from "../../domain/documents/workspace/workspacePaths";
import { hashDocumentContent } from "../../domain/documents/workspace/documentContentHash";
import type {
  DocumentWorkspaceFilePort,
  WorkspaceDirectorySnapshot,
  WorkspaceFileInfo,
  WorkspaceFileReadResult,
  WorkspaceFileWriteOptions,
  WorkspaceFileDeleteOptions
} from "./documentWorkspaceFilePort";

export type BrowserDirectoryPermissionMode = "read" | "readwrite";

export interface BrowserFileLike {
  readonly size: number;
  readonly lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface BrowserWritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface BrowserFileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<BrowserFileLike>;
  createWritable(options?: { readonly keepExistingData?: boolean }): Promise<BrowserWritableLike>;
}

export interface BrowserDirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterableIterator<readonly [string, BrowserFileHandleLike | BrowserDirectoryHandleLike]>;
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean }
  ): Promise<BrowserDirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean }
  ): Promise<BrowserFileHandleLike>;
  removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor: { readonly mode: BrowserDirectoryPermissionMode }): Promise<PermissionState>;
  requestPermission?(descriptor: { readonly mode: BrowserDirectoryPermissionMode }): Promise<PermissionState>;
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (options?: {
    readonly id?: string;
    readonly mode?: BrowserDirectoryPermissionMode;
    readonly startIn?: string;
  }) => Promise<BrowserDirectoryHandleLike>;
}

function notFoundError(path: string): DOMException {
  return new DOMException(`Файл «${path}» не найден.`, "NotFoundError");
}

function alreadyExistsError(path: string): DOMException {
  return new DOMException(`Путь «${path}» уже занят.`, "InvalidModificationError");
}

function isNotFound(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "NotFoundError";
}

async function directoryAt(
  root: BrowserDirectoryHandleLike,
  relativePath: string,
  create: boolean
): Promise<BrowserDirectoryHandleLike> {
  const normalized = normalizeWorkspaceDirectoryPath(relativePath);
  let current = root;
  if (!normalized) return current;
  for (const segment of normalized.split("/")) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

async function fileInfo(
  relativePath: string,
  handle: BrowserFileHandleLike
): Promise<WorkspaceFileInfo> {
  const file = await handle.getFile();
  return { relativePath, size: file.size, lastModified: file.lastModified };
}

/** File System Access implementation of the narrow, testable filesystem port. */
export class BrowserDirectoryFilePort implements DocumentWorkspaceFilePort {
  constructor(readonly root: BrowserDirectoryHandleLike) {}

  async list(signal?: AbortSignal): Promise<WorkspaceDirectorySnapshot> {
    const files: WorkspaceFileInfo[] = [];
    const folders: string[] = [];
    const protectedFolders: string[] = [];

    const visit = async (directory: BrowserDirectoryHandleLike, prefix: string): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        if (signal?.aborted) throw new DOMException("Сканирование отменено.", "AbortError");
        const relativePath = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") {
          const normalized = normalizeWorkspaceRelativePath(relativePath);
          if (shouldIgnoreWorkspaceEntry(relativePath, "directory")) {
            protectedFolders.push(normalized);
            continue;
          }
          folders.push(normalized);
          await visit(handle, normalized);
          continue;
        }
        if (shouldIgnoreWorkspaceEntry(relativePath, "file")) continue;
        try {
          files.push(await fileInfo(normalizeWorkspaceRelativePath(relativePath), handle));
        } catch {
          // Keep an entry so the scanner can report this file without stopping the workspace.
          files.push({
            relativePath: normalizeWorkspaceRelativePath(relativePath),
            size: -1,
            lastModified: -1
          });
        }
      }
    };

    await visit(this.root, "");
    return {
      files: files.sort((left, right) => compareWorkspacePaths(left.relativePath, right.relativePath)),
      folders: folders.sort(compareWorkspacePaths),
      protectedFolders: protectedFolders.sort(compareWorkspacePaths)
    };
  }

  async read(relativePath: string): Promise<WorkspaceFileReadResult> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const directory = await directoryAt(this.root, workspacePathDirname(normalized), false);
    let handle: BrowserFileHandleLike;
    try {
      handle = await directory.getFileHandle(workspacePathBasename(normalized));
    } catch (error) {
      if (isNotFound(error)) throw notFoundError(normalized);
      throw error;
    }
    const file = await handle.getFile();
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
    return {
      relativePath: normalized,
      content,
      size: file.size,
      lastModified: file.lastModified
    };
  }

  async write(
    relativePath: string,
    content: string,
    options: WorkspaceFileWriteOptions
  ): Promise<WorkspaceFileInfo> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const directory = await directoryAt(this.root, workspacePathDirname(normalized), true);
    const name = workspacePathBasename(normalized);

    if (options.exclusive) {
      try {
        await directory.getFileHandle(name);
        throw alreadyExistsError(normalized);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }

    if (!options.exclusive && options.expectedContentHash) {
      let current: BrowserFileHandleLike;
      try {
        current = await directory.getFileHandle(name);
      } catch (error) {
        if (isNotFound(error)) throw notFoundError(normalized);
        throw error;
      }
      const file = await current.getFile();
      const currentContent = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
        .decode(await file.arrayBuffer());
      if (await hashDocumentContent(currentContent) !== options.expectedContentHash) {
        throw new DOMException("Файл изменён после открытия.", "VersionError");
      }
    }

    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(content);
      await writable.close();
    } catch (error) {
      await writable.abort?.(error).catch(() => undefined);
      throw error;
    }
    return fileInfo(normalized, handle);
  }

  async delete(relativePath: string, options: WorkspaceFileDeleteOptions = {}): Promise<void> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const directory = await directoryAt(this.root, workspacePathDirname(normalized), false);
    if (options.expectedContentHash) {
      const handle = await directory.getFileHandle(workspacePathBasename(normalized));
      const file = await handle.getFile();
      const currentContent = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
        .decode(await file.arrayBuffer());
      if (await hashDocumentContent(currentContent) !== options.expectedContentHash) {
        throw new DOMException("Файл изменён перед удалением.", "VersionError");
      }
    }
    await directory.removeEntry(workspacePathBasename(normalized));
  }

  async createFolder(relativePath: string): Promise<void> {
    await directoryAt(this.root, normalizeWorkspaceRelativePath(relativePath), true);
  }

  async deleteFolder(relativePath: string): Promise<void> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const parent = await directoryAt(this.root, workspacePathDirname(normalized), false);
    await parent.removeEntry(workspacePathBasename(normalized), { recursive: false });
  }
}

export function browserDirectoryPickerSupported(scope: Window = window): boolean {
  return typeof (scope as WindowWithDirectoryPicker).showDirectoryPicker === "function";
}

export async function pickBrowserDirectory(
  scope: Window = window
): Promise<BrowserDirectoryHandleLike> {
  const picker = (scope as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) throw new DOMException("Выбор папки не поддерживается этим браузером.", "NotSupportedError");
  return picker({ id: "psozh-document-workspace", mode: "readwrite" });
}

export async function queryBrowserDirectoryPermission(
  handle: BrowserDirectoryHandleLike,
  mode: BrowserDirectoryPermissionMode = "readwrite"
): Promise<PermissionState> {
  return handle.queryPermission ? handle.queryPermission({ mode }) : "prompt";
}

/** Must only be called from an explicit user action. */
export async function requestBrowserDirectoryPermission(
  handle: BrowserDirectoryHandleLike,
  mode: BrowserDirectoryPermissionMode = "readwrite"
): Promise<PermissionState> {
  if (!handle.requestPermission) return "prompt";
  return handle.requestPermission({ mode });
}
