import { describe, expect, it } from "vitest";
import { hashDocumentContent } from "../../domain/documents/workspace/documentContentHash";
import {
  BrowserDirectoryFilePort,
  browserDirectoryPickerSupported,
  pickBrowserDirectory,
  queryBrowserDirectoryPermission,
  requestBrowserDirectoryPermission,
  type BrowserDirectoryHandleLike,
  type BrowserDirectoryPermissionMode,
  type BrowserFileHandleLike,
  type BrowserFileLike,
  type BrowserWritableLike
} from "./browserDirectoryFilePort";

function fileSystemError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

class MemoryFileHandle implements BrowserFileHandleLike {
  readonly kind = "file" as const;
  private bytes: Uint8Array;
  private modified = 1;

  constructor(
    readonly name: string,
    initialContent: string | Uint8Array = "",
    private readonly readable = true
  ) {
    this.bytes = typeof initialContent === "string"
      ? new TextEncoder().encode(initialContent)
      : new Uint8Array(initialContent);
  }

  async getFile(): Promise<BrowserFileLike> {
    if (!this.readable) throw fileSystemError("NotReadableError", `${this.name} is unreadable.`);
    const bytes = new Uint8Array(this.bytes);
    return {
      size: bytes.byteLength,
      lastModified: this.modified,
      arrayBuffer: async () => bytes.buffer
    };
  }

  async createWritable(): Promise<BrowserWritableLike> {
    let pending = "";
    let aborted = false;
    return {
      write: async (data) => { pending = data; },
      close: async () => {
        if (aborted) throw fileSystemError("AbortError", "The write was aborted.");
        this.bytes = new TextEncoder().encode(pending);
        this.modified += 1;
      },
      abort: async () => { aborted = true; }
    };
  }

  text(): string {
    return new TextDecoder().decode(this.bytes);
  }
}

class MemoryDirectoryHandle implements BrowserDirectoryHandleLike {
  readonly kind = "directory" as const;
  protected readonly children = new Map<
    string,
    MemoryFileHandle | MemoryDirectoryHandle
  >();

  constructor(readonly name: string) {}

  async *entries(): AsyncIterableIterator<
    readonly [string, BrowserFileHandleLike | BrowserDirectoryHandleLike]
  > {
    for (const entry of this.children.entries()) yield entry;
  }

  async getDirectoryHandle(
    name: string,
    options: { readonly create?: boolean } = {}
  ): Promise<MemoryDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryDirectoryHandle) return existing;
    if (existing) throw fileSystemError("TypeMismatchError", `${name} is a file.`);
    if (!options.create) throw fileSystemError("NotFoundError", `${name} does not exist.`);
    const created = new MemoryDirectoryHandle(name);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(
    name: string,
    options: { readonly create?: boolean } = {}
  ): Promise<MemoryFileHandle> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryFileHandle) return existing;
    if (existing) throw fileSystemError("TypeMismatchError", `${name} is a directory.`);
    if (!options.create) throw fileSystemError("NotFoundError", `${name} does not exist.`);
    const created = new MemoryFileHandle(name);
    this.children.set(name, created);
    return created;
  }

  async removeEntry(name: string, options: { readonly recursive?: boolean } = {}): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) throw fileSystemError("NotFoundError", `${name} does not exist.`);
    if (
      existing instanceof MemoryDirectoryHandle &&
      existing.children.size > 0 &&
      !options.recursive
    ) {
      throw fileSystemError("InvalidModificationError", `${name} is not empty.`);
    }
    this.children.delete(name);
  }

  addFile(
    name: string,
    content: string | Uint8Array = "",
    readable = true
  ): MemoryFileHandle {
    const file = new MemoryFileHandle(name, content, readable);
    this.children.set(name, file);
    return file;
  }

  addDirectory(name: string): MemoryDirectoryHandle {
    const directory = new MemoryDirectoryHandle(name);
    this.children.set(name, directory);
    return directory;
  }
}

class PermissionDirectoryHandle extends MemoryDirectoryHandle {
  readonly permissionCalls: Array<{
    method: "query" | "request";
    mode: BrowserDirectoryPermissionMode;
  }> = [];

  constructor(
    name: string,
    private readonly queried: PermissionState,
    private readonly requested: PermissionState
  ) {
    super(name);
  }

  async queryPermission(
    descriptor: { readonly mode: BrowserDirectoryPermissionMode }
  ): Promise<PermissionState> {
    this.permissionCalls.push({ method: "query", mode: descriptor.mode });
    return this.queried;
  }

  async requestPermission(
    descriptor: { readonly mode: BrowserDirectoryPermissionMode }
  ): Promise<PermissionState> {
    this.permissionCalls.push({ method: "request", mode: descriptor.mode });
    return this.requested;
  }
}

describe("browser directory file port", () => {
  it("lists nested files and folders recursively in deterministic order", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    root.addFile("z.md", "z");
    const area = root.addDirectory("Area");
    area.addFile("note.md", "note");
    area.addFile("asset.png", "png");
    const nested = area.addDirectory("Nested");
    nested.addFile("deep.md", "deep");
    nested.addFile("unreadable.md", "hidden", false);

    const snapshot = await new BrowserDirectoryFilePort(root).list();

    expect(snapshot.folders).toEqual(["Area", "Area/Nested"]);
    expect(snapshot.files).toEqual([
      { relativePath: "Area/asset.png", size: 3, lastModified: 1 },
      { relativePath: "Area/Nested/deep.md", size: 4, lastModified: 1 },
      { relativePath: "Area/Nested/unreadable.md", size: -1, lastModified: -1 },
      { relativePath: "Area/note.md", size: 4, lastModified: 1 },
      { relativePath: "z.md", size: 1, lastModified: 1 }
    ]);
  });

  it("never descends into service directories and omits editor temporary files", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    root.addDirectory(".obsidian").addFile("settings.md", "private");
    root.addDirectory(".PSOZH").addFile("trash.md", "private");
    root.addDirectory(".git").addFile("config.md", "private");
    const visible = root.addDirectory("Visible");
    visible.addDirectory(".Obsidian").addFile("plugin.md", "private");
    visible.addFile("note.md", "visible");
    visible.addFile("note.md~", "temporary");
    visible.addFile(".#note.md", "temporary");
    visible.addFile("note.md.swp", "temporary");
    visible.addFile("ordinary.tmp.md", "ordinary");

    const snapshot = await new BrowserDirectoryFilePort(root).list();

    expect(snapshot.folders).toEqual(["Visible"]);
    expect(snapshot.files.map((file) => file.relativePath)).toEqual([
      "Visible/note.md",
      "Visible/ordinary.tmp.md"
    ]);
  });

  it("reads normalized paths, writes nested files and safely overwrites when requested", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    const port = new BrowserDirectoryFilePort(root);

    const created = await port.write("Folder\\Nested\\note.md", "first", { exclusive: true });
    expect(created).toEqual({
      relativePath: "Folder/Nested/note.md",
      size: 5,
      lastModified: 2
    });
    expect(await port.read("Folder/Nested/note.md")).toEqual({
      relativePath: "Folder/Nested/note.md",
      content: "first",
      size: 5,
      lastModified: 2
    });

    await port.write("Folder/Nested/note.md", "second", { exclusive: false });
    expect((await port.read("Folder/Nested/note.md")).content).toBe("second");
  });

  it("enforces exclusive creation without changing an existing file", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    const file = root.addFile("existing.md", "original");
    const port = new BrowserDirectoryFilePort(root);

    await expect(port.write("existing.md", "replacement", { exclusive: true }))
      .rejects.toMatchObject({ name: "InvalidModificationError" });
    expect(file.text()).toBe("original");
  });

  it("checks the expected hash immediately before overwriting a file", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    const file = root.addFile("guarded.md", "original");
    const port = new BrowserDirectoryFilePort(root);
    const originalHash = await hashDocumentContent("original");

    await port.write("guarded.md", "first update", {
      exclusive: false,
      expectedContentHash: originalHash
    });
    expect(file.text()).toBe("first update");

    await expect(port.write("guarded.md", "stale overwrite", {
      exclusive: false,
      expectedContentHash: originalHash
    })).rejects.toMatchObject({ name: "VersionError" });
    expect(file.text()).toBe("first update");
  });

  it("checks the expected hash before deleting a file", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    const file = root.addFile("guarded.md", "current");
    const port = new BrowserDirectoryFilePort(root);

    await expect(port.delete("guarded.md", {
      expectedContentHash: await hashDocumentContent("stale")
    })).rejects.toMatchObject({ name: "VersionError" });
    expect(file.text()).toBe("current");

    await port.delete("guarded.md", {
      expectedContentHash: await hashDocumentContent("current")
    });
    await expect(port.read("guarded.md"))
      .rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("fails fatally instead of replacing invalid UTF-8 bytes", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    root.addFile("invalid.md", new Uint8Array([0xc3, 0x28]));
    const port = new BrowserDirectoryFilePort(root);

    await expect(port.read("invalid.md")).rejects.toBeInstanceOf(TypeError);
    expect((await port.list()).files).toEqual([{
      relativePath: "invalid.md",
      size: 2,
      lastModified: 1
    }]);
  });

  it("creates folders and deletes only the selected file", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    const keep = root.addFile("keep.md", "keep");
    const port = new BrowserDirectoryFilePort(root);

    await port.createFolder("New/Deep");
    await port.write("New/Deep/remove.md", "remove", { exclusive: true });
    expect((await port.list()).folders).toEqual(["New", "New/Deep"]);

    await port.delete("New/Deep/remove.md");
    await expect(port.read("New/Deep/remove.md"))
      .rejects.toMatchObject({ name: "NotFoundError" });
    expect(keep.text()).toBe("keep");
    expect((await port.list()).folders).toEqual(["New", "New/Deep"]);
  });

  it("forwards permission feature methods and defaults unsupported handles to prompt", async () => {
    const permissioned = new PermissionDirectoryHandle("workspace", "granted", "denied");

    expect(await queryBrowserDirectoryPermission(permissioned, "read")).toBe("granted");
    expect(await requestBrowserDirectoryPermission(permissioned)).toBe("denied");
    expect(permissioned.permissionCalls).toEqual([
      { method: "query", mode: "read" },
      { method: "request", mode: "readwrite" }
    ]);

    const permissionless = new MemoryDirectoryHandle("workspace");
    expect(await queryBrowserDirectoryPermission(permissionless)).toBe("prompt");
    expect(await requestBrowserDirectoryPermission(permissionless, "read")).toBe("prompt");
  });

  it("feature-detects and invokes the picker only through the supplied browser scope", async () => {
    const root = new MemoryDirectoryHandle("workspace");
    let receivedOptions: unknown;
    const supportedScope = {
      showDirectoryPicker: async (options: unknown) => {
        receivedOptions = options;
        return root;
      }
    } as unknown as Window;
    const unsupportedScope = {} as Window;

    expect(browserDirectoryPickerSupported(supportedScope)).toBe(true);
    expect(browserDirectoryPickerSupported(unsupportedScope)).toBe(false);
    expect(await pickBrowserDirectory(supportedScope)).toBe(root);
    expect(receivedOptions).toEqual({
      id: "psozh-document-workspace",
      mode: "readwrite"
    });
    await expect(pickBrowserDirectory(unsupportedScope))
      .rejects.toMatchObject({ name: "NotSupportedError" });
  });
});
