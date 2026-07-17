import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/data/seed.ts";
import { createReflectionNote } from "../src/domain/reflections/reflectionNote.ts";
import { buildCodexSnapshot } from "../src/lib/codexBridge.ts";
import {
  BridgeContractError,
  isCodexCommand,
  isSafeTaskUpdatePayload,
  validateCodexSnapshot
} from "./bridge-contract.mjs";

describe("Codex bridge snapshot contract", () => {
  it("accepts the schema v2 snapshot produced by the application", () => {
    const snapshot = buildCodexSnapshot(createInitialState());

    expect(snapshot.schemaVersion).toBe(2);
    expect(validateCodexSnapshot(snapshot)).toBe(snapshot);
  });

  it("accepts the separately enabled journal projection", () => {
    const state = createInitialState();
    const now = new Date().toISOString();
    state.integrations.codex.snapshotScope.journal = true;
    const document = createReflectionNote("Точная исходная запись", "reflection-1", now);
    state.notes = [{
      ...document,
      reflection: {
        ...document.reflection,
        status: "corrected",
        correction: "Уточнённая формулировка",
        confirmedAt: now
      }
    }];

    const snapshot = buildCodexSnapshot(state);

    expect(snapshot.data.journal).toHaveLength(1);
    expect(validateCodexSnapshot(snapshot)).toBe(snapshot);
  });

  it("removes unsupported legacy reading URLs before publishing", () => {
    const state = createInitialState();
    state.readingItems = [{
      id: "reading-legacy",
      title: "Старый материал",
      summary: "",
      body: "",
      url: "javascript:alert(1)",
      source: "Импорт",
      tags: [],
      createdAt: new Date().toISOString()
    }];

    const snapshot = buildCodexSnapshot(state);
    expect(snapshot.data.readingItems[0].url).toBe("");
    expect(validateCodexSnapshot(snapshot)).toBe(snapshot);
  });

  it("fails closed for old, future, incomplete and scope-violating snapshots", () => {
    const snapshot = buildCodexSnapshot(createInitialState());

    expect(() => validateCodexSnapshot({ ...snapshot, schemaVersion: 1 })).toThrow(BridgeContractError);
    expect(() => validateCodexSnapshot({ ...snapshot, schemaVersion: 3 })).toThrow(BridgeContractError);

    const missingJournalScope = structuredClone(snapshot);
    delete missingJournalScope.scope.journal;
    expect(() => validateCodexSnapshot(missingJournalScope)).toThrow(/поля/);

    const disabledJournal = structuredClone(snapshot);
    disabledJournal.scope.journal = false;
    disabledJournal.data.journal = [{
      id: "private-entry",
      text: "Не должно пройти",
      status: "captured",
      correction: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confirmedAt: null
    }];
    expect(() => validateCodexSnapshot(disabledJournal)).toThrow(/отключённую категорию journal/);
  });
});

describe("Codex update_task command contract", () => {
  const command = (payload) => ({
    id: "command-1",
    type: "update_task",
    entityId: "task-1",
    payload
  });

  it("accepts only explicitly editable task fields with their exact types", () => {
    const payload = {
      title: "Уточнить результат",
      notes: "Контекст задачи",
      status: "planned",
      projectId: null,
      priority: 4,
      estimateMinutes: 45,
      energy: "high",
      context: "Дом",
      dueDate: "2026-07-20",
      scheduledDate: null,
      recurrence: "weekly"
    };

    expect(isSafeTaskUpdatePayload(payload)).toBe(true);
    expect(isCodexCommand(command(payload))).toBe(true);
  });

  it.each([
    [{ id: "replacement-id" }, "id"],
    [{ createdAt: new Date().toISOString() }, "createdAt"],
    [{ updatedAt: new Date().toISOString() }, "updatedAt"],
    [{ completedAt: new Date().toISOString() }, "completedAt"],
    [{ generatedFromTaskId: "task-parent" }, "generatedFromTaskId"],
    [{ arbitrary: true }, "arbitrary"],
    [{ toString: "not an editable field" }, "inherited object key"],
    [{ priority: "4" }, "wrong priority type"],
    [{ estimateMinutes: -1 }, "negative estimate"],
    [{ dueDate: "not-a-date" }, "invalid date"],
    [{ status: "done" }, "completion bypass"],
    [{ energy: "maximum" }, "unknown energy"],
    [{}, "empty update"]
  ])("rejects unsafe payload %s (%s)", (payload) => {
    expect(isSafeTaskUpdatePayload(payload)).toBe(false);
    expect(isCodexCommand(command(payload))).toBe(false);
  });

  it("keeps completion as a separate exact command", () => {
    expect(isCodexCommand({
      id: "command-complete-1",
      type: "complete_task",
      entityId: "task-1"
    })).toBe(true);
    expect(isCodexCommand({
      id: "command-complete-1",
      type: "complete_task",
      entityId: "task-1",
      payload: {}
    })).toBe(false);
    expect(isCodexCommand({
      ...command({ title: "Новое название" }),
      createdAt: new Date().toISOString()
    })).toBe(false);
  });
});

describe("Codex create command contracts", () => {
  const command = (type, payload) => ({ id: `command-${type}`, type, payload });

  it("accepts complete, bounded drafts for every supported entity", () => {
    expect(isCodexCommand(command("add_task", {
      title: "Подготовить обзор",
      notes: "Только проверенные источники",
      status: "next",
      projectId: null,
      priority: 3,
      estimateMinutes: 60,
      energy: "high",
      context: "Компьютер",
      dueDate: "2026-07-20",
      scheduledDate: null,
      recurrence: "none"
    }))).toBe(true);
    expect(isCodexCommand(command("add_note", {
      title: "Наблюдение",
      body: "Текст",
      projectId: null,
      tags: ["мысль"],
      pinned: false
    }))).toBe(true);
    expect(isCodexCommand(command("add_reading", {
      title: "Статья",
      summary: "Кратко",
      body: "Полный текст",
      url: "https://example.com/article",
      source: "Example",
      tags: ["литература"]
    }))).toBe(true);
  });

  it.each([
    ["add_task", { title: "Задача", status: "done" }, "completion bypass"],
    ["add_task", { title: "Задача", generatedFromTaskId: "task-1" }, "recurrence provenance"],
    ["add_task", { title: "Задача", priority: 9 }, "invalid priority"],
    ["add_task", { title: "Задача", unknown: true }, "unknown field"],
    ["add_note", { title: "Заметка", tags: "not-an-array" }, "invalid tags"],
    ["add_note", { body: "Нет заголовка" }, "missing title"],
    ["add_reading", { title: "Опасная ссылка", url: "javascript:alert(1)" }, "unsafe URL"],
    ["add_reading", { title: "Материал", createdAt: new Date().toISOString() }, "server field"],
    ["add_reading", { title: "   " }, "blank title"]
  ])("rejects %s payload (%s)", (type, payload) => {
    expect(isCodexCommand(command(type, payload))).toBe(false);
  });

  it("requires an exact command envelope", () => {
    expect(isCodexCommand({
      ...command("add_note", { title: "Заметка" }),
      entityId: "note-1"
    })).toBe(false);
  });
});
