import { describe, expect, it } from "vitest";
import type { CalendarEvent, Task } from "../types";
import { eventToGoogleEvent, resolveGoogleConflict, taskToGoogleTask } from "./google";

const task: Task = {
  id: "task-1",
  title: "Подготовить обзор",
  notes: "Черновик",
  status: "next",
  projectId: null,
  priority: 3,
  estimateMinutes: 45,
  energy: "high",
  context: "Компьютер",
  dueDate: "2026-07-20",
  scheduledDate: null,
  completedAt: null,
  recurrence: "none",
  generatedFromTaskId: null,
  createdAt: "2026-07-15T08:00:00.000Z",
  updatedAt: "2026-07-15T09:00:00.000Z"
};

it("maps dashboard tasks to a Google Tasks resource", () => {
  const mapped = taskToGoogleTask(task);
  expect(mapped.title).toBe(task.title);
  expect(mapped.due).toBe("2026-07-20T00:00:00.000Z");
  expect(mapped.notes).toContain("command-center-id: task-1");
});

describe("Google calendar mapping", () => {
  it("keeps local date-time and dashboard identifiers", () => {
    const event: CalendarEvent = {
      id: "event-1",
      title: "Фокус",
      startAt: "2026-07-15T10:00",
      endAt: "2026-07-15T11:00",
      kind: "focus",
      source: "dashboard",
      taskId: "task-1",
      notes: "",
      locked: true,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
    const mapped = eventToGoogleEvent(event, "Europe/Moscow");
    expect(mapped.start).toEqual({ dateTime: event.startAt, timeZone: "Europe/Moscow" });
    expect(mapped.extendedProperties.private.taskId).toBe("task-1");
  });
});

it("uses the configured conflict policy", () => {
  expect(resolveGoogleConflict("2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z", "latest")).toBe("remote");
  expect(resolveGoogleConflict("2026-07-15T10:00:00Z", "2026-07-15T11:00:00Z", "dashboard")).toBe("local");
});
