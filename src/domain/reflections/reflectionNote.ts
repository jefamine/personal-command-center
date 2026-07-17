import type {
  Note,
  ReflectionDocument,
  ReflectionMetadata
} from "../../types";

const MAX_TITLE_LENGTH = 72;
export const REFLECTION_TAG = "осмысление";

function formatReflectionDate(createdAt: string): string {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
  if (!isoDate) return "";

  const [, year, month, day] = isoDate;
  return `${day}.${month}.${year}`;
}

function truncateTitle(value: string): string {
  if (value.length <= MAX_TITLE_LENGTH) return value;

  const available = value.slice(0, MAX_TITLE_LENGTH - 1).trimEnd();
  const lastWordBoundary = available.lastIndexOf(" ");
  const readableCut = lastWordBoundary >= Math.floor(MAX_TITLE_LENGTH * 0.6)
    ? available.slice(0, lastWordBoundary)
    : available;

  return `${readableCut.trimEnd()}…`;
}

/** Builds a compact default title without creating a second copy of the document body. */
export function buildReflectionNoteTitle(
  document: Pick<Note, "body" | "createdAt">
): string {
  const firstMeaningfulLine = document.body
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .find(Boolean);

  if (firstMeaningfulLine) return truncateTitle(`Осмысление: ${firstMeaningfulLine}`);

  const date = formatReflectionDate(document.createdAt);
  return date ? `Осмысление · ${date}` : "Осмысление";
}

export function createReflectionMetadata(): ReflectionMetadata {
  return {
    status: "captured",
    analysis: null,
    correction: null,
    analysisRequestId: null,
    analysisRequestDigest: null,
    analysisRequestedAt: null,
    analysisSourceUpdatedAt: null,
    analysisSourceText: null,
    analysisContextSections: [],
    analysisProfileUpdatedAt: null,
    analysisMemoryRefs: [],
    suggestions: [],
    confirmedAt: null
  };
}

/** Creates one canonical document that can be shown in the “Осмысление” view. */
export function createReflectionNote(text: string, id: string, createdAt: string): ReflectionDocument {
  const document: Note = {
    id,
    title: "",
    body: text,
    projectId: null,
    tags: [REFLECTION_TAG],
    pinned: false,
    origin: "reflection",
    contentUpdatedAt: createdAt,
    reflection: createReflectionMetadata(),
    createdAt,
    updatedAt: createdAt
  };
  return {
    ...document,
    title: buildReflectionNoteTitle(document),
    reflection: document.reflection!
  };
}

export function isReflectionDocument(note: Note): note is ReflectionDocument {
  return note.reflection !== null;
}

export function reflectionDocuments(notes: readonly Note[]): ReflectionDocument[] {
  return notes
    .filter((note) =>
      isReflectionDocument(note) ||
      note.origin === "reflection" ||
      note.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === REFLECTION_TAG)
    )
    .map((note) => note.reflection
      ? note as ReflectionDocument
      : { ...note, reflection: createReflectionMetadata() }
    );
}

export function reflectionContentUpdatedAt(note: Pick<Note, "contentUpdatedAt" | "updatedAt">): string {
  return note.contentUpdatedAt || note.updatedAt;
}
