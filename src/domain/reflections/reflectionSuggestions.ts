import type {
  ReflectionAnalysis,
  ReflectionSuggestion,
  ReflectionSuggestionKind,
  ReflectionSuggestionStatus
} from "../../types";

export const REFLECTION_SUGGESTION_TEXT_LIMITS: Record<ReflectionSuggestionKind, number> = {
  meaning: 4_000,
  question: 1_500,
  next_action: 2_000
};

const suggestionKinds: ReflectionSuggestionKind[] = ["meaning", "question", "next_action"];
const suggestionStatuses: ReflectionSuggestionStatus[] = ["pending", "accepted", "dismissed"];
const suggestionKeys = [
  "id",
  "kind",
  "sourceText",
  "text",
  "status",
  "createdAt",
  "updatedAt",
  "decidedAt",
  "addedToNoteAt",
  "createdTaskId"
];

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isIsoDate(value: unknown): value is string {
  return isNonBlankString(value) && Number.isFinite(Date.parse(value));
}

function hasExactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validText(kind: ReflectionSuggestionKind, value: unknown): value is string {
  return isNonBlankString(value) && value.length <= REFLECTION_SUGGESTION_TEXT_LIMITS[kind];
}

function suggestionFromText(
  responseId: string,
  kind: ReflectionSuggestionKind,
  sourceText: string,
  createdAt: string,
  updatedAt: string
): ReflectionSuggestion | null {
  if (!sourceText.trim()) return null;
  if (!validText(kind, sourceText)) {
    throw new Error("Предложение из разбора превышает допустимый объём.");
  }
  return {
    id: `${responseId}:${kind}`,
    kind,
    sourceText,
    text: sourceText,
    status: "pending",
    createdAt,
    updatedAt,
    decidedAt: null,
    addedToNoteAt: null,
    createdTaskId: null
  };
}

/** Creates at most one deterministic suggestion of each supported kind. */
export function deriveReflectionSuggestions(
  analysis: ReflectionAnalysis,
  updatedAt: string
): ReflectionSuggestion[] {
  const createdAt = isIsoDate(analysis.generatedAt) ? analysis.generatedAt : updatedAt;
  return [
    suggestionFromText(analysis.responseId, "meaning", analysis.possibleExplanation, createdAt, updatedAt),
    suggestionFromText(analysis.responseId, "question", analysis.question, createdAt, updatedAt),
    suggestionFromText(analysis.responseId, "next_action", analysis.proposedAction, createdAt, updatedAt)
  ].filter((suggestion): suggestion is ReflectionSuggestion => suggestion !== null);
}

/** Strict all-or-nothing normalization for persisted suggestions. */
export function normalizeReflectionSuggestions(
  value: unknown,
  responseId: string
): ReflectionSuggestion[] | null {
  if (!Array.isArray(value) || value.length > suggestionKinds.length) return null;
  const ids = new Set<string>();
  const kinds = new Set<ReflectionSuggestionKind>();
  const suggestions: ReflectionSuggestion[] = [];

  for (const rawSuggestion of value) {
    if (
      !rawSuggestion ||
      typeof rawSuggestion !== "object" ||
      !hasExactKeys(rawSuggestion, suggestionKeys)
    ) return null;
    const suggestion = rawSuggestion as Partial<ReflectionSuggestion>;
    if (
      !suggestionKinds.includes(suggestion.kind as ReflectionSuggestionKind) ||
      !suggestionStatuses.includes(suggestion.status as ReflectionSuggestionStatus)
    ) return null;
    const kind = suggestion.kind as ReflectionSuggestionKind;
    const status = suggestion.status as ReflectionSuggestionStatus;
    if (
      suggestion.id !== `${responseId}:${kind}` ||
      ids.has(suggestion.id) ||
      kinds.has(kind) ||
      !validText(kind, suggestion.sourceText) ||
      !validText(kind, suggestion.text) ||
      !isIsoDate(suggestion.createdAt) ||
      !isIsoDate(suggestion.updatedAt)
    ) return null;

    const decidedAt = suggestion.decidedAt === null
      ? null
      : isIsoDate(suggestion.decidedAt) ? suggestion.decidedAt : undefined;
    const addedToNoteAt = suggestion.addedToNoteAt === null
      ? null
      : isIsoDate(suggestion.addedToNoteAt) ? suggestion.addedToNoteAt : undefined;
    const createdTaskId = suggestion.createdTaskId === null
      ? null
      : isNonBlankString(suggestion.createdTaskId) ? suggestion.createdTaskId : undefined;
    if (
      decidedAt === undefined ||
      addedToNoteAt === undefined ||
      createdTaskId === undefined ||
      (status === "pending" ? decidedAt !== null : decidedAt === null) ||
      (kind === "next_action" ? addedToNoteAt !== null : createdTaskId !== null)
    ) return null;

    ids.add(suggestion.id);
    kinds.add(kind);
    suggestions.push({
      id: suggestion.id,
      kind,
      sourceText: suggestion.sourceText,
      text: suggestion.text,
      status,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
      decidedAt,
      addedToNoteAt,
      createdTaskId
    });
  }
  return suggestions;
}

export function editReflectionSuggestionValue(
  suggestion: ReflectionSuggestion,
  text: string,
  updatedAt: string
): ReflectionSuggestion | null {
  if (suggestion.status !== "pending" || !validText(suggestion.kind, text) || !isIsoDate(updatedAt)) {
    return null;
  }
  if (suggestion.text === text) return suggestion;
  return { ...suggestion, text, updatedAt };
}

export function decideReflectionSuggestionValue(
  suggestion: ReflectionSuggestion,
  status: ReflectionSuggestionStatus,
  updatedAt: string
): ReflectionSuggestion | null {
  if (!suggestionStatuses.includes(status) || !isIsoDate(updatedAt)) return null;
  if (suggestion.status === status) return suggestion;
  return {
    ...suggestion,
    status,
    updatedAt,
    decidedAt: status === "pending" ? null : updatedAt
  };
}

function escapeMarkdownPlainText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/([\\`*_{}\[\]()#+\-.!|])/gu, "\\$1");
}

/** Produces a quoted plain-text section safe to append to a Markdown note. */
export function reflectionSuggestionNoteSection(
  suggestion: ReflectionSuggestion
): string | null {
  if (
    suggestion.status !== "accepted" ||
    (suggestion.kind !== "meaning" && suggestion.kind !== "question")
  ) return null;
  const heading = suggestion.kind === "meaning"
    ? "## Возможный смысл из разбора"
    : "## Вопрос для размышления";
  const quoted = suggestion.text
    .split(/\r?\n/u)
    .map((line) => `> ${escapeMarkdownPlainText(line)}`)
    .join("\n");
  return `${heading}\n\n${quoted}`;
}
