import type { Note, ReflectionEntry } from "../../types";

const MAX_TITLE_LENGTH = 72;
const REFLECTION_TAG = "осмысление";

type ReflectionNoteSource = Pick<
  ReflectionEntry,
  "id" | "noteId" | "originalText" | "createdAt"
>;

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

/** Builds a compact title without changing the source reflection text. */
export function buildReflectionNoteTitle(
  entry: Pick<ReflectionEntry, "originalText" | "createdAt">
): string {
  const firstMeaningfulLine = entry.originalText
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .find(Boolean);

  if (firstMeaningfulLine) return truncateTitle(`Осмысление: ${firstMeaningfulLine}`);

  const date = formatReflectionDate(entry.createdAt);
  return date ? `Осмысление · ${date}` : "Осмысление";
}

/**
 * Creates the note representation of a reflection.
 * A deterministic fallback id keeps repeated projections of the same entry stable.
 */
export function createReflectionNote(entry: ReflectionNoteSource, noteId?: string): Note {
  const id = noteId ?? entry.noteId ?? `reflection-note-${entry.id}`;

  return {
    id,
    title: buildReflectionNoteTitle(entry),
    body: entry.originalText,
    projectId: null,
    tags: [REFLECTION_TAG],
    pinned: false,
    origin: "reflection",
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt
  };
}

/** Checks the stored link and, when notes are supplied, that its target still exists. */
export function hasLinkedReflectionNote(
  entry: Pick<ReflectionEntry, "noteId">,
  notes?: readonly Pick<Note, "id">[]
): boolean {
  if (!entry.noteId) return false;
  return notes ? notes.some((note) => note.id === entry.noteId) : true;
}
