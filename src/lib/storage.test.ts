import { describe, expect, it } from "vitest";
import { migrateState, readBackup } from "./storage";
import { createDefaultIntegrations } from "../data/integrations";
import { createDefaultSettings } from "../data/settings";
import { createDefaultWidgets } from "../data/widgets";
import { createDefaultPersonalContext } from "../domain/profile/personalContext";
import { acceptReflectionAnalysis, applyNoteUpdate } from "../state/DashboardContext";
import type { Note, ReflectionAnalysisResponse, ReflectionEntry } from "../types";

describe("storage migration", () => {
  it("добавляет календарь в состояние первой версии", () => {
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
      updatedAt: "2026-07-15T00:00:00.000Z"
    });

    expect(migrated.version).toBe(12);
    expect(migrated.events).toEqual([]);
    expect(migrated.notes).toEqual([]);
    expect(migrated.integrations.codex.enabled).toBe(true);
    expect(migrated.integrations.google.status).toBe("disconnected");
    expect(migrated.settings.accentColor).toBe("#cfee45");
    expect(migrated.widgets.some((widget) => widget.type === "weather")).toBe(true);
    expect(migrated.widgets.some((widget) => widget.type === "reflection")).toBe(true);
    expect(migrated.widgets.find((widget) => widget.type === "recommendations")?.enabled).toBe(false);
    expect(migrated.widgets.every((widget) => widget.gridWidth && widget.gridHeight)).toBe(true);
    expect(migrated.activityLog).toEqual([]);
    expect(migrated.reflections).toEqual([]);
    expect(migrated.assistantMemory).toEqual([]);
    expect(migrated.personalContext).toEqual(createDefaultPersonalContext());
    expect(migrated.integrations.codex.snapshotScope.notes).toBe(false);
  });

  it("сохраняет данные версии 4 и добавляет настройки оформления", () => {
    const migrated = migrateState({
      version: 4,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      settings: {
        userName: "Анна",
        workdayStart: "10:00",
        workdayEnd: "19:00",
        dailyCapacityMinutes: 300,
        focusBlockMinutes: 45,
        bufferMinutes: 15,
        currentEnergy: "medium",
        theme: "dark"
      },
      integrations: createDefaultIntegrations(),
      updatedAt: "2026-07-15T00:00:00.000Z"
    });

    expect(migrated.version).toBe(12);
    expect(migrated.settings.userName).toBe("Анна");
    expect(migrated.settings.theme).toBe("dark");
    expect(migrated.settings.cornerStyle).toBe("rounded");
  });

  it("мигрирует версию 6 один раз, сохраняя виджеты и глубокие настройки доступа", () => {
    const defaults = createDefaultWidgets();
    const recommendations = defaults.find((widget) => widget.type === "recommendations")!;
    const legacyWidgets = [
      ...defaults.filter(
        (widget) => widget.type !== "reflection" && widget.type !== "recommendations"
      ).slice(0, 2),
      { ...recommendations, enabled: true },
      ...defaults.filter(
        (widget) => widget.type !== "reflection" && widget.type !== "recommendations"
      ).slice(2),
      {
        id: "custom-kept",
        type: "custom" as const,
        title: "Не потерять",
        enabled: true,
        size: "half" as const,
        gridWidth: 6,
        gridHeight: 4,
        order: 99,
        config: { body: "Пользовательская карточка" }
      }
    ].map((widget, order) => ({ ...widget, order }));

    const migrated = migrateState({
      version: 6,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      settings: createDefaultSettings(),
      integrations: {
        codex: {
          enabled: true,
          snapshotScope: { notes: true }
        }
      },
      widgets: legacyWidgets,
      readingItems: [],
      activityLog: [],
      updatedAt: "2026-07-15T00:00:00.000Z"
    });

    expect(migrated.version).toBe(12);
    expect(migrated.reflections).toEqual([]);
    expect(migrated.widgets.filter((widget) => widget.type === "reflection")).toHaveLength(1);
    expect(migrated.widgets.find((widget) => widget.type === "recommendations")?.enabled).toBe(false);
    expect(migrated.widgets.some((widget) => widget.id === "custom-kept")).toBe(true);
    expect(migrated.integrations.codex.snapshotScope).toEqual({
      tasks: true,
      projects: true,
      calendar: true,
      notes: true,
      journal: false,
      reading: true
    });

    const normalizedAgain = migrateState(migrated);
    expect(normalizedAgain.widgets).toEqual(migrated.widgets);
    expect(normalizedAgain.widgets.filter((widget) => widget.type === "reflection")).toHaveLength(1);
  });

  it("migrates v7 reflections without losing their content", () => {
    const migrated = migrateState({
      version: 7 as const,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      reflections: [
        {
          id: "legacy-reflection",
          originalText: "Исходная личная запись",
          status: "queued",
          analysis: null,
          correction: null,
          analysisRequestId: "legacy-request",
          analysisRequestedAt: "2026-07-15T10:01:00.000Z",
          analysisSourceUpdatedAt: "2026-07-15T10:00:00.000Z",
          createdAt: "2026-07-15T10:00:00.000Z",
          updatedAt: "2026-07-15T10:01:00.000Z",
          confirmedAt: null
        }
      ],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      updatedAt: "2026-07-15T10:01:00.000Z"
    });

    expect(migrated.version).toBe(12);
    expect(migrated.reflections).toHaveLength(1);
    expect(migrated.reflections[0]).toMatchObject({
      id: "legacy-reflection",
      noteId: "reflection-note-legacy-reflection",
      originalText: "Исходная личная запись",
      status: "captured",
      analysisRequestDigest: null,
      analysisContextSections: [],
      analysisProfileUpdatedAt: null,
      analysisMemoryRefs: [],
      suggestions: []
    });
    expect(migrated.notes).toContainEqual({
      id: "reflection-note-legacy-reflection",
      title: "Осмысление: Исходная личная запись",
      body: "Исходная личная запись",
      projectId: null,
      tags: ["осмысление"],
      pinned: false,
      origin: "reflection",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:01:00.000Z"
    });
    expect(migrated.personalContext).toEqual(createDefaultPersonalContext());
  });

  it("backfills reflection notes, preserves linked notes and stays idempotent", () => {
    const existingNote = {
      id: "existing-note",
      title: "Пользовательский заголовок",
      body: "Пользовательский текст нельзя перезаписывать",
      projectId: null,
      tags: ["личное"],
      pinned: true,
      createdAt: "2026-07-14T10:00:00.000Z",
      updatedAt: "2026-07-14T11:00:00.000Z"
    };
    const v8 = {
      version: 8 as const,
      tasks: [],
      projects: [],
      events: [],
      notes: [existingNote],
      reflections: [
        {
          id: "already-linked",
          noteId: "existing-note",
          originalText: "Эта запись уже связана с заметкой",
          status: "captured",
          analysis: null,
          correction: null,
          analysisRequestId: null,
          analysisRequestDigest: null,
          analysisRequestedAt: null,
          analysisSourceUpdatedAt: null,
          analysisContextSections: [],
          analysisProfileUpdatedAt: null,
          createdAt: "2026-07-15T09:00:00.000Z",
          updatedAt: "2026-07-15T09:01:00.000Z",
          confirmedAt: null
        },
        {
          id: "needs/note",
          originalText: "\n   Первая содержательная строка   \nВторая строка остаётся в теле",
          status: "captured",
          analysis: null,
          correction: null,
          analysisRequestId: null,
          analysisRequestDigest: null,
          analysisRequestedAt: null,
          analysisSourceUpdatedAt: null,
          analysisContextSections: [],
          analysisProfileUpdatedAt: null,
          createdAt: "2026-07-15T10:02:30.000Z",
          updatedAt: "2026-07-15T10:03:00.000Z",
          confirmedAt: null
        }
      ],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      personalContext: createDefaultPersonalContext(),
      updatedAt: "2026-07-15T10:03:00.000Z"
    };

    const migrated = migrateState(v8);
    expect(migrated.version).toBe(12);
    expect(migrated.notes[0]).toEqual({ ...existingNote, origin: "reflection" });
    expect(migrated.reflections[0].noteId).toBe("existing-note");
    expect(migrated.reflections[1].noteId).toBe("reflection-note-needs-note");
    expect(migrated.notes).toHaveLength(2);
    expect(migrated.notes[1]).toMatchObject({
      id: "reflection-note-needs-note",
      title: "Осмысление: Первая содержательная строка",
      body: v8.reflections[1].originalText,
      tags: ["осмысление"],
      pinned: false,
      origin: "reflection",
      projectId: null,
      createdAt: "2026-07-15T10:02:30.000Z",
      updatedAt: "2026-07-15T10:03:00.000Z"
    });

    expect(migrateState(migrated)).toEqual(migrated);
    expect(migrateState(migrated).notes).toHaveLength(2);
  });

  it("does not attach a reflection to an unrelated note when generated ids collide", () => {
    const unrelatedNote = {
      id: "reflection-note-needs-note",
      title: "Чужая заметка",
      body: "Её содержимое должно остаться отдельным",
      projectId: null,
      tags: ["другое"],
      pinned: false,
      createdAt: "2026-07-14T10:00:00.000Z",
      updatedAt: "2026-07-14T10:00:00.000Z"
    };
    const migrated = migrateState({
      version: 8,
      tasks: [],
      projects: [],
      events: [],
      notes: [unrelatedNote],
      reflections: [{
        id: "needs/note",
        originalText: "Личная запись",
        status: "captured",
        analysis: null,
        correction: null,
        analysisRequestId: null,
        analysisRequestDigest: null,
        analysisRequestedAt: null,
        analysisSourceUpdatedAt: null,
        analysisContextSections: [],
        analysisProfileUpdatedAt: null,
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:00:00.000Z",
        confirmedAt: null
      }],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      personalContext: createDefaultPersonalContext(),
      updatedAt: "2026-07-15T10:00:00.000Z"
    });

    expect(migrated.notes[0]).toEqual(unrelatedNote);
    expect(migrated.reflections[0].noteId).toBe("reflection-note-needs-note-2");
    expect(migrated.notes[1]).toMatchObject({
      id: "reflection-note-needs-note-2",
      body: "Личная запись",
      tags: ["осмысление"],
      origin: "reflection"
    });
    expect(migrateState(migrated)).toEqual(migrated);
  });

  it("normalizes valid v9 memory items and rejects empty, malformed or duplicate items", () => {
    const v9 = migrateState({
      version: 8,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      reflections: [],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      personalContext: createDefaultPersonalContext(),
      updatedAt: "2026-07-15T10:01:00.000Z"
    });
    const normalized = migrateState({
      ...v9,
      assistantMemory: [
        {
          id: "memory-1",
          text: "Мне удобен один ясный следующий шаг",
          sourceType: "manual",
          sourceId: "",
          sourceUpdatedAt: null,
          status: "active",
          createdAt: "2026-07-15T10:00:00.000Z",
          updatedAt: "2026-07-15T10:00:00.000Z"
        },
        {
          id: "memory-2",
          text: "Для глубокой работы нужна тишина",
          sourceType: "reflection",
          sourceId: "reflection-2",
          sourceUpdatedAt: "2026-07-15T10:01:00.000Z",
          status: "paused",
          createdAt: "2026-07-15T10:02:00.000Z",
          updatedAt: "2026-07-15T10:03:00.000Z"
        },
        {
          id: "memory-empty",
          text: "   ",
          sourceType: "manual",
          sourceId: null,
          sourceUpdatedAt: null,
          status: "active",
          createdAt: "2026-07-15T10:00:00.000Z",
          updatedAt: "2026-07-15T10:00:00.000Z"
        },
        {
          id: "memory-bad-date",
          text: "Некорректная дата",
          sourceType: "manual",
          sourceId: null,
          sourceUpdatedAt: null,
          status: "active",
          createdAt: "не дата",
          updatedAt: "2026-07-15T10:00:00.000Z"
        },
        {
          id: "memory-1",
          text: "Повтор идентификатора",
          sourceType: "manual",
          sourceId: null,
          sourceUpdatedAt: null,
          status: "active",
          createdAt: "2026-07-15T10:00:00.000Z",
          updatedAt: "2026-07-15T10:00:00.000Z"
        }
      ]
    } as typeof v9);

    expect(normalized.assistantMemory).toHaveLength(2);
    expect(normalized.assistantMemory[0]).toMatchObject({
      id: "memory-1",
      sourceId: null,
      sourceUpdatedAt: null,
      status: "active"
    });
    expect(normalized.assistantMemory[1]).toMatchObject({
      id: "memory-2",
      sourceType: "reflection",
      status: "paused"
    });
    expect(migrateState(normalized)).toEqual(normalized);
  });

  it("migrates v9 without losses and keeps only valid v10 memory references", () => {
    const originalText = "Точный исходный текст";
    const v9 = {
      version: 9 as const,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      reflections: [{
        id: "reflection-v9",
        noteId: null,
        originalText,
        status: "queued",
        analysis: null,
        correction: null,
        analysisRequestId: "request-v9",
        analysisRequestDigest: "digest-v9",
        analysisRequestedAt: "2026-07-15T10:01:00.000Z",
        analysisSourceUpdatedAt: "2026-07-15T10:00:00.000Z",
        analysisContextSections: [],
        analysisProfileUpdatedAt: null,
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:01:00.000Z",
        confirmedAt: null
      }],
      assistantMemory: [{
        id: "memory-v9",
        text: "Сохранить живую память без изменений",
        sourceType: "manual" as const,
        sourceId: null,
        sourceUpdatedAt: null,
        status: "active" as const,
        createdAt: "2026-07-15T09:00:00.000Z",
        updatedAt: "2026-07-15T09:30:00.000Z"
      }],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      personalContext: createDefaultPersonalContext(),
      updatedAt: "2026-07-15T10:01:00.000Z"
    };

    const migrated = migrateState(v9);
    expect(migrated.version).toBe(12);
    expect(migrated.reflections[0]).toMatchObject({
      originalText,
      status: "queued",
      analysisMemoryRefs: [],
      suggestions: []
    });
    expect(migrated.assistantMemory).toEqual(v9.assistantMemory);
    expect(migrated.notes[0].body).toBe(originalText);

    const withReferences = {
      ...migrated,
      reflections: migrated.reflections.map((entry) => ({
        ...entry,
        analysisMemoryRefs: [{
          id: "memory-v9",
          updatedAt: "2026-07-15T09:30:00.000Z"
        }]
      }))
    };
    expect(migrateState(withReferences)).toEqual(withReferences);

    const malformed = migrateState({
      ...withReferences,
      reflections: withReferences.reflections.map((entry) => ({
        ...entry,
        analysisMemoryRefs: [
          { id: "memory-v9", updatedAt: "2026-07-15T09:30:00.000Z" },
          { id: "memory-v9", updatedAt: "2026-07-15T09:31:00.000Z" }
        ]
      }))
    });
    expect(malformed.reflections[0].status).toBe("captured");
    expect(malformed.reflections[0].analysisMemoryRefs).toEqual([]);
  });

  it("adds no retroactive suggestions in v10 and normalizes v11 suggestions all-or-nothing", () => {
    const analysis = {
      responseId: "response-v10",
      requestId: "request-v10",
      understanding: "Понимание",
      observations: [],
      possibleExplanation: "Возможный смысл",
      alternatives: [],
      question: "Что проверить?",
      proposedAction: "Сделать маленький шаг",
      source: "codex" as const,
      generatedAt: "2026-07-15T10:02:00.000Z"
    };
    const legacyV10 = {
      version: 10 as const,
      tasks: [],
      projects: [],
      events: [],
      notes: [],
      reflections: [{
        id: "reflection-v10",
        noteId: null,
        originalText: "Старая разобранная запись",
        status: "analyzed",
        analysis,
        correction: null,
        analysisRequestId: "request-v10",
        analysisRequestDigest: "digest-v10",
        analysisRequestedAt: "2026-07-15T10:01:00.000Z",
        analysisSourceUpdatedAt: "2026-07-15T10:00:00.000Z",
        analysisContextSections: [],
        analysisProfileUpdatedAt: null,
        analysisMemoryRefs: [],
        createdAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:03:00.000Z",
        confirmedAt: null
      }],
      assistantMemory: [],
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      personalContext: createDefaultPersonalContext(),
      updatedAt: "2026-07-15T10:03:00.000Z"
    };

    const migrated = migrateState(legacyV10);
    expect(migrated.version).toBe(12);
    expect(migrated.reflections[0].suggestions).toEqual([]);

    const suggestion = {
      id: "response-v10:meaning",
      kind: "meaning" as const,
      sourceText: "Возможный смысл",
      text: "Уточнённый смысл",
      status: "accepted" as const,
      createdAt: "2026-07-15T10:02:00.000Z",
      updatedAt: "2026-07-15T10:04:00.000Z",
      decidedAt: "2026-07-15T10:04:00.000Z",
      addedToNoteAt: null,
      createdTaskId: null
    };
    const validV11 = {
      ...migrated,
      reflections: migrated.reflections.map((entry) => ({
        ...entry,
        suggestions: [suggestion]
      }))
    };
    expect(migrateState(validV11)).toEqual(validV11);

    const malformed = migrateState({
      ...validV11,
      reflections: validV11.reflections.map((entry) => ({
        ...entry,
        suggestions: [suggestion, { ...suggestion, text: "Повтор" }]
      }))
    });
    expect(malformed.reflections[0].analysis).toEqual(analysis);
    expect(malformed.reflections[0].suggestions).toEqual([]);

    const questionSuggestion = {
      ...suggestion,
      id: "response-v10:question",
      kind: "question" as const,
      sourceText: "Что проверить?",
      text: "Что проверить?",
      addedToNoteAt: "2026-07-15T10:05:00.000Z"
    };
    const missingLinkedNote = migrateState({
      ...validV11,
      notes: [],
      reflections: validV11.reflections.map((entry) => ({
        ...entry,
        suggestions: [
          { ...suggestion, addedToNoteAt: "2026-07-15T10:05:00.000Z" },
          questionSuggestion
        ]
      }))
    });
    expect(missingLinkedNote.notes).toHaveLength(1);
    expect(missingLinkedNote.notes[0].body).toBe("Старая разобранная запись");
    expect(missingLinkedNote.reflections[0].suggestions).toHaveLength(2);
    expect(missingLinkedNote.reflections[0].suggestions.every(
      (entry) => entry.addedToNoteAt === null
    )).toBe(true);
  });

  it("мигрирует старые названия областей v11 в устойчивые сферы жизни", () => {
    const legacyV11 = {
      version: 11 as const,
      tasks: [],
      projects: [{
        id: "project-work",
        title: "Рабочий проект",
        description: "",
        area: "Работа",
        color: "#2f80ed",
        status: "active" as const,
        nextReviewAt: null,
        createdAt: "2026-07-15T09:00:00.000Z",
        updatedAt: "2026-07-15T09:00:00.000Z"
      }],
      events: [],
      notes: [],
      reflections: [],
      assistantMemory: [],
      personalContext: createDefaultPersonalContext(),
      settings: createDefaultSettings(),
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: [],
      updatedAt: "2026-07-15T10:00:00.000Z"
    };

    const migrated = migrateState(legacyV11);
    expect(migrated.version).toBe(12);
    expect(migrated.lifeAreas).toHaveLength(1);
    expect(migrated.lifeAreas[0].title).toBe("Работа");
    expect(migrated.projects[0]).toMatchObject({
      areaId: migrated.lifeAreas[0].id,
      area: "Работа"
    });
    expect(migrateState(migrated)).toEqual(migrated);
  });

  it("accepts backup versions 1 through 12 and validates v11 suggestions plus v12 life areas", async () => {
    const baseBackup = {
      tasks: [],
      projects: [],
      settings: createDefaultSettings(),
      updatedAt: "2026-07-15T10:01:00.000Z"
    };
    const legacyV7 = {
      ...baseBackup,
      version: 7 as const,
      events: [],
      notes: [],
      reflections: [],
      integrations: createDefaultIntegrations(),
      widgets: createDefaultWidgets(),
      readingItems: [],
      activityLog: []
    };
    const fileFrom = (value: unknown) => ({
      text: async () => JSON.stringify(value)
    }) as File;

    const backups = [
      { ...baseBackup, version: 1 },
      { ...baseBackup, version: 2, events: [] },
      { ...baseBackup, version: 3, events: [], notes: [] },
      {
        ...baseBackup,
        version: 4,
        events: [],
        notes: [],
        integrations: createDefaultIntegrations()
      },
      {
        ...baseBackup,
        version: 5,
        events: [],
        notes: [],
        integrations: createDefaultIntegrations()
      },
      {
        ...baseBackup,
        version: 6,
        events: [],
        notes: [],
        integrations: createDefaultIntegrations(),
        widgets: createDefaultWidgets(),
        readingItems: [],
        activityLog: []
      },
      legacyV7,
      {
        ...legacyV7,
        version: 8,
        personalContext: createDefaultPersonalContext()
      }
    ];

    for (const backup of backups) {
      const imported = await readBackup(fileFrom(backup));
      expect(imported.version).toBe(12);
      expect(imported.personalContext).toEqual(createDefaultPersonalContext());
    }

    const validV8 = {
      ...legacyV7,
      version: 8 as const,
      personalContext: createDefaultPersonalContext()
    };
    const validV9 = {
      ...validV8,
      version: 9 as const,
      assistantMemory: []
    };
    const validV10 = {
      ...validV9,
      version: 10 as const
    };
    const validV11 = {
      ...validV10,
      version: 11 as const,
      reflections: (validV10.reflections as Array<Record<string, unknown>>)
        .map((entry) => ({ ...entry, suggestions: [] }))
    };
    const validV12 = migrateState(validV11);
    await expect(readBackup(fileFrom(validV9))).resolves.toEqual(validV12);
    await expect(readBackup(fileFrom(validV10))).resolves.toEqual(validV12);
    await expect(readBackup(fileFrom(validV11))).resolves.toEqual(validV12);
    await expect(readBackup(fileFrom(validV12))).resolves.toEqual(validV12);

    const { personalContext: _personalContext, ...invalidV8 } = validV8;
    await expect(readBackup(fileFrom(invalidV8))).rejects.toThrow();
    const { assistantMemory: _assistantMemory, ...invalidV9 } = validV9;
    await expect(readBackup(fileFrom(invalidV9))).rejects.toThrow();
    const { assistantMemory: _assistantMemoryV10, ...invalidV10 } = validV10;
    await expect(readBackup(fileFrom(invalidV10))).rejects.toThrow();
    const { assistantMemory: _assistantMemoryV11, ...invalidV11 } = validV11;
    await expect(readBackup(fileFrom(invalidV11))).rejects.toThrow();
    await expect(readBackup(fileFrom({
      ...validV11,
      reflections: [{ id: "reflection-without-suggestions" }]
    }))).rejects.toThrow();
    const { lifeAreas: _lifeAreas, ...invalidV12 } = validV12;
    await expect(readBackup(fileFrom(invalidV12))).rejects.toThrow();
  });
});

describe("reflection analysis matching", () => {
  const entry: ReflectionEntry = {
    id: "reflection-1",
    noteId: "reflection-note-reflection-1",
    originalText: "Исходный текст остаётся неизменным.",
    status: "queued",
    analysis: null,
    correction: null,
    analysisRequestId: "request-1",
    analysisRequestDigest: "digest-1",
    analysisRequestedAt: "2026-07-15T10:01:00.000Z",
    analysisSourceUpdatedAt: "2026-07-15T10:00:00.000Z",
    analysisContextSections: [],
    analysisProfileUpdatedAt: null,
    analysisMemoryRefs: [{
      id: "memory-1",
      updatedAt: "2026-07-15T09:30:00.000Z"
    }],
    suggestions: [],
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:01:00.000Z",
    confirmedAt: null
  };
  const response: ReflectionAnalysisResponse = {
    entryId: entry.id,
    requestId: "request-1",
    requestDigest: "digest-1",
    sourceUpdatedAt: "2026-07-15T10:00:00.000Z",
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

  it("принимает только актуальный ответ и не применяет его повторно", () => {
    const accepted = acceptReflectionAnalysis(
      entry,
      response,
      "2026-07-15T10:03:00.000Z"
    );

    expect(accepted?.status).toBe("analyzed");
    expect(accepted?.originalText).toBe(entry.originalText);
    expect(accepted?.analysis?.responseId).toBe("response-1");
    expect(accepted?.analysisMemoryRefs).toEqual(entry.analysisMemoryRefs);
    expect(accepted?.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "response-1:meaning",
      "response-1:question",
      "response-1:next_action"
    ]);
    expect(accepted?.suggestions[0]).toMatchObject({
      sourceText: "Возможное объяснение",
      text: "Возможное объяснение",
      status: "pending",
      createdAt: "2026-07-15T10:02:00.000Z",
      updatedAt: "2026-07-15T10:03:00.000Z"
    });
    expect(
      acceptReflectionAnalysis(
        accepted!,
        response,
        "2026-07-15T10:04:00.000Z"
      )
    ).toBeNull();
    expect(
      acceptReflectionAnalysis(
        entry,
        { ...response, sourceUpdatedAt: "stale" },
        "2026-07-15T10:04:00.000Z"
      )
    ).toBeNull();
  });
});

describe("note privacy provenance", () => {
  it("never lets a generic update overwrite reflection origin or durable identity", () => {
    const note: Note = {
      id: "private-reflection-note",
      title: "Исходный заголовок",
      body: "Исходный текст",
      projectId: null,
      tags: ["осмысление"],
      pinned: false,
      origin: "reflection",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z"
    };
    const malicious = {
      title: "Разрешённое изменение",
      tags: [],
      origin: undefined,
      id: "replaced",
      createdAt: "replaced"
    } as unknown as Parameters<typeof applyNoteUpdate>[1];

    expect(applyNoteUpdate(note, malicious, "2026-07-15T11:00:00.000Z")).toEqual({
      ...note,
      title: "Разрешённое изменение",
      tags: [],
      updatedAt: "2026-07-15T11:00:00.000Z"
    });
  });
});
