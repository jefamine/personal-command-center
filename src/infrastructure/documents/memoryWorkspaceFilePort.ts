import {
  compareWorkspacePaths,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspaceRelativePath,
  workspacePathCollisionKey,
  workspacePathDirname,
  hasIgnoredWorkspaceDirectory
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

export interface MemoryWorkspaceFileSeed {
  readonly content: string;
  readonly lastModified?: number;
  readonly readable?: boolean;
  readonly writable?: boolean;
}

export interface MemoryWorkspaceFilePortOptions {
  readonly files?: Readonly<Record<string, string | MemoryWorkspaceFileSeed>>;
  readonly folders?: readonly string[];
  readonly startTime?: number;
}

interface MemoryFileRecord {
  content: string;
  lastModified: number;
  readable: boolean;
  writable: boolean;
}

function notFound(path: string): DOMException {
  return new DOMException(`Файл «${path}» не найден.`, "NotFoundError");
}

function denied(path: string): DOMException {
  return new DOMException(`Нет доступа к файлу «${path}».`, "NotAllowedError");
}

function alreadyExists(path: string): DOMException {
  return new DOMException(`Путь «${path}» уже занят.`, "InvalidModificationError");
}

/** In-memory filesystem used by all destructive workspace tests. */
export class MemoryWorkspaceFilePort implements DocumentWorkspaceFilePort {
  private readonly files = new Map<string, MemoryFileRecord>();
  private readonly folders = new Set<string>();
  private clock: number;
  private failNextWriteMessage: string | null = null;
  private failNextDeleteMessage: string | null = null;

  constructor(options: MemoryWorkspaceFilePortOptions = {}) {
    this.clock = options.startTime ?? Date.parse("2026-07-22T00:00:00.000Z");
    options.folders?.forEach((folder) => this.addFolderHierarchy(folder));
    Object.entries(options.files ?? {}).forEach(([path, seed]) => {
      const normalized = normalizeWorkspaceRelativePath(path);
      const value = typeof seed === "string" ? { content: seed } : seed;
      this.addFolderHierarchy(workspacePathDirname(normalized));
      this.files.set(normalized, {
        content: value.content,
        lastModified: value.lastModified ?? this.tick(),
        readable: value.readable ?? true,
        writable: value.writable ?? true
      });
    });
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  private addFolderHierarchy(path: string): void {
    const normalized = normalizeWorkspaceDirectoryPath(path);
    if (!normalized) return;
    const segments = normalized.split("/");
    segments.forEach((_, index) => this.folders.add(segments.slice(0, index + 1).join("/")));
  }

  private findCaseInsensitive(relativePath: string): string | null {
    const key = workspacePathCollisionKey(relativePath);
    return [...this.files.keys()].find((candidate) => workspacePathCollisionKey(candidate) === key) ?? null;
  }

  async list(signal?: AbortSignal): Promise<WorkspaceDirectorySnapshot> {
    if (signal?.aborted) throw new DOMException("Сканирование отменено.", "AbortError");
    const files = [...this.files.entries()]
      .map(([relativePath, file]): WorkspaceFileInfo => ({
        relativePath,
        size: new TextEncoder().encode(file.content).byteLength,
        lastModified: file.lastModified
      }))
      .sort((left, right) => compareWorkspacePaths(left.relativePath, right.relativePath));
    return {
      files,
      folders: [...this.folders]
        .filter((folder) => !hasIgnoredWorkspaceDirectory(folder))
        .sort(compareWorkspacePaths),
      protectedFolders: [...this.folders]
        .filter(hasIgnoredWorkspaceDirectory)
        .sort(compareWorkspacePaths)
    };
  }

  async read(relativePath: string): Promise<WorkspaceFileReadResult> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const file = this.files.get(normalized);
    if (!file) throw notFound(normalized);
    if (!file.readable) throw denied(normalized);
    return {
      relativePath: normalized,
      content: file.content,
      size: new TextEncoder().encode(file.content).byteLength,
      lastModified: file.lastModified
    };
  }

  async write(
    relativePath: string,
    content: string,
    options: WorkspaceFileWriteOptions
  ): Promise<WorkspaceFileInfo> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const collision = this.findCaseInsensitive(normalized);
    if (options.exclusive && collision) throw alreadyExists(collision);
    if (!options.exclusive && collision && collision !== normalized) throw alreadyExists(collision);
    if ([...this.folders].some((folder) => workspacePathCollisionKey(folder) === workspacePathCollisionKey(normalized))) {
      throw alreadyExists(normalized);
    }
    const parentSegments = workspacePathDirname(normalized).split("/").filter(Boolean);
    for (let index = 0; index < parentSegments.length; index += 1) {
      const parent = parentSegments.slice(0, index + 1).join("/");
      if (this.findCaseInsensitive(parent)) throw alreadyExists(parent);
    }
    const existing = this.files.get(normalized);
    if (existing && !existing.writable) throw denied(normalized);
    if (!options.exclusive && options.expectedContentHash) {
      if (!existing) throw notFound(normalized);
      if (await hashDocumentContent(existing.content) !== options.expectedContentHash) {
        throw new DOMException("Файл изменён после открытия.", "VersionError");
      }
    }
    if (this.failNextWriteMessage) {
      const message = this.failNextWriteMessage;
      this.failNextWriteMessage = null;
      throw new DOMException(message, "UnknownError");
    }
    this.addFolderHierarchy(workspacePathDirname(normalized));
    const lastModified = this.tick();
    this.files.set(normalized, {
      content,
      lastModified,
      readable: existing?.readable ?? true,
      writable: existing?.writable ?? true
    });
    return {
      relativePath: normalized,
      size: new TextEncoder().encode(content).byteLength,
      lastModified
    };
  }

  async delete(relativePath: string, options: WorkspaceFileDeleteOptions = {}): Promise<void> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const existing = this.files.get(normalized);
    if (!existing) throw notFound(normalized);
    if (!existing.writable) throw denied(normalized);
    if (options.expectedContentHash &&
      await hashDocumentContent(existing.content) !== options.expectedContentHash) {
      throw new DOMException("Файл изменён перед удалением.", "VersionError");
    }
    if (this.failNextDeleteMessage) {
      const message = this.failNextDeleteMessage;
      this.failNextDeleteMessage = null;
      throw new DOMException(message, "UnknownError");
    }
    this.files.delete(normalized);
  }

  async createFolder(relativePath: string): Promise<void> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    if (this.findCaseInsensitive(normalized)) throw alreadyExists(normalized);
    const segments = normalized.split("/");
    for (let index = 0; index < segments.length - 1; index += 1) {
      const parent = segments.slice(0, index + 1).join("/");
      if (this.findCaseInsensitive(parent)) throw alreadyExists(parent);
    }
    this.addFolderHierarchy(normalized);
  }

  async deleteFolder(relativePath: string): Promise<void> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const prefix = `${workspacePathCollisionKey(normalized)}/`;
    if ([...this.files.keys()].some((path) => workspacePathCollisionKey(path).startsWith(prefix)) ||
      [...this.folders].some((path) => workspacePathCollisionKey(path).startsWith(prefix))) {
      throw new DOMException(`Папка «${normalized}» не пуста.`, "InvalidModificationError");
    }
    const actual = [...this.folders].find((folder) =>
      workspacePathCollisionKey(folder) === workspacePathCollisionKey(normalized)
    );
    if (!actual) throw notFound(normalized);
    this.folders.delete(actual);
  }

  /** Simulates an edit made by Obsidian or another application. */
  externalWrite(relativePath: string, content: string): void {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const existing = this.files.get(normalized);
    if (!existing) throw notFound(normalized);
    this.files.set(normalized, { ...existing, content, lastModified: this.tick() });
  }

  setReadable(relativePath: string, readable: boolean): void {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const file = this.files.get(normalized);
    if (!file) throw notFound(normalized);
    file.readable = readable;
  }

  failNextWrite(message = "Запись прервана тестовым адаптером."): void {
    this.failNextWriteMessage = message;
  }

  failNextDelete(message = "Удаление прервано тестовым адаптером."): void {
    this.failNextDeleteMessage = message;
  }

  rawFile(relativePath: string): string | null {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    return this.files.get(normalized)?.content ?? null;
  }

  hasFile(relativePath: string): boolean {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    return this.files.has(normalized);
  }

  snapshotFiles(): Readonly<Record<string, string>> {
    return Object.fromEntries(
      [...this.files.entries()]
        .sort(([left], [right]) => compareWorkspacePaths(left, right))
        .map(([path, file]) => [path, file.content])
    );
  }
}
