import { describe, expect, it } from "vitest";
import type { Note } from "../../types";
import {
  buildReflectionNoteTitle,
  createReflectionNote,
  isReflectionDocument,
  reflectionDocuments
} from "./reflectionNote";

const createdAt = "2026-07-15T08:30:00.000Z";

describe("reflection document", () => {
  it("creates one canonical document and preserves the source text", () => {
    const text = "\n   \n  Хочу понять свой рабочий ритм   \nВторая строка остаётся в тексте.\n";
    const note = createReflectionNote(text, "note-1", createdAt);

    expect(note.title).toBe("Осмысление: Хочу понять свой рабочий ритм");
    expect(note.body).toBe(text);
    expect(note.id).toBe("note-1");
    expect(note.tags).toEqual(["осмысление"]);
    expect(note.origin).toBe("reflection");
    expect(note.contentUpdatedAt).toBe(createdAt);
    expect(note.reflection.status).toBe("captured");
  });

  it("limits a long title and uses the date for blank text", () => {
    const long = createReflectionNote(
      "Мне важно сохранить достаточно длинную и содержательную мысль, но не превращать её в громоздкий заголовок заметки",
      "long",
      createdAt
    );
    expect(buildReflectionNoteTitle(long).length).toBeLessThanOrEqual(72);
    expect(buildReflectionNoteTitle(long).endsWith("…")).toBe(true);

    const blank = createReflectionNote(" \r\n\t", "blank", "2026-07-15T23:50:00.000Z");
    expect(blank.title).toBe("Осмысление · 15.07.2026");
  });

  it("derives the Осмысление view from documents instead of a second entity list", () => {
    const reflection = createReflectionNote("Мысль", "reflection", createdAt);
    const tagged: Note = {
      id: "tagged",
      title: "Документ",
      body: "Текст",
      projectId: null,
      tags: ["осмысление"],
      pinned: false,
      contentUpdatedAt: createdAt,
      reflection: null,
      createdAt,
      updatedAt: createdAt
    };
    const regular: Note = { ...tagged, id: "regular", tags: [] };

    expect(isReflectionDocument(reflection)).toBe(true);
    expect(reflectionDocuments([reflection, tagged, regular]).map((note) => note.id)).toEqual([
      "reflection",
      "tagged"
    ]);
  });
});
