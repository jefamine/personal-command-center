import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import { createReflectionNote } from "../domain/reflections/reflectionNote";
import type { CalendarEvent, Note } from "../types";
import { buildCodexSnapshot } from "./codexBridge";

describe("buildCodexSnapshot", () => {
  it("публикует только разрешённую проекцию и исключает личные данные", () => {
    const state = createInitialState();
    const now = new Date().toISOString();
    const note: Note = {
      id: "private-note",
      title: "Личная заметка",
      body: "SECRET_NOTE_BODY",
      projectId: null,
      tags: ["личное"],
      pinned: false,
      contentUpdatedAt: now,
      reflection: null,
      createdAt: now,
      updatedAt: now
    };
    const event: CalendarEvent = {
      id: "private-event",
      title: "Встреча",
      startAt: now,
      endAt: now,
      kind: "meeting",
      source: "local",
      taskId: null,
      notes: "SECRET_EVENT_NOTES",
      locked: true,
      createdAt: now,
      updatedAt: now
    };
    state.tasks[0].notes = "SECRET_TASK_NOTES";
    state.projects[0].description = "SECRET_PROJECT_DESCRIPTION";
    state.events = [event];
    state.notes = [note];
    state.settings.userName = "SECRET_USER_NAME";
    state.integrations.obsidian.vaultPath = "C:\\SECRET_VAULT_PATH";
    state.activityLog = [{
      id: "private-activity",
      type: "task_created",
      entityId: null,
      timestamp: now,
      metadata: { private: "SECRET_ACTIVITY" }
    }];
    state.personalContext.goals = "SECRET_PERSONAL_CONTEXT";
    state.personalContext.updatedAt = now;
    state.assistantMemory = [{
      id: "private-memory",
      text: "SECRET_ASSISTANT_MEMORY",
      sourceType: "manual",
      sourceId: null,
      sourceUpdatedAt: null,
      status: "active",
      createdAt: now,
      updatedAt: now
    }];
    state.notes.push(createReflectionNote("SECRET_REFLECTION", "private-reflection", now));
    state.integrations.codex.snapshotScope = {
      tasks: true,
      projects: true,
      calendar: true,
      notes: false,
      journal: false,
      reading: true
    };

    const snapshot = buildCodexSnapshot(state);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.data.notes).toEqual([]);
    expect(snapshot.data.tasks[0]).not.toHaveProperty("notes");
    expect(snapshot.data.projects[0]).not.toHaveProperty("description");
    expect(snapshot.data.projects[0]).not.toHaveProperty("areaId");
    expect(snapshot.data.events[0]).not.toHaveProperty("notes");
    for (const secret of [
      "SECRET_TASK_NOTES",
      "SECRET_PROJECT_DESCRIPTION",
      "SECRET_EVENT_NOTES",
      "SECRET_NOTE_BODY",
      "SECRET_USER_NAME",
      "SECRET_VAULT_PATH",
      "SECRET_ACTIVITY",
      "SECRET_PERSONAL_CONTEXT",
      "SECRET_ASSISTANT_MEMORY",
      "SECRET_REFLECTION"
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(snapshot).not.toHaveProperty("settings");
    expect(snapshot).not.toHaveProperty("integrations");
    expect(snapshot).not.toHaveProperty("activityLog");
    expect(snapshot).not.toHaveProperty("reflections");
    expect(snapshot).not.toHaveProperty("personalContext");
    expect(snapshot).not.toHaveProperty("assistantMemory");
    expect(snapshot).not.toHaveProperty("lifeAreas");
  });

  it("включает тело обычной заметки только при явном разрешении", () => {
    const state = createInitialState();
    const now = new Date().toISOString();
    state.notes = [{
      id: "allowed-note",
      title: "Разрешённая заметка",
      body: "Разрешённое содержимое",
      projectId: null,
      tags: [],
      pinned: false,
      contentUpdatedAt: now,
      reflection: null,
      createdAt: now,
      updatedAt: now
    }, {
      id: "reflection-note",
      title: "Осмысление: скрытая запись",
      body: "SECRET_REFLECTION_NOTE_BODY",
      projectId: null,
      tags: ["осмысление"],
      pinned: false,
      contentUpdatedAt: now,
      reflection: null,
      createdAt: now,
      updatedAt: now
    }, {
      id: "orphan-reflection-note",
      title: "Осмысление: источник удалён",
      body: "SECRET_ORPHAN_REFLECTION_NOTE_BODY",
      projectId: null,
      tags: ["Осмысление"],
      pinned: false,
      contentUpdatedAt: now,
      reflection: null,
      createdAt: now,
      updatedAt: now
    }, {
      id: "private-origin-note",
      title: "Тег был изменён пользователем",
      body: "SECRET_ORIGIN_REFLECTION_NOTE_BODY",
      projectId: null,
      tags: [],
      pinned: false,
      origin: "reflection",
      contentUpdatedAt: now,
      reflection: null,
      createdAt: now,
      updatedAt: now
    }];
    state.integrations.codex.snapshotScope = {
      tasks: false,
      projects: false,
      calendar: false,
      notes: true,
      journal: false,
      reading: false
    };

    const snapshot = buildCodexSnapshot(state);

    expect(snapshot.data.notes).toHaveLength(1);
    expect(snapshot.data.notes[0].body).toBe("Разрешённое содержимое");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET_REFLECTION_NOTE_BODY");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET_ORPHAN_REFLECTION_NOTE_BODY");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET_ORIGIN_REFLECTION_NOTE_BODY");
    expect(snapshot.data.tasks).toEqual([]);
    expect(snapshot.data.projects).toEqual([]);
    expect(snapshot.data.events).toEqual([]);
    expect(snapshot.data.readingItems).toEqual([]);
  });

  it("передаёт дневник только после отдельного разрешения", () => {
    const state = createInitialState();
    const now = new Date().toISOString();
    state.notes = [
      createReflectionNote("Разрешённая запись дневника", "journal-entry", now)
    ];

    expect(buildCodexSnapshot(state).data.journal).toEqual([]);
    state.integrations.codex.snapshotScope.journal = true;

    expect(buildCodexSnapshot(state).data.journal).toEqual([
      expect.objectContaining({ id: "journal-entry", text: "Разрешённая запись дневника" })
    ]);
  });
});
