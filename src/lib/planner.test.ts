import { describe, expect, it } from "vitest";
import { buildDailyPlan, scoreTask } from "./planner";
import type { AppSettings, CalendarEvent, Task } from "../types";
import { createDefaultSettings } from "../data/settings";

const settings: AppSettings = {
  ...createDefaultSettings(),
  dailyCapacityMinutes: 60,
  currentEnergy: "high"
};

function task(overrides: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    title: "Задача",
    notes: "",
    status: "next",
    projectId: null,
    priority: 2,
    estimateMinutes: 30,
    energy: "medium",
    context: "Везде",
    dueDate: null,
    scheduledDate: null,
    completedAt: null,
    recurrence: "none",
    generatedFromTaskId: null,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
    ...overrides
  };
}

describe("planner", () => {
  it("поднимает просроченную задачу выше обычной", () => {
    const overdue = task({ dueDate: "2026-07-14", priority: 1 });
    const regular = task({ priority: 3 });
    expect(scoreTask(overdue, settings, "2026-07-15").score).toBeGreaterThan(
      scoreTask(regular, settings, "2026-07-15").score
    );
  });

  it("не переполняет дневную ёмкость", () => {
    const plan = buildDailyPlan(
      [task({ estimateMinutes: 45 }), task({ estimateMinutes: 30 })],
      settings,
      "2026-07-15"
    );
    expect(plan).toHaveLength(1);
  });

  it("исключает входящие и завершённые задачи", () => {
    const plan = buildDailyPlan(
      [task({ status: "inbox" }), task({ status: "done" }), task({ status: "next" })],
      settings,
      "2026-07-15"
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].task.status).toBe("next");
  });

  it("размещает задачу после занятого календарного блока", () => {
    const event: CalendarEvent = {
      id: "event-1",
      title: "Встреча",
      startAt: "2026-07-15T09:00",
      endAt: "2026-07-15T09:30",
      kind: "meeting",
      source: "local",
      taskId: null,
      notes: "",
      locked: true,
      createdAt: "2026-07-15T08:00:00.000Z",
      updatedAt: "2026-07-15T08:00:00.000Z"
    };
    const plan = buildDailyPlan(
      [task({ estimateMinutes: 20 })],
      settings,
      "2026-07-15",
      [event]
    );
    expect(plan[0].startMinutes).toBe(580);
  });

  it("сохраняет закреплённый фокус-блок", () => {
    const linkedTask = task({ id: "task-1" });
    const event: CalendarEvent = {
      id: "event-1",
      title: linkedTask.title,
      startAt: "2026-07-15T11:00",
      endAt: "2026-07-15T11:30",
      kind: "focus",
      source: "dashboard",
      taskId: linkedTask.id,
      notes: "",
      locked: true,
      createdAt: "2026-07-15T08:00:00.000Z",
      updatedAt: "2026-07-15T08:00:00.000Z"
    };
    const plan = buildDailyPlan([linkedTask], settings, "2026-07-15", [event]);
    expect(plan[0]).toMatchObject({ startMinutes: 660, confirmed: true });
  });
});
