import { describe, expect, it } from "vitest";
import { createDefaultIntegrations } from "../data/integrations";
import { createDefaultSettings } from "../data/settings";
import { createInitialState } from "../data/seed";
import {
  addUniversalObject,
  createUniversalObject,
  ObjectGraphError,
  patchUniversalObject
} from "../domain/objects/objectGraph";
import {
  createReflectionNote,
  reflectionDocuments
} from "../domain/reflections/reflectionNote";
import {
  acceptReflectionAnalysis,
  applyNoteUpdate,
  applyTaskUpdate,
  commitDashboardMutation
} from "../state/DashboardContext";
import type { Note, ReflectionAnalysisResponse, Task } from "../types";
import { migrateState, readBackup } from "./storage";

const stamp = "2026-07-15T10:00:00.000Z";

function legacyReflection(overrides: Record<string, unknown> = {}) {
  return {
    id: "legacy-reflection",
    noteId: null,
    originalText: "Исходная личная запись",
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
    createdAt: stamp,
    updatedAt: stamp,
    confirmedAt: null,
    ...overrides
  };
}

function legacyV14State(): any {
  const current = createInitialState();
  return {
    ...current,
    version: 14,
    notes: current.notes.map(({ contentUpdatedAt: _content, reflection: _reflection, ...note }) => note),
    reflections: [],
    assistantMemory: current.assistantMemory.map((item) => ({ ...item })),
    trash: [],
    revisionHistory: []
  };
}

describe("storage migration v15", () => {
  it("rejects an unknown future version instead of silently downgrading it", () => {
    expect(() => migrateState({ ...createInitialState(), version: 16 } as never))
      .toThrow("Неподдерживаемая версия");
  });

  it("keeps a valid v15 state idempotent, including native objects", () => {
    const state = createInitialState();
    const object = createUniversalObject(
      { id: "native-doc", roles: ["document"], title: "Документ" },
      { now: state.updatedAt }
    );
    state.objectGraph = addUniversalObject(state.objectGraph, object);

    expect(migrateState(state)).toEqual(state);
    expect(migrateState(state).objectGraph.objects).toContainEqual(
      expect.objectContaining({ id: "native-doc" })
    );
  });

  it("converts the legacy reflection widget without changing its stable id", () => {
    const state = createInitialState();
    const documentWidget = state.widgets.find((widget) => widget.type === "document");
    expect(documentWidget).toBeDefined();
    state.widgets = state.widgets.map((widget) =>
      widget.id === documentWidget!.id
        ? {
            ...widget,
            id: "legacy-reflection-slot",
            type: "reflection" as const,
            title: "Записать и осмыслить"
          }
        : widget
    );

    const migrated = migrateState(state);
    expect(migrated.widgets).toContainEqual(expect.objectContaining({
      id: "legacy-reflection-slot",
      type: "document",
      title: "Текст"
    }));
  });

  it("creates current defaults from the first storage version", () => {
    const migrated = migrateState({
      version: 1,
      tasks: [],
      projects: [],
      settings: {
        userName: "",
        workdayStart: "09:00",
        workdayEnd: "18:00",
        dailyCapacityMinutes: 360,
        focusBlockMinutes: 50,
        bufferMinutes: 10,
        currentEnergy: "medium",
        theme: "system"
      },
      updatedAt: stamp
    });

    expect(migrated.version).toBe(15);
    expect(migrated.notes).toEqual([]);
    expect(reflectionDocuments(migrated.notes)).toEqual([]);
    expect(migrated.trash).toEqual([]);
    expect(migrated.revisionHistory).toEqual([]);
    expect(migrated.widgets.some((widget) => widget.type === "document")).toBe(true);
    expect(migrated.objectGraph).toEqual({ schemaVersion: 1, objects: [], relations: [] });
  });

  it("migrates a legacy reflection into one canonical document without losing text", () => {
    const migrated = migrateState({
      version: 7,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      reflections: [legacyReflection({
        status: "queued",
        analysisRequestId: "request",
        analysisRequestedAt: stamp,
        analysisSourceUpdatedAt: stamp
      })],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: [],
      readingItems: [],
      activityLog: [],
      updatedAt: stamp
    } as never);
    const documents = reflectionDocuments(migrated.notes);

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      id: "reflection-note-legacy-reflection",
      body: "Исходная личная запись",
      origin: "reflection",
      tags: ["осмысление"],
      reflection: {
        status: "captured",
        analysisRequestDigest: null
      }
    });
    expect(migrated).not.toHaveProperty("reflections");
  });

  it("preserves an edited linked document and retains the legacy source only as an audit snapshot", () => {
    const legacy = legacyV14State();
    legacy.notes = [{
      id: "existing-note",
      title: "Пользовательский заголовок",
      body: "Пользовательский текст нельзя перезаписывать",
      projectId: null,
      tags: ["личное"],
      pinned: true,
      origin: "reflection",
      createdAt: stamp,
      updatedAt: stamp
    }];
    legacy.reflections = [legacyReflection({
      id: "linked",
      noteId: "existing-note",
      originalText: "Старый исходный текст"
    })] as never[];

    const migrated = migrateState(legacy as never);
    const document = reflectionDocuments(migrated.notes)[0];

    expect(document.id).toBe("existing-note");
    expect(document.body).toBe("Пользовательский текст нельзя перезаписывать");
    expect(document.reflection.analysisSourceText).toBe("Старый исходный текст");
    expect(migrated.notes).toHaveLength(1);
  });

  it("does not attach a reflection to an unrelated colliding note id", () => {
    const legacy = legacyV14State();
    legacy.notes = [{
      id: "reflection-note-needs-note",
      title: "Чужая заметка",
      body: "Отдельное содержимое",
      projectId: null,
      tags: [],
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp
    }];
    legacy.reflections = [legacyReflection({ id: "needs/note" })] as never[];

    const migrated = migrateState(legacy as never);
    expect(migrated.notes.find((note) => note.id === "reflection-note-needs-note")?.body)
      .toBe("Отдельное содержимое");
    expect(reflectionDocuments(migrated.notes)).toContainEqual(
      expect.objectContaining({ id: "reflection-note-needs-note-2", body: "Исходная личная запись" })
    );
  });

  it("maps legacy reflection memory to the document id", () => {
    const legacy = legacyV14State();
    legacy.reflections = [legacyReflection({ id: "source", noteId: null })] as never[];
    legacy.assistantMemory = [{
      id: "memory",
      text: "Полезная формулировка",
      sourceType: "reflection",
      sourceId: "source",
      sourceUpdatedAt: stamp,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }];

    const migrated = migrateState(legacy as never);
    expect(migrated.assistantMemory[0]).toMatchObject({
      sourceType: "document",
      sourceId: "reflection-note-source"
    });
  });

  it("converts reflection trash into ordinary recoverable note trash", () => {
    const legacy = legacyV14State();
    legacy.trash = [{
      id: "trash-reflection",
      entityKind: "reflection",
      entityId: "deleted-reflection",
      title: "Удалённая запись",
      deletedAt: stamp,
      snapshot: {
        kind: "reflection",
        reflection: legacyReflection({ id: "deleted-reflection" }),
        linkedNote: null
      }
    }];

    const migrated = migrateState(legacy as never);
    expect(migrated.trash[0]).toMatchObject({
      id: "trash-reflection",
      entityKind: "note",
      snapshot: {
        kind: "note",
        note: {
          body: "Исходная личная запись",
          reflection: { status: "captured" }
        }
      }
    });
  });

  it("validates current backups and rejects malformed canonical documents", async () => {
    const fileFrom = (value: unknown) => ({
      text: async () => JSON.stringify(value)
    }) as File;
    const valid = createInitialState();
    await expect(readBackup(fileFrom(valid))).resolves.toEqual(valid);
    await expect(readBackup(fileFrom({
      ...valid,
      notes: [{
        id: "broken",
        title: "Broken",
        body: "",
        projectId: null,
        tags: [],
        pinned: false,
        contentUpdatedAt: "not-a-date",
        reflection: null,
        createdAt: stamp,
        updatedAt: stamp
      }]
    }))).rejects.toThrow();
  });
});

describe("reflection analysis matching", () => {
  const base = createReflectionNote(
    "Исходный текст остаётся неизменным.",
    "reflection-1",
    stamp
  );
  const entry = {
    ...base,
    reflection: {
      ...base.reflection,
      status: "queued" as const,
      analysisRequestId: "request-1",
      analysisRequestDigest: "digest-1",
      analysisRequestedAt: "2026-07-15T10:01:00.000Z",
      analysisSourceUpdatedAt: stamp,
      analysisSourceText: base.body,
      analysisMemoryRefs: [{ id: "memory-1", updatedAt: "2026-07-15T09:30:00.000Z" }]
    },
    updatedAt: "2026-07-15T10:01:00.000Z"
  };
  const response: ReflectionAnalysisResponse = {
    entryId: entry.id,
    requestId: "request-1",
    requestDigest: "digest-1",
    sourceUpdatedAt: stamp,
    analysis: {
      responseId: "response-1",
      requestId: "request-1",
      understanding: "Краткое понимание",
      observations: ["Наблюдение"],
      possibleExplanation: "Возможное объяснение",
      alternatives: ["Альтернатива"],
      question: "Важный вопрос?",
      proposedAction: "Небольшой следующий шаг",
      source: "codex",
      generatedAt: "2026-07-15T10:02:00.000Z"
    }
  };

  it("accepts only the matching response and keeps document content unchanged", () => {
    const accepted = acceptReflectionAnalysis(entry, response, "2026-07-15T10:03:00.000Z");

    expect(accepted?.body).toBe(entry.body);
    expect(accepted?.reflection.status).toBe("analyzed");
    expect(accepted?.reflection.analysis?.responseId).toBe("response-1");
    expect(accepted?.reflection.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "response-1:meaning",
      "response-1:question",
      "response-1:next_action"
    ]);
    expect(acceptReflectionAnalysis(accepted!, response, stamp)).toBeNull();
    expect(acceptReflectionAnalysis(entry, { ...response, sourceUpdatedAt: "stale" }, stamp))
      .toBeNull();
  });
});

describe("note privacy and reflection metadata", () => {
  it("preserves durable identity and provenance on generic updates", () => {
    const note = createReflectionNote("Исходный текст", "private-reflection-note", stamp);
    const malicious = {
      title: "Разрешённое изменение",
      tags: [],
      origin: undefined,
      id: "replaced",
      createdAt: "replaced"
    } as unknown as Parameters<typeof applyNoteUpdate>[1];

    const updated = applyNoteUpdate(note, malicious, "2026-07-15T11:00:00.000Z");
    expect(updated).toMatchObject({
      id: note.id,
      origin: "reflection",
      title: "Разрешённое изменение",
      tags: [],
      contentUpdatedAt: stamp,
      reflection: { status: "captured" }
    });
  });

  it("invalidates a queued request when the canonical body changes", () => {
    const note = createReflectionNote("Первая версия", "queued", stamp);
    const queued: Note = {
      ...note,
      reflection: {
        ...note.reflection,
        status: "queued",
        analysisRequestId: "request",
        analysisRequestDigest: "digest",
        analysisRequestedAt: stamp,
        analysisSourceUpdatedAt: stamp,
        analysisSourceText: note.body
      }
    };
    const updatedAt = "2026-07-15T11:00:00.000Z";
    const changed = applyNoteUpdate(queued, { body: "Вторая версия" }, updatedAt);

    expect(changed.contentUpdatedAt).toBe(updatedAt);
    expect(changed.reflection).toMatchObject({
      status: "captured",
      analysisRequestId: null,
      analysisSourceText: null
    });
  });
});

describe("task identity and recurrence provenance", () => {
  it("does not let a generic update replace durable fields", () => {
    const task: Task = {
      id: "task-1",
      title: "Исходная задача",
      notes: "",
      status: "next",
      projectId: null,
      priority: 2,
      estimateMinutes: 25,
      energy: "medium",
      context: "Везде",
      dueDate: null,
      scheduledDate: null,
      completedAt: null,
      recurrence: "weekly",
      generatedFromTaskId: "task-template",
      createdAt: stamp,
      updatedAt: stamp
    };
    const malicious = {
      title: "  Новое название  ",
      priority: 99,
      status: "unknown",
      id: "replacement",
      generatedFromTaskId: "replacement-template"
    } as unknown as Parameters<typeof applyTaskUpdate>[1];

    expect(applyTaskUpdate(task, malicious, "2026-07-15T11:00:00.000Z")).toEqual({
      ...task,
      title: "Новое название",
      updatedAt: "2026-07-15T11:00:00.000Z"
    });
  });

  it("keeps completion timestamp consistent with task status", () => {
    const task = createInitialState().tasks[0];
    const completed = applyTaskUpdate(task, { status: "done" }, "2026-07-15T11:00:00.000Z");
    expect(completed.completedAt).toBe("2026-07-15T11:00:00.000Z");
    expect(applyTaskUpdate(completed, { status: "next" }, "2026-07-15T12:00:00.000Z").completedAt)
      .toBeNull();
  });
});

describe("atomic dashboard mutations", () => {
  it("raises a stale object revision without replacing the last valid state", () => {
    const initial = createInitialState();
    const object = createUniversalObject(
      { id: "atomic-document", title: "Версия 1" },
      { now: initial.updatedAt }
    );
    initial.objectGraph = addUniversalObject(initial.objectGraph, object);
    const cell = { current: initial };
    const published: typeof initial[] = [];

    commitDashboardMutation(cell, (current) => ({
      ...current,
      objectGraph: patchUniversalObject(current.objectGraph, object.id, { title: "Версия 2" }, {
        expectedRevision: object.revision,
        now: "2026-07-15T11:00:00.000Z"
      })
    }), "2026-07-15T11:00:00.000Z", (next) => published.push(next));

    const committed = cell.current;
    expect(() => commitDashboardMutation(cell, (current) => ({
      ...current,
      objectGraph: patchUniversalObject(current.objectGraph, object.id, { title: "Устаревшая запись" }, {
        expectedRevision: object.revision,
        now: "2026-07-15T11:01:00.000Z"
      })
    }), "2026-07-15T11:01:00.000Z", (next) => published.push(next))).toThrow(ObjectGraphError);

    expect(cell.current).toBe(committed);
    expect(published).toHaveLength(1);
  });
});
