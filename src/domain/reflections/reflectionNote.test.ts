import { describe, expect, it } from "vitest";
import type { ReflectionEntry } from "../../types";
import {
  buildReflectionNoteTitle,
  createReflectionNote,
  hasLinkedReflectionNote
} from "./reflectionNote";

function reflection(overrides: Partial<ReflectionEntry> = {}): ReflectionEntry {
  return {
    id: "reflection-1",
    noteId: null,
    originalText: "Хочу выделить спокойное время на чтение.",
    status: "captured",
    analysis: null,
    correction: null,
    analysisRequestId: null,
    analysisRequestDigest: null,
    analysisRequestedAt: null,
    analysisSourceUpdatedAt: null,
    analysisContextSections: [],
    analysisProfileUpdatedAt: null,
    analysisMemoryRefs: [],
    suggestions: [],
    createdAt: "2026-07-15T08:30:00.000Z",
    updatedAt: "2026-07-15T08:30:00.000Z",
    confirmedAt: null,
    ...overrides
  };
}

describe("reflection note", () => {
  it("берёт первую содержательную строку и сохраняет исходный текст без изменений", () => {
    const originalText = "\n   \n  Хочу понять свой рабочий ритм   \nВторая строка остаётся в тексте.\n";
    const note = createReflectionNote(reflection({ originalText }), "note-1");

    expect(note.title).toBe("Осмысление: Хочу понять свой рабочий ритм");
    expect(note.body).toBe(originalText);
    expect(note.id).toBe("note-1");
    expect(note.tags).toEqual(["осмысление"]);
    expect(note.origin).toBe("reflection");
    expect(note.projectId).toBeNull();
    expect(note.pinned).toBe(false);
    expect(note.createdAt).toBe("2026-07-15T08:30:00.000Z");
    expect(note.updatedAt).toBe(note.createdAt);
  });

  it("ограничивает длинный русский заголовок 72 символами", () => {
    const title = buildReflectionNoteTitle(
      reflection({
        originalText:
          "Мне важно сохранить достаточно длинную и содержательную мысль, но не превращать её в громоздкий заголовок заметки"
      })
    );

    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith("…")).toBe(true);
  });

  it("использует дату как понятный заголовок для пустого текста", () => {
    expect(
      buildReflectionNoteTitle(reflection({ originalText: " \r\n\t", createdAt: "2026-07-15T23:50:00.000Z" }))
    ).toBe("Осмысление · 15.07.2026");
  });

  it("даёт стабильный id — связанный, явно переданный или производный", () => {
    expect(createReflectionNote(reflection({ noteId: "linked-note" })).id).toBe("linked-note");
    expect(createReflectionNote(reflection({ noteId: "linked-note" }), "chosen-note").id).toBe(
      "chosen-note"
    );
    expect(createReflectionNote(reflection()).id).toBe("reflection-note-reflection-1");
    expect(createReflectionNote(reflection()).id).toBe(createReflectionNote(reflection()).id);
  });

  it("проверяет не только ссылку, но при необходимости и наличие заметки", () => {
    const linked = reflection({ noteId: "note-1" });

    expect(hasLinkedReflectionNote(linked)).toBe(true);
    expect(hasLinkedReflectionNote(linked, [{ id: "note-1" }])).toBe(true);
    expect(hasLinkedReflectionNote(linked, [{ id: "another-note" }])).toBe(false);
    expect(hasLinkedReflectionNote(reflection(), [{ id: "note-1" }])).toBe(false);
  });
});
