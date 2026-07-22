const WINDOWS_FORBIDDEN_CHARACTERS = /[<>:"|?*]/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\.|$)/iu;
const WINDOWS_DRIVE_PREFIX = /^[a-z]:/iu;

export const MAX_WORKSPACE_PATH_SEGMENT_LENGTH = 255;
/**
 * A portable relative-path guard. Adapters that know the absolute root may
 * apply a stricter platform limit in addition to this workspace-level limit.
 */
export const MAX_WORKSPACE_RELATIVE_PATH_LENGTH = 1024;

export type WorkspacePathErrorCode =
  | "empty-path"
  | "absolute-path"
  | "outside-workspace"
  | "empty-segment"
  | "forbidden-character"
  | "control-character"
  | "reserved-name"
  | "trailing-dot-or-space"
  | "segment-too-long"
  | "path-too-long"
  | "not-a-file-name";

export class WorkspacePathError extends Error {
  readonly code: WorkspacePathErrorCode;
  readonly input: string;

  constructor(code: WorkspacePathErrorCode, input: string, message: string) {
    super(message);
    this.name = "WorkspacePathError";
    this.code = code;
    this.input = input;
  }
}

export interface NormalizeWorkspacePathOptions {
  /** The selected workspace root is represented by an empty relative path. */
  readonly allowEmpty?: boolean;
  readonly maxLength?: number;
}

function pathError(
  code: WorkspacePathErrorCode,
  input: string,
  message: string
): never {
  throw new WorkspacePathError(code, input, message);
}

function assertRelativeInput(value: string): void {
  if (/^[\\/]{2}/u.test(value)) {
    pathError("absolute-path", value, "UNC and network paths are not workspace-relative paths.");
  }
  if (/^[\\/]/u.test(value) || WINDOWS_DRIVE_PREFIX.test(value)) {
    pathError("absolute-path", value, "Absolute and drive-qualified paths are not allowed.");
  }
}

function assertValidSegment(segment: string, input: string): void {
  if (!segment) {
    pathError("empty-segment", input, "A workspace path cannot contain an empty segment.");
  }
  if (CONTROL_CHARACTERS.test(segment)) {
    pathError("control-character", input, "Control characters are not allowed in workspace paths.");
  }
  if (WINDOWS_FORBIDDEN_CHARACTERS.test(segment)) {
    pathError("forbidden-character", input, "The path contains a character forbidden by Windows.");
  }
  if (/[. ]$/u.test(segment)) {
    pathError("trailing-dot-or-space", input, "Path segments cannot end with a dot or space.");
  }
  if (WINDOWS_RESERVED_NAME.test(segment)) {
    pathError("reserved-name", input, `The path segment “${segment}” is reserved by Windows.`);
  }
  if (segment.length > MAX_WORKSPACE_PATH_SEGMENT_LENGTH) {
    pathError(
      "segment-too-long",
      input,
      `Path segments cannot exceed ${MAX_WORKSPACE_PATH_SEGMENT_LENGTH} characters.`
    );
  }
}

/**
 * Normalizes a path relative to the selected workspace root. The returned
 * value always uses `/`, contains no `.` segments, and cannot escape the root.
 */
export function normalizeWorkspaceRelativePath(
  value: string,
  options: NormalizeWorkspacePathOptions = {}
): string {
  assertRelativeInput(value);
  const normalizedSegments: string[] = [];

  for (const segment of value.replace(/\\/gu, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!normalizedSegments.length) {
        pathError("outside-workspace", value, "The path cannot escape the workspace root.");
      }
      normalizedSegments.pop();
      continue;
    }
    assertValidSegment(segment, value);
    normalizedSegments.push(segment);
  }

  const normalized = normalizedSegments.join("/");
  if (!normalized && !options.allowEmpty) {
    pathError("empty-path", value, "A non-empty workspace-relative path is required.");
  }

  const maxLength = options.maxLength ?? MAX_WORKSPACE_RELATIVE_PATH_LENGTH;
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new RangeError("maxLength must be a positive safe integer.");
  }
  if (normalized.length > maxLength) {
    pathError("path-too-long", value, `The relative path cannot exceed ${maxLength} characters.`);
  }
  return normalized;
}

/** Normalizes a folder path; an empty value denotes the workspace root. */
export function normalizeWorkspaceDirectoryPath(value: string): string {
  return normalizeWorkspaceRelativePath(value, { allowEmpty: true });
}

/** Validates one portable file or folder name without accepting separators. */
export function normalizeWorkspacePathSegment(value: string): string {
  if (/[\\/]/u.test(value)) {
    pathError("not-a-file-name", value, "A file or folder name cannot contain path separators.");
  }
  if (value === "." || value === "..") {
    pathError("not-a-file-name", value, "A file or folder name cannot be . or ...");
  }
  assertValidSegment(value, value);
  return value;
}

/** Safely joins relative path fragments and rejects an absolute fragment. */
export function joinWorkspacePaths(...parts: readonly string[]): string {
  const nonEmptyParts = parts.filter(Boolean);
  nonEmptyParts.forEach(assertRelativeInput);
  return normalizeWorkspaceRelativePath(nonEmptyParts.join("/"));
}

/** Resolves a link-like relative path from a folder while keeping it in root. */
export function resolveWorkspacePath(
  sourceDirectory: string,
  relativePath: string
): string {
  const directory = normalizeWorkspaceDirectoryPath(sourceDirectory);
  assertRelativeInput(relativePath);
  return normalizeWorkspaceRelativePath(
    directory ? `${directory}/${relativePath}` : relativePath
  );
}

export function workspacePathDirname(value: string): string {
  const normalized = normalizeWorkspaceRelativePath(value);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

export function workspacePathBasename(value: string): string {
  const normalized = normalizeWorkspaceRelativePath(value);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? normalized : normalized.slice(separator + 1);
}

/** Removes only a final Markdown extension, case-insensitively. */
export function removeOptionalMarkdownExtension(value: string): string {
  return value.replace(/\.md$/iu, "");
}

export function isMarkdownWorkspacePath(value: string): boolean {
  try {
    return /\.md$/iu.test(workspacePathBasename(value));
  } catch {
    return false;
  }
}

/** Windows-compatible collision key without changing the display path. */
export function workspacePathCollisionKey(value: string): string {
  return normalizeWorkspaceRelativePath(value)
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
}

const IGNORED_DIRECTORY_KEYS = new Set([".obsidian", ".psozh", ".git"]);

export function isIgnoredWorkspaceDirectoryName(value: string): boolean {
  if (!value || /[\\/]/u.test(value)) return false;
  return IGNORED_DIRECTORY_KEYS.has(value.normalize("NFC").toLocaleLowerCase("en-US"));
}

/** Covers common editor locks, swap files, atomic-write leftovers and backups. */
export function isEditorTemporaryFileName(value: string): boolean {
  if (!value || /[\\/]/u.test(value)) return false;
  const normalized = value.toLocaleLowerCase("en-US");
  return normalized.startsWith(".#") ||
    normalized.startsWith("~$") ||
    normalized.startsWith(".~lock.") ||
    (/^#.*#$/u.test(value)) ||
    normalized.endsWith("~") ||
    /\.(?:swp|swo|swn|tmp|temp|bak)$/u.test(normalized);
}

/** Returns true when a recursive scanner must not descend into the path. */
export function hasIgnoredWorkspaceDirectory(value: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeWorkspaceRelativePath(value, { allowEmpty: true });
  } catch {
    return false;
  }
  return normalized.split("/").some(isIgnoredWorkspaceDirectoryName);
}

export function shouldIgnoreWorkspaceEntry(
  relativePath: string,
  kind: "file" | "directory"
): boolean {
  let normalized: string;
  try {
    normalized = normalizeWorkspaceRelativePath(relativePath);
  } catch {
    return true;
  }
  if (hasIgnoredWorkspaceDirectory(normalized)) return true;
  return kind === "file" && isEditorTemporaryFileName(workspacePathBasename(normalized));
}

/** Locale-independent ordering for deterministic scan results. */
export function compareWorkspacePaths(left: string, right: string): number {
  const leftPath = normalizeWorkspaceRelativePath(left);
  const rightPath = normalizeWorkspaceRelativePath(right);
  const leftKey = workspacePathCollisionKey(leftPath);
  const rightKey = workspacePathCollisionKey(rightPath);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  if (leftPath < rightPath) return -1;
  if (leftPath > rightPath) return 1;
  return 0;
}

export function sortWorkspacePaths(values: readonly string[]): string[] {
  return values.map((value) => normalizeWorkspaceRelativePath(value)).sort(compareWorkspacePaths);
}
