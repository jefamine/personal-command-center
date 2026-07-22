export type MarkdownFrontmatterStatus =
  | "absent"
  | "valid"
  | "malformed"
  | "unsupported";

export interface MarkdownDocumentMetadata {
  readonly psozhId: string | null;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
}

/**
 * Lossless split of a Markdown file into its protected prefix and editable body.
 * rawPrefix includes the BOM, delimiters and the line ending after the closing
 * delimiter. Reusing it verbatim keeps unrelated YAML formatting untouched.
 */
export interface ParsedMarkdownDocument {
  readonly source: string;
  readonly hasBom: boolean;
  readonly lineEnding: "\n" | "\r\n";
  readonly rawPrefix: string;
  readonly rawFrontmatter: string | null;
  readonly body: string;
  /** Null only when an opening delimiter has no closing delimiter. */
  readonly bodyOffset: number | null;
  readonly frontmatterStatus: MarkdownFrontmatterStatus;
  readonly frontmatterIssues: readonly string[];
  readonly metadata: MarkdownDocumentMetadata;
  readonly metadataEditable: boolean;
}

export interface MarkdownMetadataPatch {
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
}

export type MarkdownMutationBlockCode =
  | "malformed-frontmatter"
  | "unsupported-metadata"
  | "invalid-value"
  | "identity-conflict";

export type MarkdownMutationResult =
  | {
      readonly status: "ok";
      readonly content: string;
      readonly document: ParsedMarkdownDocument;
      readonly changed: boolean;
    }
  | {
      readonly status: "blocked";
      readonly code: MarkdownMutationBlockCode;
      readonly message: string;
    };

type RecognizedMetadataKey = "psozh-id" | "tags" | "aliases";

interface SourceLine {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly content: string;
  readonly ending: "" | "\n" | "\r\n";
}

interface MetadataField {
  readonly key: RecognizedMetadataKey;
  readonly start: number;
  readonly end: number;
  readonly values: readonly string[];
}

interface MarkdownAnalysis {
  readonly document: ParsedMarkdownDocument;
  readonly closingDelimiterStart: number | null;
  readonly fields: ReadonlyMap<RecognizedMetadataKey, MetadataField>;
}

interface ScalarResult {
  readonly status: "ok" | "unsupported";
  readonly value?: string | null;
}

interface SequenceResult {
  readonly status: "ok" | "unsupported";
  readonly values?: readonly string[];
}

const emptyMetadata: MarkdownDocumentMetadata = {
  psozhId: null,
  tags: [],
  aliases: []
};

function sourceLines(source: string, offset = 0): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = offset;

  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    if (newline < 0) {
      lines.push({
        start,
        contentEnd: source.length,
        end: source.length,
        content: source.slice(start),
        ending: ""
      });
      break;
    }

    const hasCarriageReturn = newline > start && source[newline - 1] === "\r";
    const contentEnd = hasCarriageReturn ? newline - 1 : newline;
    lines.push({
      start,
      contentEnd,
      end: newline + 1,
      content: source.slice(start, contentEnd),
      ending: hasCarriageReturn ? "\r\n" : "\n"
    });
    start = newline + 1;
  }

  if (source.length === offset) {
    lines.push({
      start: offset,
      contentEnd: offset,
      end: offset,
      content: "",
      ending: ""
    });
  }

  return lines;
}

function detectedLineEnding(lines: readonly SourceLine[]): "\n" | "\r\n" {
  return lines.find((line) => line.ending)?.ending || "\n";
}

function recognizedKey(value: string): value is RecognizedMetadataKey {
  return value === "psozh-id" || value === "tags" || value === "aliases";
}

function splitValueAndComment(value: string): { readonly value: string; readonly valid: boolean } {
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "double") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "single") {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }
    if (character === '"') {
      quote = "double";
      continue;
    }
    if (character === "'") {
      quote = "single";
      continue;
    }
    if (character === "#" && (index === 0 || /\s/u.test(value[index - 1]))) {
      return { value: value.slice(0, index).trimEnd(), valid: true };
    }
  }

  return { value: value.trimEnd(), valid: quote === null && !escaped };
}

function parseSimpleScalar(rawValue: string, allowComment = true): ScalarResult {
  const separated = allowComment
    ? splitValueAndComment(rawValue.trim())
    : { value: rawValue.trim(), valid: true };
  if (!separated.valid) return { status: "unsupported" };
  const value = separated.value.trim();
  if (!value) return { status: "ok", value: null };

  if (value.startsWith('"')) {
    if (!value.endsWith('"')) return { status: "unsupported" };
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string"
        ? { status: "ok", value: parsed }
        : { status: "unsupported" };
    } catch {
      return { status: "unsupported" };
    }
  }

  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) return { status: "unsupported" };
    return {
      status: "ok",
      value: value.slice(1, -1).replace(/''/gu, "'")
    };
  }

  if (/^[\[{>|&*!]/u.test(value) || /[\]}]/u.test(value)) {
    return { status: "unsupported" };
  }
  if (["null", "~"].includes(value.toLocaleLowerCase("en"))) {
    return { status: "ok", value: null };
  }
  return { status: "ok", value };
}

function parseInlineSequence(rawValue: string): SequenceResult {
  const value = rawValue.trim();
  if (!value.startsWith("[")) return { status: "unsupported" };
  const tokens: string[] = [];
  let tokenStart = 1;
  let quote: "single" | "double" | null = null;
  let escaped = false;
  let closingIndex = -1;

  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "double") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "single") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === '"') {
      quote = "double";
      continue;
    }
    if (character === "'") {
      quote = "single";
      continue;
    }
    if (character === "[") return { status: "unsupported" };
    if (character === ",") {
      tokens.push(value.slice(tokenStart, index));
      tokenStart = index + 1;
      continue;
    }
    if (character === "]") {
      tokens.push(value.slice(tokenStart, index));
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0 || quote !== null || escaped) return { status: "unsupported" };
  const trailing = splitValueAndComment(value.slice(closingIndex + 1));
  if (!trailing.valid || trailing.value.trim()) return { status: "unsupported" };

  if (tokens.length === 1 && !tokens[0].trim()) return { status: "ok", values: [] };
  const parsed: string[] = [];
  for (const token of tokens) {
    const scalar = parseSimpleScalar(token, false);
    if (scalar.status !== "ok" || scalar.value === null || scalar.value === undefined) {
      return { status: "unsupported" };
    }
    parsed.push(scalar.value);
  }
  return { status: "ok", values: parsed };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function analyzeMarkdownDocument(source: string): MarkdownAnalysis {
  const hasBom = source.startsWith("\uFEFF");
  const contentOffset = hasBom ? 1 : 0;
  const lines = sourceLines(source, contentOffset);
  const lineEnding = detectedLineEnding(lines);
  const first = lines[0];

  if (!first || first.content !== "---") {
    return {
      document: {
        source,
        hasBom,
        lineEnding,
        rawPrefix: source.slice(0, contentOffset),
        rawFrontmatter: null,
        body: source.slice(contentOffset),
        bodyOffset: contentOffset,
        frontmatterStatus: "absent",
        frontmatterIssues: [],
        metadata: emptyMetadata,
        metadataEditable: true
      },
      closingDelimiterStart: null,
      fields: new Map()
    };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.content === "---");
  if (closingIndex < 0) {
    return {
      document: {
        source,
        hasBom,
        lineEnding,
        rawPrefix: source,
        rawFrontmatter: source.slice(contentOffset),
        body: "",
        bodyOffset: null,
        frontmatterStatus: "malformed",
        frontmatterIssues: ["У начального блока свойств нет закрывающего разделителя ---."] ,
        metadata: emptyMetadata,
        metadataEditable: false
      },
      closingDelimiterStart: null,
      fields: new Map()
    };
  }

  const closing = lines[closingIndex];
  const frontmatterLines = lines.slice(1, closingIndex);
  const issues: string[] = [];
  let malformed = false;
  let unsupported = false;
  const fields = new Map<RecognizedMetadataKey, MetadataField>();
  const metadata: { psozhId: string | null; tags: string[]; aliases: string[] } = {
    psozhId: null,
    tags: [],
    aliases: []
  };

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    const trimmed = line.content.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^[ \t]/u.test(line.content)) {
      malformed = true;
      issues.push(`Строка ${index + 2} не принадлежит известному верхнеуровневому свойству.`);
      continue;
    }

    const property = /^([^:]+?):(.*)$/u.exec(line.content);
    if (!property) {
      malformed = true;
      issues.push(`Строка ${index + 2} не является безопасным свойством YAML.`);
      continue;
    }

    const key = property[1].trim();
    if (!key) {
      malformed = true;
      issues.push(`Строка ${index + 2} содержит пустое имя свойства.`);
      continue;
    }
    if (!recognizedKey(key)) {
      while (index + 1 < frontmatterLines.length && /^[ \t]/u.test(frontmatterLines[index + 1].content)) {
        index += 1;
      }
      continue;
    }

    if (fields.has(key)) {
      malformed = true;
      issues.push(`Свойство ${key} указано несколько раз.`);
      continue;
    }

    const rawValue = property[2].trim();
    let fieldEnd = line.end;
    let values: readonly string[] | null = null;

    if (key === "psozh-id") {
      const scalar = parseSimpleScalar(rawValue);
      if (scalar.status !== "ok") {
        unsupported = true;
        issues.push("Свойство psozh-id использует неподдерживаемое сложное значение.");
      } else if (scalar.value) {
        values = [scalar.value];
        metadata.psozhId = scalar.value;
      } else {
        values = [];
      }
    } else if (rawValue.startsWith("[")) {
      const sequence = parseInlineSequence(rawValue);
      if (sequence.status === "ok") values = sequence.values ?? [];
      else {
        unsupported = true;
        issues.push(`Свойство ${key} использует неподдерживаемый сложный список.`);
      }
    } else if (rawValue) {
      const scalar = parseSimpleScalar(rawValue);
      if (scalar.status === "ok" && scalar.value !== null && scalar.value !== undefined) {
        values = [scalar.value];
      } else if (scalar.status === "ok") {
        values = [];
      } else {
        unsupported = true;
        issues.push(`Свойство ${key} использует неподдерживаемое сложное значение.`);
      }
    } else {
      const listValues: string[] = [];
      let listIndex = index + 1;
      let listUnsupported = false;
      while (listIndex < frontmatterLines.length && /^[ \t]/u.test(frontmatterLines[listIndex].content)) {
        const listLine = frontmatterLines[listIndex];
        const item = /^ +-[ \t]*(.*)$/u.exec(listLine.content);
        if (!item || !item[1].trim() || listLine.content.startsWith("\t")) {
          listUnsupported = true;
        } else {
          const scalar = parseSimpleScalar(item[1]);
          if (scalar.status !== "ok" || scalar.value === null || scalar.value === undefined) {
            listUnsupported = true;
          } else {
            listValues.push(scalar.value);
          }
        }
        fieldEnd = listLine.end;
        listIndex += 1;
      }
      index = listIndex - 1;
      if (listUnsupported) {
        unsupported = true;
        issues.push(`Свойство ${key} содержит неподдерживаемый блочный список.`);
      } else {
        values = listValues;
      }
    }

    if (values) {
      const normalizedValues = uniqueStrings(values);
      fields.set(key, { key, start: line.start, end: fieldEnd, values: normalizedValues });
      if (key === "tags") metadata.tags = normalizedValues;
      if (key === "aliases") metadata.aliases = normalizedValues;
    }
  }

  const frontmatterStatus: MarkdownFrontmatterStatus = malformed
    ? "malformed"
    : unsupported
      ? "unsupported"
      : "valid";
  const bodyOffset = closing.end;
  return {
    document: {
      source,
      hasBom,
      lineEnding,
      rawPrefix: source.slice(0, bodyOffset),
      rawFrontmatter: source.slice(contentOffset, closing.contentEnd),
      body: source.slice(bodyOffset),
      bodyOffset,
      frontmatterStatus,
      frontmatterIssues: issues,
      metadata,
      metadataEditable: frontmatterStatus === "valid"
    },
    closingDelimiterStart: closing.start,
    fields
  };
}

export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  return analyzeMarkdownDocument(source).document;
}

function mutationSource(value: string | ParsedMarkdownDocument): string {
  return typeof value === "string" ? value : value.source;
}

function successfulMutation(previous: string, content: string): MarkdownMutationResult {
  return {
    status: "ok",
    content,
    document: parseMarkdownDocument(content),
    changed: content !== previous
  };
}

function blockedMetadataMutation(document: ParsedMarkdownDocument): MarkdownMutationResult | null {
  if (document.frontmatterStatus === "malformed") {
    return {
      status: "blocked",
      code: "malformed-frontmatter",
      message: "Свойства документа повреждены; автоматическое изменение остановлено."
    };
  }
  if (document.frontmatterStatus === "unsupported") {
    return {
      status: "blocked",
      code: "unsupported-metadata",
      message: "Свойства используют сложный YAML, который нельзя безопасно изменить автоматически."
    };
  }
  return null;
}

function validMetadataValue(value: string): boolean {
  return Boolean(value.trim()) && !/[\r\n\u0000]/u.test(value);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function canonicalSequence(key: "tags" | "aliases", values: readonly string[], ending: string): string {
  return `${key}: [${values.map(yamlString).join(", ")}]${ending}`;
}

function createFrontmatter(
  source: string,
  hasBom: boolean,
  ending: "\n" | "\r\n",
  lines: readonly string[]
): string {
  const bom = hasBom ? "\uFEFF" : "";
  const body = source.slice(hasBom ? 1 : 0);
  return `${bom}---${ending}${lines.join(ending)}${ending}---${ending}${body}`;
}

/** Replaces only the Markdown body; every original prefix byte remains intact. */
export function replaceMarkdownBody(
  value: string | ParsedMarkdownDocument,
  nextBody: string
): MarkdownMutationResult {
  const source = mutationSource(value);
  const document = parseMarkdownDocument(source);
  if (document.bodyOffset === null) {
    return {
      status: "blocked",
      code: "malformed-frontmatter",
      message: "Нельзя определить начало текста: у блока свойств нет закрывающего разделителя."
    };
  }
  return successfulMutation(source, `${document.rawPrefix}${nextBody}`);
}

/** Adds managed identity without reserializing existing frontmatter. */
export function addPsozhId(
  value: string | ParsedMarkdownDocument,
  psozhId: string
): MarkdownMutationResult {
  const source = mutationSource(value);
  const analysis = analyzeMarkdownDocument(source);
  const blocked = blockedMetadataMutation(analysis.document);
  if (blocked) return blocked;

  const normalizedId = psozhId.trim();
  if (!validMetadataValue(normalizedId)) {
    return {
      status: "blocked",
      code: "invalid-value",
      message: "Идентификатор документа не может быть пустым или многострочным."
    };
  }
  if (analysis.document.metadata.psozhId) {
    if (analysis.document.metadata.psozhId === normalizedId) {
      return successfulMutation(source, source);
    }
    return {
      status: "blocked",
      code: "identity-conflict",
      message: "У документа уже есть другой psozh-id."
    };
  }

  const property = `psozh-id: ${yamlString(normalizedId)}`;
  if (analysis.document.frontmatterStatus === "absent") {
    return successfulMutation(
      source,
      createFrontmatter(source, analysis.document.hasBom, analysis.document.lineEnding, [property])
    );
  }
  if (analysis.closingDelimiterStart === null) {
    return {
      status: "blocked",
      code: "malformed-frontmatter",
      message: "Не удалось найти конец блока свойств."
    };
  }

  const emptyIdentityField = analysis.fields.get("psozh-id");
  if (emptyIdentityField) {
    const original = source.slice(emptyIdentityField.start, emptyIdentityField.end);
    const ending = original.endsWith("\r\n")
      ? "\r\n"
      : original.endsWith("\n")
        ? "\n"
        : analysis.document.lineEnding;
    const content = `${source.slice(0, emptyIdentityField.start)}${property}${ending}${source.slice(emptyIdentityField.end)}`;
    return successfulMutation(source, content);
  }

  const content = `${source.slice(0, analysis.closingDelimiterStart)}${property}${analysis.document.lineEnding}${source.slice(analysis.closingDelimiterStart)}`;
  return successfulMutation(source, content);
}

/** Updates supported tags/aliases while leaving every unrelated YAML line as-is. */
export function patchMarkdownMetadata(
  value: string | ParsedMarkdownDocument,
  patch: MarkdownMetadataPatch
): MarkdownMutationResult {
  const source = mutationSource(value);
  const analysis = analyzeMarkdownDocument(source);
  const blocked = blockedMetadataMutation(analysis.document);
  if (blocked) return blocked;

  const entries: Array<{ key: "tags" | "aliases"; values: string[] }> = [];
  for (const key of ["tags", "aliases"] as const) {
    const values = patch[key];
    if (values === undefined) continue;
    if (values.some((entry) => !validMetadataValue(entry))) {
      return {
        status: "blocked",
        code: "invalid-value",
        message: "Теги и псевдонимы должны быть однострочными непустыми значениями."
      };
    }
    entries.push({
      key,
      values: uniqueStrings(values.map((entry) => entry.trim()).filter(Boolean))
    });
  }
  if (!entries.length) return successfulMutation(source, source);

  if (analysis.document.frontmatterStatus === "absent") {
    const lines = entries.map((entry) => canonicalSequence(entry.key, entry.values, "").trimEnd());
    return successfulMutation(
      source,
      createFrontmatter(source, analysis.document.hasBom, analysis.document.lineEnding, lines)
    );
  }
  if (analysis.closingDelimiterStart === null) {
    return {
      status: "blocked",
      code: "malformed-frontmatter",
      message: "Не удалось найти конец блока свойств."
    };
  }

  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const insertions: string[] = [];
  entries.forEach((entry) => {
    const field = analysis.fields.get(entry.key);
    if (field) {
      const original = source.slice(field.start, field.end);
      const ending = original.endsWith("\r\n") ? "\r\n" : original.endsWith("\n") ? "\n" : analysis.document.lineEnding;
      replacements.push({
        start: field.start,
        end: field.end,
        text: canonicalSequence(entry.key, entry.values, ending)
      });
    } else {
      insertions.push(canonicalSequence(entry.key, entry.values, analysis.document.lineEnding));
    }
  });

  let content = source;
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .forEach((replacement) => {
      content = `${content.slice(0, replacement.start)}${replacement.text}${content.slice(replacement.end)}`;
    });

  if (insertions.length) {
    const removedBeforeClosing = replacements
      .filter((replacement) => replacement.start < analysis.closingDelimiterStart!)
      .reduce((total, replacement) => total + replacement.end - replacement.start - replacement.text.length, 0);
    const closingStart = analysis.closingDelimiterStart - removedBeforeClosing;
    content = `${content.slice(0, closingStart)}${insertions.join("")}${content.slice(closingStart)}`;
  }
  return successfulMutation(source, content);
}
