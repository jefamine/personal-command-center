import { describe, expect, it } from "vitest";
import {
  compareWorkspacePaths,
  hasIgnoredWorkspaceDirectory,
  isEditorTemporaryFileName,
  isIgnoredWorkspaceDirectoryName,
  isMarkdownWorkspacePath,
  joinWorkspacePaths,
  MAX_WORKSPACE_PATH_SEGMENT_LENGTH,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspacePathSegment,
  normalizeWorkspaceRelativePath,
  removeOptionalMarkdownExtension,
  resolveWorkspacePath,
  shouldIgnoreWorkspaceEntry,
  sortWorkspacePaths,
  WorkspacePathError,
  workspacePathBasename,
  workspacePathCollisionKey,
  workspacePathDirname
} from "./workspacePaths";

function expectPathError(action: () => unknown, code: WorkspacePathError["code"]): void {
  try {
    action();
    throw new Error("Expected WorkspacePathError.");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspacePathError);
    expect((error as WorkspacePathError).code).toBe(code);
  }
}

describe("workspace-relative path normalization", () => {
  it("normalizes Windows separators, repeated separators and dot segments", () => {
    expect(normalizeWorkspaceRelativePath("Люди\\Семья//./Анна.md"))
      .toBe("Люди/Семья/Анна.md");
  });

  it("resolves parent segments only while they remain inside the root", () => {
    expect(normalizeWorkspaceRelativePath("Люди/Семья/../Анна.md"))
      .toBe("Люди/Анна.md");
    expectPathError(
      () => normalizeWorkspaceRelativePath("../Личные данные.md"),
      "outside-workspace"
    );
    expectPathError(
      () => normalizeWorkspaceRelativePath("Папка/../../Личные данные.md"),
      "outside-workspace"
    );
  });

  it("rejects POSIX, drive-qualified, drive-relative and UNC paths", () => {
    [
      "/absolute.md",
      "C:\\vault\\note.md",
      "C:note.md",
      "\\\\server\\vault\\note.md",
      "//server/vault/note.md"
    ].forEach((value) => expectPathError(
      () => normalizeWorkspaceRelativePath(value),
      "absolute-path"
    ));
  });

  it("rejects an empty document path but represents the root as an empty directory path", () => {
    expectPathError(() => normalizeWorkspaceRelativePath("./"), "empty-path");
    expect(normalizeWorkspaceDirectoryPath("./")).toBe("");
  });

  it("rejects forbidden and control characters", () => {
    ["a<b.md", "a>b.md", "name:part.md", "a\"b.md", "a|b.md", "a?b.md", "a*b.md"]
      .forEach((value) => expectPathError(
        () => normalizeWorkspaceRelativePath(value),
        "forbidden-character"
      ));
    expectPathError(() => normalizeWorkspaceRelativePath("bad\u0000name.md"), "control-character");
  });

  it("rejects trailing dots/spaces and Windows reserved names with extensions", () => {
    ["note. ", "note.", "folder /note.md"]
      .forEach((value) => expectPathError(
        () => normalizeWorkspaceRelativePath(value),
        "trailing-dot-or-space"
      ));
    ["CON", "con.md", "Aux.txt", "COM1.md", "lpt9", "CONOUT$.md"]
      .forEach((value) => expectPathError(
        () => normalizeWorkspaceRelativePath(value),
        "reserved-name"
      ));
  });

  it("rejects overlong segments and configurable overlong paths", () => {
    const longSegment = "x".repeat(MAX_WORKSPACE_PATH_SEGMENT_LENGTH + 1);
    expectPathError(() => normalizeWorkspaceRelativePath(longSegment), "segment-too-long");
    expectPathError(
      () => normalizeWorkspaceRelativePath("folder/document.md", { maxLength: 10 }),
      "path-too-long"
    );
  });

  it("validates a single rename segment without accepting separators or dot aliases", () => {
    expect(normalizeWorkspacePathSegment("Новая заметка.md")).toBe("Новая заметка.md");
    ["folder/note.md", "folder\\note.md", ".", ".."]
      .forEach((value) => expectPathError(
        () => normalizeWorkspacePathSegment(value),
        "not-a-file-name"
      ));
  });
});

describe("safe workspace path composition", () => {
  it("joins and resolves relative paths with root containment", () => {
    expect(joinWorkspacePaths("Люди", "Семья", "Анна.md")).toBe("Люди/Семья/Анна.md");
    expect(joinWorkspacePaths("", "Анна.md")).toBe("Анна.md");
    expect(resolveWorkspacePath("Люди/Семья", "../Анна.md")).toBe("Люди/Анна.md");
    expect(resolveWorkspacePath("", "Анна.md")).toBe("Анна.md");
    expectPathError(() => resolveWorkspacePath("Люди", "../../outside.md"), "outside-workspace");
    expectPathError(() => joinWorkspacePaths("Люди", "C:\\outside.md"), "absolute-path");
  });

  it("returns deterministic dirname and basename values", () => {
    expect(workspacePathDirname("Люди\\Семья\\Анна.md")).toBe("Люди/Семья");
    expect(workspacePathDirname("Анна.md")).toBe("");
    expect(workspacePathBasename("Люди\\Семья\\Анна.md")).toBe("Анна.md");
  });

  it("removes only an optional final Markdown extension", () => {
    expect(removeOptionalMarkdownExtension("Люди/Анна.md")).toBe("Люди/Анна");
    expect(removeOptionalMarkdownExtension("Люди/Анна.MD")).toBe("Люди/Анна");
    expect(removeOptionalMarkdownExtension("archive.md.txt")).toBe("archive.md.txt");
    expect(isMarkdownWorkspacePath("Люди/Анна.MD")).toBe(true);
    expect(isMarkdownWorkspacePath("Люди/Анна.txt")).toBe(false);
  });

  it("creates a case-insensitive, slash-normalized NFC collision key", () => {
    expect(workspacePathCollisionKey("ЛЮДИ\\АННА.MD"))
      .toBe(workspacePathCollisionKey("люди/анна.md"));
    expect(workspacePathCollisionKey("Cafe\u0301.md"))
      .toBe(workspacePathCollisionKey("Café.md"));
  });
});

describe("scanner filtering and deterministic ordering", () => {
  it("ignores service directories case-insensitively at any depth", () => {
    [".obsidian", ".PSOZH", ".Git"].forEach((value) => {
      expect(isIgnoredWorkspaceDirectoryName(value)).toBe(true);
    });
    expect(isIgnoredWorkspaceDirectoryName("obsidian")).toBe(false);
    expect(hasIgnoredWorkspaceDirectory("Проект/.obsidian/plugins")).toBe(true);
    expect(shouldIgnoreWorkspaceEntry("Проект/.psozh/trash/note.md", "file")).toBe(true);
    expect(shouldIgnoreWorkspaceEntry(".git", "directory")).toBe(true);
  });

  it("recognizes common editor temporary files without hiding ordinary Markdown", () => {
    [
      ".#note.md",
      "~$note.md",
      ".~lock.note.md#",
      "#note.md#",
      "note.md~",
      ".note.md.swp",
      "note.md.tmp",
      "note.md.bak"
    ].forEach((value) => expect(isEditorTemporaryFileName(value)).toBe(true));
    expect(isEditorTemporaryFileName("note.md")).toBe(false);
    expect(shouldIgnoreWorkspaceEntry("Папка/note.md~", "file")).toBe(true);
    expect(shouldIgnoreWorkspaceEntry("Папка/note.md", "file")).toBe(false);
  });

  it("treats invalid scanner entries as ignored rather than throwing", () => {
    expect(shouldIgnoreWorkspaceEntry("../outside.md", "file")).toBe(true);
  });

  it("sorts paths deterministically without mutating the input", () => {
    const input = ["b/Вторая.md", "A/вторая.md", "a/Первая.md", "B/первая.md"];
    const before = [...input];
    const sorted = sortWorkspacePaths(input);
    expect(sorted).toEqual(["A/вторая.md", "a/Первая.md", "b/Вторая.md", "B/первая.md"]);
    expect(input).toEqual(before);
    expect([...sorted].sort(compareWorkspacePaths)).toEqual(sorted);
  });
});
