import { describe, expect, it } from "vitest";
import type { Note } from "../../types";
import { appendEntityRevision, createEntityRevision, noteTrashEntry } from "./dataSafety";

const note: Note = {
  id: "note-1",
  title: "Первая мысль",
  body: "Исходный текст",
  projectId: null,
  tags: [],
  pinned: false,
  contentUpdatedAt: "2026-07-17T08:00:00.000Z",
  reflection: null,
  createdAt: "2026-07-17T08:00:00.000Z",
  updatedAt: "2026-07-17T08:00:00.000Z"
};

describe("data safety", () => {
  it("keeps a complete recoverable note tombstone", () => {
    const entry = noteTrashEntry(note, "2026-07-17T09:00:00.000Z", "trash-1");
    expect(entry).toMatchObject({
      id: "trash-1",
      entityId: "note-1",
      entityKind: "note",
      title: "Первая мысль",
      snapshot: { kind: "note", note }
    });
  });

  it("coalesces rapid edits but keeps a later rollback checkpoint", () => {
    const first = createEntityRevision(
      { kind: "note", note },
      "2026-07-17T09:00:00.000Z",
      "revision-1"
    );
    const rapid = createEntityRevision(
      { kind: "note", note: { ...note, body: "Второй текст" } },
      "2026-07-17T09:03:00.000Z",
      "revision-2"
    );
    const later = createEntityRevision(
      { kind: "note", note: { ...note, body: "Третий текст" } },
      "2026-07-17T09:06:00.000Z",
      "revision-3"
    );

    expect(appendEntityRevision([first], rapid)).toEqual([first]);
    expect(appendEntityRevision([first], later).map((entry) => entry.id)).toEqual([
      "revision-3",
      "revision-1"
    ]);
  });
});
