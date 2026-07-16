import type { CalendarEvent, Project, Task } from "../types";

export interface GoogleTaskResource {
  title: string;
  notes?: string;
  due?: string;
  status: "needsAction" | "completed";
}

export interface GoogleCalendarEventResource {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { commandCenterId: string; taskId?: string } };
}

export function taskToGoogleTask(task: Task, project?: Project): GoogleTaskResource {
  const metadata = [
    project ? `Проект: ${project.title}` : "",
    `Контекст: ${task.context}`,
    `Оценка: ${task.estimateMinutes} мин`,
    `command-center-id: ${task.id}`
  ].filter(Boolean);
  return {
    title: task.title,
    notes: [task.notes, ...metadata].filter(Boolean).join("\n\n"),
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : undefined,
    status: task.status === "done" ? "completed" : "needsAction"
  };
}

export function eventToGoogleEvent(
  event: CalendarEvent,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): GoogleCalendarEventResource {
  return {
    summary: event.title,
    description: event.notes || undefined,
    start: { dateTime: event.startAt, timeZone },
    end: { dateTime: event.endAt, timeZone },
    extendedProperties: {
      private: {
        commandCenterId: event.id,
        ...(event.taskId ? { taskId: event.taskId } : {})
      }
    }
  };
}

export function resolveGoogleConflict(
  localUpdatedAt: string,
  remoteUpdatedAt: string,
  policy: "latest" | "dashboard"
): "local" | "remote" {
  if (policy === "dashboard") return "local";
  return new Date(remoteUpdatedAt).getTime() > new Date(localUpdatedAt).getTime()
    ? "remote"
    : "local";
}
