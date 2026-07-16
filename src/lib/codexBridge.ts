import type {
  CodexSnapshotScope,
  DashboardState
} from "../types";

const SAFE_DEFAULT_SCOPE: CodexSnapshotScope = {
  tasks: true,
  projects: true,
  calendar: true,
  notes: false,
  journal: false,
  reading: true
};

function normalizedScope(state: DashboardState): CodexSnapshotScope {
  const candidate = state.integrations?.codex?.snapshotScope as Partial<CodexSnapshotScope> | undefined;
  return {
    tasks: typeof candidate?.tasks === "boolean" ? candidate.tasks : SAFE_DEFAULT_SCOPE.tasks,
    projects: typeof candidate?.projects === "boolean" ? candidate.projects : SAFE_DEFAULT_SCOPE.projects,
    calendar: typeof candidate?.calendar === "boolean" ? candidate.calendar : SAFE_DEFAULT_SCOPE.calendar,
    notes: typeof candidate?.notes === "boolean" ? candidate.notes : SAFE_DEFAULT_SCOPE.notes,
    journal: typeof candidate?.journal === "boolean" ? candidate.journal : SAFE_DEFAULT_SCOPE.journal,
    reading: typeof candidate?.reading === "boolean" ? candidate.reading : SAFE_DEFAULT_SCOPE.reading
  };
}

export function buildCodexSnapshot(state: DashboardState) {
  const scope = normalizedScope(state);
  const reflectionNoteIds = new Set(
    state.reflections.map((entry) => entry.noteId).filter((id): id is string => Boolean(id))
  );
  return {
    schemaVersion: 2 as const,
    writtenAt: new Date().toISOString(),
    scope,
    data: {
      tasks: scope.tasks
        ? state.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            projectId: task.projectId,
            priority: task.priority,
            estimateMinutes: task.estimateMinutes,
            energy: task.energy,
            context: task.context,
            dueDate: task.dueDate,
            scheduledDate: task.scheduledDate,
            completedAt: task.completedAt,
            recurrence: task.recurrence,
            generatedFromTaskId: task.generatedFromTaskId,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
          }))
        : [],
      projects: scope.projects
        ? state.projects.map((project) => ({
            id: project.id,
            title: project.title,
            area: project.area,
            color: project.color,
            status: project.status,
            nextReviewAt: project.nextReviewAt,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt
          }))
        : [],
      events: scope.calendar
        ? state.events.map((event) => ({
            id: event.id,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            kind: event.kind,
            source: event.source,
            taskId: event.taskId,
            locked: event.locked,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt
          }))
        : [],
      notes: scope.notes
        ? state.notes.filter((note) =>
            note.origin !== "reflection" &&
            !reflectionNoteIds.has(note.id) &&
            !note.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление")
          ).map((note) => ({
            id: note.id,
            title: note.title,
            body: note.body,
            projectId: note.projectId,
            tags: [...note.tags],
            pinned: note.pinned,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt
          }))
        : [],
      journal: scope.journal
        ? state.reflections.map((entry) => ({
            id: entry.id,
            text: entry.originalText,
            status: entry.status,
            correction: entry.correction,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            confirmedAt: entry.confirmedAt
          }))
        : [],
      readingItems: scope.reading
        ? state.readingItems.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            body: item.body,
            url: item.url,
            source: item.source,
            tags: [...item.tags],
            createdAt: item.createdAt
          }))
        : []
    }
  };
}
