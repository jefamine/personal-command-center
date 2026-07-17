import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { createInitialState } from "../data/seed";
import {
  addDays,
  addMonths,
  dateTimeFromMinutes,
  localDateKey,
  nextWeekday
} from "../lib/date";
import { loadState, saveState } from "../lib/storage";
import { normalizeWidgetLayout } from "../lib/widgetLayout";
import { safeExternalUrl } from "../lib/url";
import {
  addObjectRelation as addGraphRelation,
  addUniversalObject as addGraphObject,
  createUniversalObject,
  patchUniversalObject,
  removeObjectRelation as removeGraphRelation,
  type ObjectRelation,
  type ObjectRelationDraft,
  type UniversalObject,
  type UniversalObjectDraft
} from "../domain/objects/objectGraph";
import { lifeAreaTitleKey } from "../domain/life/lifeAreas";
import {
  appendEntityRevision,
  createEntityRevision,
  eventTrashEntry,
  noteTrashEntry,
  objectTrashEntry,
  reflectionTrashEntry,
  taskTrashEntry
} from "../domain/safety/dataSafety";
import { createDefaultPersonalContext, normalizePersonalContext } from "../domain/profile/personalContext";
import { createReflectionNote } from "../domain/reflections/reflectionNote";
import { memoryReferencesFromProjection } from "../domain/reflections/reflectionMemory";
import {
  decideReflectionSuggestionValue,
  deriveReflectionSuggestions,
  editReflectionSuggestionValue,
  reflectionSuggestionNoteSection
} from "../domain/reflections/reflectionSuggestions";
import type {
  AppSettings,
  AssistantMemoryItem,
  CalendarEvent,
  CalendarEventDraft,
  DashboardState,
  DashboardWidget,
  CodexIntegrationSettings,
  GoogleIntegrationSettings,
  LifeArea,
  LifeAreaDraft,
  LifeAreaUpdate,
  Note,
  NoteDraft,
  NoteUpdate,
  ObsidianIntegrationSettings,
  PersonalContextPatch,
  PersonalContextSectionId,
  PlanItem,
  Project,
  ReadingItem,
  ReadingItemDraft,
  ReflectionAnalysisResponse,
  ReflectionEntry,
  ReflectionMemoryProjection,
  ReflectionSuggestionStatus,
  Task,
  TaskDraft,
  TaskUpdate
} from "../types";

interface DashboardContextValue {
  state: DashboardState;
  ready: boolean;
  saving: boolean;
  storageError: string | null;
  addObject: (
    draft: UniversalObjectDraft,
    placement?: { parentId: string; kind?: "contains" | "embeds" }
  ) => UniversalObject;
  updateObject: (
    id: string,
    expectedRevision: number,
    changes: Partial<Pick<UniversalObject, "title" | "roles" | "blocks" | "properties" | "status">>
  ) => void;
  removeObject: (id: string) => void;
  addObjectRelation: (draft: ObjectRelationDraft) => ObjectRelation;
  removeObjectRelation: (relationId: string) => void;
  addTask: (draft: TaskDraft) => Task;
  updateTask: (id: string, changes: TaskUpdate) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  addNote: (draft: NoteDraft) => Note;
  updateNote: (id: string, changes: NoteUpdate) => void;
  removeNote: (id: string) => void;
  addReflection: (text: string) => ReflectionEntry;
  ensureReflectionNote: (id: string) => Note | null;
  markReflectionQueued: (
    id: string,
    requestId: string,
    sourceUpdatedAt: string,
    requestDigest: string,
    contextSections: PersonalContextSectionId[],
    profileUpdatedAt: string | null,
    memory: ReflectionMemoryProjection | null
  ) => void;
  cancelReflectionRequest: (id: string) => void;
  applyReflectionAnalysis: (response: ReflectionAnalysisResponse) => void;
  reviewReflection: (
    id: string,
    status: "confirmed" | "corrected" | "ignored",
    correction?: string
  ) => void;
  editReflectionSuggestion: (reflectionId: string, suggestionId: string, text: string) => void;
  decideReflectionSuggestion: (
    reflectionId: string,
    suggestionId: string,
    status: ReflectionSuggestionStatus
  ) => void;
  addReflectionSuggestionToNote: (reflectionId: string, suggestionId: string) => Note | null;
  createTaskFromReflectionSuggestion: (reflectionId: string, suggestionId: string) => Task | null;
  removeReflection: (id: string) => void;
  rememberReflection: (id: string, text: string) => AssistantMemoryItem | null;
  addAssistantMemory: (text: string) => AssistantMemoryItem;
  updateAssistantMemory: (
    id: string,
    changes: Partial<Pick<AssistantMemoryItem, "text" | "status">>
  ) => void;
  removeAssistantMemory: (id: string) => void;
  addProject: (title: string, description?: string) => Project;
  updateProject: (id: string, changes: Partial<Project>) => void;
  addLifeArea: (draft: LifeAreaDraft) => LifeArea | null;
  updateLifeArea: (id: string, changes: LifeAreaUpdate) => boolean;
  moveLifeArea: (id: string, direction: "up" | "down") => boolean;
  removeLifeArea: (id: string) => boolean;
  assignProjectToLifeArea: (projectId: string, areaId: string | null) => void;
  addEvent: (draft: CalendarEventDraft) => CalendarEvent;
  updateEvent: (id: string, changes: Partial<CalendarEvent>) => void;
  removeEvent: (id: string) => void;
  confirmPlan: (items: PlanItem[], dateKey: string) => void;
  updateSettings: (changes: Partial<AppSettings>) => void;
  updatePersonalContext: (changes: PersonalContextPatch) => void;
  clearPersonalContext: () => void;
  updateGoogleIntegration: (changes: Partial<GoogleIntegrationSettings>) => void;
  updateObsidianIntegration: (changes: Partial<ObsidianIntegrationSettings>) => void;
  updateCodexIntegration: (changes: Partial<CodexIntegrationSettings>) => void;
  updateWidgets: (widgets: DashboardWidget[]) => void;
  addReadingItem: (draft: ReadingItemDraft) => ReadingItem;
  removeReadingItem: (id: string) => void;
  restoreTrashEntry: (id: string) => boolean;
  purgeTrashEntry: (id: string) => void;
  emptyTrash: () => void;
  restoreRevision: (id: string) => boolean;
  clearRevisionHistory: () => void;
  replaceState: (state: DashboardState) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function acceptReflectionAnalysis(
  entry: ReflectionEntry,
  response: ReflectionAnalysisResponse,
  updatedAt: string
): ReflectionEntry | null {
  if (
    entry.status !== "queued" ||
    entry.id !== response.entryId ||
    entry.analysisRequestId !== response.requestId ||
    entry.analysisRequestDigest !== response.requestDigest ||
    entry.analysisSourceUpdatedAt !== response.sourceUpdatedAt ||
    response.analysis.requestId !== response.requestId
  ) {
    return null;
  }
  return {
    ...entry,
    status: "analyzed",
    analysis: response.analysis,
    suggestions: deriveReflectionSuggestions(response.analysis, updatedAt),
    correction: null,
    updatedAt,
    confirmedAt: null
  };
}

function withActivity(
  current: DashboardState,
  type: DashboardState["activityLog"][number]["type"],
  entityId: string | null,
  metadata: Record<string, string | number | boolean | null> = {}
) {
  return [
    { id: crypto.randomUUID(), type, entityId, timestamp: new Date().toISOString(), metadata },
    ...current.activityLog
  ].slice(0, 500);
}

function appendMarkdownSection(body: string, section: string): string {
  if (!body) return section;
  const separator = body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${section}`;
}

function availableReflectionNoteId(reflectionId: string, notes: Note[]): string {
  const base = `reflection-note-${reflectionId}`;
  if (!notes.some((note) => note.id === base)) return base;
  let suffix = 2;
  while (notes.some((note) => note.id === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Applies only editable note fields and preserves durable privacy provenance. */
export function applyNoteUpdate(note: Note, changes: NoteUpdate, updatedAt: string): Note {
  const next: Note = {
    ...note,
    ...(typeof changes.title === "string" ? { title: changes.title } : {}),
    ...(typeof changes.body === "string" ? { body: changes.body } : {}),
    ...(changes.projectId === null || typeof changes.projectId === "string"
      ? { projectId: changes.projectId }
      : {}),
    ...(Array.isArray(changes.tags) && changes.tags.every((tag) => typeof tag === "string")
      ? { tags: [...changes.tags] }
      : {}),
    ...(typeof changes.pinned === "boolean" ? { pinned: changes.pinned } : {}),
    id: note.id,
    origin: note.origin,
    createdAt: note.createdAt,
    updatedAt
  };
  return next;
}

const editableTaskStatuses = new Set<Task["status"]>([
  "inbox", "next", "planned", "waiting", "someday", "done"
]);
const editableTaskEnergy = new Set<Task["energy"]>(["low", "medium", "high"]);
const editableTaskRecurrences = new Set<Task["recurrence"]>([
  "none", "daily", "weekdays", "weekly", "monthly"
]);

function isTaskDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isTaskReference(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value);
}

/** Applies only editable task fields and preserves durable identity and recurrence provenance. */
export function applyTaskUpdate(task: Task, changes: TaskUpdate, updatedAt: string): Task {
  const next = { ...task };
  if (typeof changes.title === "string") {
    const title = changes.title.trim();
    if (title && title.length <= 500) next.title = title;
  }
  if (typeof changes.notes === "string" && changes.notes.length <= 200_000) next.notes = changes.notes;
  if (typeof changes.status === "string" && editableTaskStatuses.has(changes.status)) next.status = changes.status;
  if (changes.projectId === null || isTaskReference(changes.projectId)) next.projectId = changes.projectId;
  if (Number.isInteger(changes.priority) && changes.priority! >= 1 && changes.priority! <= 4) {
    next.priority = changes.priority as Task["priority"];
  }
  if (
    Number.isInteger(changes.estimateMinutes) &&
    changes.estimateMinutes! >= 0 &&
    changes.estimateMinutes! <= 24 * 60
  ) {
    next.estimateMinutes = changes.estimateMinutes!;
  }
  if (typeof changes.energy === "string" && editableTaskEnergy.has(changes.energy)) next.energy = changes.energy;
  if (typeof changes.context === "string" && changes.context.trim() && changes.context.length <= 200) {
    next.context = changes.context;
  }
  if (changes.dueDate === null || isTaskDate(changes.dueDate)) next.dueDate = changes.dueDate;
  if (changes.scheduledDate === null || isTaskDate(changes.scheduledDate)) {
    next.scheduledDate = changes.scheduledDate;
  }
  if (typeof changes.recurrence === "string" && editableTaskRecurrences.has(changes.recurrence)) {
    next.recurrence = changes.recurrence;
  }
  if (changes.completedAt === null || isTaskDate(changes.completedAt)) next.completedAt = changes.completedAt;

  next.completedAt = next.status === "done" ? next.completedAt ?? updatedAt : null;
  return {
    ...next,
    id: task.id,
    generatedFromTaskId: task.generatedFromTaskId,
    createdAt: task.createdAt,
    updatedAt
  };
}

/**
 * Commits against an eagerly updated cell so sequential UI actions observe the latest revision.
 * Domain errors are raised before React receives the new state and remain catchable by the caller.
 */
export function commitDashboardMutation(
  cell: { current: DashboardState },
  recipe: (current: DashboardState) => DashboardState,
  updatedAt: string,
  publish: (next: DashboardState) => void
): DashboardState {
  const current = cell.current;
  const next = recipe(current);
  if (next === current) return current;
  const committed = { ...next, updatedAt };
  cell.current = committed;
  publish(committed);
  return committed;
}

export function DashboardProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<DashboardState>(() => createInitialState());
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    loadState()
      .then((stored) => {
        if (active && stored) {
          stateRef.current = stored;
          setState(stored);
        }
      })
      .catch((error) => {
        console.error("Не удалось загрузить локальные данные", error);
        setStorageError(error instanceof Error ? error.message : "Не удалось прочитать локальные данные.");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || storageError) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = window.setTimeout(() => {
      saveState(state)
        .catch((error) => {
          console.error("Не удалось сохранить локальные данные", error);
          setStorageError(error instanceof Error ? error.message : "Не удалось сохранить локальные данные.");
        })
        .finally(() => setSaving(false));
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [ready, state, storageError]);

  const mutate = useCallback((recipe: (current: DashboardState) => DashboardState) => {
    commitDashboardMutation(stateRef, recipe, new Date().toISOString(), setState);
  }, []);

  const replaceState = useCallback((replacement: DashboardState) => {
    stateRef.current = replacement;
    setState(replacement);
  }, []);

  const addObject = useCallback(
    (
      draft: UniversalObjectDraft,
      placement?: { parentId: string; kind?: "contains" | "embeds" }
    ) => {
      const now = new Date().toISOString();
      const object = createUniversalObject(draft, { now });
      mutate((current) => {
        let objectGraph = addGraphObject(current.objectGraph, object);
        if (placement) {
          objectGraph = addGraphRelation(objectGraph, {
            kind: placement.kind ?? "contains",
            fromId: placement.parentId,
            toId: object.id
          }, { now });
        }
        return {
          ...current,
          objectGraph,
          activityLog: withActivity(current, "object_created", object.id, {
            parentId: placement?.parentId ?? null,
            relation: placement?.kind ?? (placement ? "contains" : null)
          })
        };
      });
      return object;
    },
    [mutate]
  );

  const updateObject = useCallback(
    (
      id: string,
      expectedRevision: number,
      changes: Partial<Pick<UniversalObject, "title" | "roles" | "blocks" | "properties" | "status">>
    ) => {
      mutate((current) => {
        const existing = current.objectGraph.objects.find((object) => object.id === id);
        if (!existing) return current;
        const now = new Date().toISOString();
        return {
          ...current,
          objectGraph: patchUniversalObject(current.objectGraph, id, changes, {
            expectedRevision,
            now
          }),
          revisionHistory: appendEntityRevision(
            current.revisionHistory,
            createEntityRevision({ kind: "object", object: existing }, now)
          ),
          activityLog: withActivity(current, "object_updated", id)
        };
      });
    },
    [mutate]
  );

  const removeObject = useCallback(
    (id: string) => {
      mutate((current) => {
        const object = current.objectGraph.objects.find((entry) => entry.id === id);
        if (!object) return current;
        const relations = current.objectGraph.relations.filter(
          (relation) => relation.fromId === id || relation.toId === id
        );
        const trashed = objectTrashEntry(object, relations);
        return {
          ...current,
          objectGraph: {
            ...current.objectGraph,
            objects: current.objectGraph.objects.filter((entry) => entry.id !== id),
            relations: current.objectGraph.relations.filter(
              (relation) => relation.fromId !== id && relation.toId !== id
            )
          },
          trash: [trashed, ...current.trash],
          activityLog: withActivity(current, "entity_trashed", id, { kind: "object" })
        };
      });
    },
    [mutate]
  );

  const addObjectRelation = useCallback(
    (draft: ObjectRelationDraft) => {
      const now = new Date().toISOString();
      const relation: ObjectRelation = {
        id: draft.id ?? crypto.randomUUID(),
        kind: draft.kind,
        fromId: draft.fromId,
        toId: draft.toId,
        order: draft.order ?? 0,
        createdAt: now
      };
      mutate((current) => ({
        ...current,
        objectGraph: addGraphRelation(current.objectGraph, relation, {
          now,
          idFactory: () => relation.id
        }),
        activityLog: withActivity(current, "object_relation_added", relation.id, {
          kind: relation.kind,
          fromId: relation.fromId,
          toId: relation.toId
        })
      }));
      return relation;
    },
    [mutate]
  );

  const removeObjectRelation = useCallback(
    (relationId: string) => {
      mutate((current) => {
        if (!current.objectGraph.relations.some((relation) => relation.id === relationId)) return current;
        return {
          ...current,
          objectGraph: removeGraphRelation(current.objectGraph, relationId),
          activityLog: withActivity(current, "object_relation_removed", relationId)
        };
      });
    },
    [mutate]
  );

  const addTask = useCallback(
    (draft: TaskDraft) => {
      const now = new Date().toISOString();
      const task: Task = {
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        notes: draft.notes ?? "",
        status: draft.status ?? "inbox",
        projectId:
          draft.projectId && state.projects.some((project) => project.id === draft.projectId)
            ? draft.projectId
            : null,
        priority: draft.priority ?? 2,
        estimateMinutes: draft.estimateMinutes ?? 25,
        energy: draft.energy ?? "medium",
        context: draft.context ?? "Везде",
        dueDate: draft.dueDate ?? null,
        scheduledDate: draft.scheduledDate ?? null,
        completedAt: null,
        recurrence: draft.recurrence ?? "none",
        generatedFromTaskId: draft.generatedFromTaskId ?? null,
        createdAt: now,
        updatedAt: now
      };
      mutate((current) => ({
        ...current,
        tasks: [task, ...current.tasks],
        activityLog: withActivity(current, "task_created", task.id, { status: task.status })
      }));
      return task;
    },
    [mutate, state.projects]
  );

  const updateTask = useCallback(
    (id: string, changes: TaskUpdate) => {
      mutate((current) => {
        const existing = current.tasks.find((task) => task.id === id);
        if (!existing) return current;
        const updatedAt = new Date().toISOString();
        const safeChanges =
          typeof changes.projectId === "string" &&
          !current.projects.some((project) => project.id === changes.projectId)
            ? { ...changes, projectId: undefined }
            : changes;
        const updated = applyTaskUpdate(existing, safeChanges, updatedAt);
        return {
          ...current,
          tasks: current.tasks.map((task) => task.id === id ? updated : task),
          events: current.events.map((event) =>
            event.taskId === id && updated.title !== existing.title
              ? { ...event, title: updated.title, updatedAt }
              : event
          ),
          revisionHistory: appendEntityRevision(
            current.revisionHistory,
            createEntityRevision({ kind: "task", task: existing }, updatedAt)
          )
        };
      });
    },
    [mutate]
  );

  const toggleTask = useCallback(
    (id: string) => {
      mutate((current) => {
        const existing = current.tasks.find((task) => task.id === id);
        if (!existing) return current;
        const now = new Date().toISOString();
        const activityLog = withActivity(
          current,
          existing.status === "done" ? "task_reopened" : "task_completed",
          id,
          { estimateMinutes: existing.estimateMinutes, energy: existing.energy }
        );

        if (existing.status === "done") {
          return {
            ...current,
            activityLog,
            revisionHistory: appendEntityRevision(
              current.revisionHistory,
              createEntityRevision({ kind: "task", task: existing }, now)
            ),
            tasks: current.tasks
              .filter((task) => task.generatedFromTaskId !== id || task.status === "done")
              .map((task) =>
                task.id === id
                  ? { ...task, status: "next", completedAt: null, updatedAt: now }
                  : task
              )
          };
        }

        const updatedTasks = current.tasks.map((task) =>
          task.id === id
            ? { ...task, status: "done" as const, completedAt: now, updatedAt: now }
            : task
        );
        if (
          existing.recurrence === "none" ||
          current.tasks.some((task) => task.generatedFromTaskId === id)
        ) {
          return {
            ...current,
            tasks: updatedTasks,
            activityLog,
            revisionHistory: appendEntityRevision(
              current.revisionHistory,
              createEntityRevision({ kind: "task", task: existing }, now)
            )
          };
        }

        const anchor = existing.scheduledDate ?? existing.dueDate ?? localDateKey();
        const advance = (dateKey: string) => {
          if (existing.recurrence === "daily") return addDays(dateKey, 1);
          if (existing.recurrence === "weekdays") return nextWeekday(dateKey);
          if (existing.recurrence === "weekly") return addDays(dateKey, 7);
          return addMonths(dateKey, 1);
        };
        const nextDate = advance(anchor);
        const generated: Task = {
          ...existing,
          id: crypto.randomUUID(),
          status: "planned",
          dueDate: existing.dueDate ? advance(existing.dueDate) : null,
          scheduledDate: existing.scheduledDate ? advance(existing.scheduledDate) : nextDate,
          completedAt: null,
          generatedFromTaskId: existing.id,
          createdAt: now,
          updatedAt: now
        };
        return {
          ...current,
          tasks: [generated, ...updatedTasks],
          activityLog,
          revisionHistory: appendEntityRevision(
            current.revisionHistory,
            createEntityRevision({ kind: "task", task: existing }, now)
          )
        };
      });
    },
    [mutate]
  );

  const removeTask = useCallback(
    (id: string) => {
      mutate((current) => {
        const task = current.tasks.find((entry) => entry.id === id);
        if (!task) return current;
        const linkedEvents = current.events.filter((event) => event.taskId === id);
        const trashed = taskTrashEntry(task, linkedEvents);
        return {
          ...current,
          tasks: current.tasks.filter((entry) => entry.id !== id),
          events: current.events.filter((event) => event.taskId !== id),
          trash: [trashed, ...current.trash],
          activityLog: withActivity(current, "entity_trashed", id, { kind: "task" })
        };
      });
    },
    [mutate]
  );

  const addNote = useCallback(
    (draft: NoteDraft) => {
      const now = new Date().toISOString();
      const note: Note = {
        id: crypto.randomUUID(),
        title: draft.title.trim() || "Без названия",
        body: draft.body ?? "",
        projectId:
          draft.projectId && state.projects.some((project) => project.id === draft.projectId)
            ? draft.projectId
            : null,
        tags: draft.tags ?? [],
        pinned: draft.pinned ?? false,
        createdAt: now,
        updatedAt: now
      };
      mutate((current) => ({
        ...current,
        notes: [note, ...current.notes],
        activityLog: withActivity(current, "note_created", note.id)
      }));
      return note;
    },
    [mutate, state.projects]
  );

  const updateNote = useCallback(
    (id: string, changes: NoteUpdate) => {
      const updatedAt = new Date().toISOString();
      mutate((current) => {
        const existing = current.notes.find((note) => note.id === id);
        if (!existing) return current;
        const updated = applyNoteUpdate(existing, changes, updatedAt);
        if (JSON.stringify(existing) === JSON.stringify(updated)) return current;
        return {
          ...current,
          notes: current.notes.map((note) => note.id === id ? updated : note),
          revisionHistory: appendEntityRevision(
            current.revisionHistory,
            createEntityRevision({ kind: "note", note: existing }, updatedAt)
          )
        };
      });
    },
    [mutate]
  );

  const removeNote = useCallback(
    (id: string) => {
      mutate((current) => {
        if (!current.notes.some((note) => note.id === id)) return current;
        const note = current.notes.find((entry) => entry.id === id)!;
        const now = new Date().toISOString();
        const trashed = noteTrashEntry(note, now);
        return {
          ...current,
          notes: current.notes.filter((note) => note.id !== id),
          trash: [trashed, ...current.trash],
          reflections: current.reflections.map((entry) =>
            entry.noteId === id && entry.suggestions.some((suggestion) => suggestion.addedToNoteAt)
              ? {
                  ...entry,
                  suggestions: entry.suggestions.map((suggestion) =>
                    suggestion.addedToNoteAt
                      ? { ...suggestion, addedToNoteAt: null, updatedAt: now }
                      : suggestion
                  ),
                  updatedAt: now
                }
              : entry
          ),
          activityLog: withActivity(current, "entity_trashed", id, { kind: "note" })
        };
      });
    },
    [mutate]
  );

  const addReflection = useCallback(
    (text: string) => {
      if (!text.trim()) throw new Error("Запись не может быть пустой.");
      const now = new Date().toISOString();
      const reflectionId = crypto.randomUUID();
      const noteId = `reflection-note-${reflectionId}`;
      const reflection: ReflectionEntry = {
        id: reflectionId,
        noteId,
        originalText: text,
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
        createdAt: now,
        updatedAt: now,
        confirmedAt: null
      };
      const note = createReflectionNote(reflection, noteId);
      mutate((current) => ({
        ...current,
        reflections: [reflection, ...current.reflections],
        notes: [note, ...current.notes],
        activityLog: withActivity(current, "reflection_created", reflection.id, {
          characters: text.length,
          noteCreated: true
        })
      }));
      return reflection;
    },
    [mutate]
  );

  const ensureReflectionNote = useCallback(
    (id: string) => {
      const reflection = state.reflections.find((entry) => entry.id === id);
      if (!reflection) return null;
      const linked = reflection.noteId
        ? state.notes.find((note) => note.id === reflection.noteId) ?? null
        : null;
      if (linked) return linked;

      const noteId = reflection.noteId ?? `reflection-note-${reflection.id}`;
      const note = createReflectionNote(reflection, noteId);
      mutate((current) => {
        const currentReflection = current.reflections.find((entry) => entry.id === id);
        if (!currentReflection) return current;
        const existing = current.notes.find((entry) =>
          entry.id === currentReflection.noteId || entry.id === noteId
        );
        if (existing && currentReflection.noteId === existing.id) return current;
        return {
          ...current,
          notes: existing ? current.notes : [note, ...current.notes],
          reflections: current.reflections.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  noteId: existing?.id ?? noteId,
                  suggestions: existing
                    ? entry.suggestions
                    : entry.suggestions.map((suggestion) =>
                        suggestion.addedToNoteAt
                          ? { ...suggestion, addedToNoteAt: null }
                          : suggestion
                      )
                }
              : entry
          ),
          activityLog: withActivity(current, "reflection_note_created", id)
        };
      });
      return note;
    },
    [mutate, state.notes, state.reflections]
  );

  const markReflectionQueued = useCallback(
    (
      id: string,
      requestId: string,
      sourceUpdatedAt: string,
      requestDigest: string,
      contextSections: PersonalContextSectionId[],
      profileUpdatedAt: string | null,
      memory: ReflectionMemoryProjection | null
    ) => {
      if (!requestId || !sourceUpdatedAt || !requestDigest) return;
      const analysisMemoryRefs = memoryReferencesFromProjection(memory);
      mutate((current) => {
        const reflection = current.reflections.find((entry) => entry.id === id);
        if (
          !reflection ||
          reflection.updatedAt !== sourceUpdatedAt ||
          reflection.status === "confirmed" ||
          reflection.status === "corrected"
        ) {
          return current;
        }
        const now = new Date().toISOString();
        return {
          ...current,
          reflections: current.reflections.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  status: "queued" as const,
                  analysis: null,
                  correction: null,
                  analysisRequestId: requestId,
                  analysisRequestDigest: requestDigest,
                  analysisRequestedAt: now,
                  analysisSourceUpdatedAt: sourceUpdatedAt,
                  analysisContextSections: [...contextSections],
                  analysisProfileUpdatedAt: profileUpdatedAt,
                  analysisMemoryRefs: analysisMemoryRefs.map((reference) => ({ ...reference })),
                  suggestions: [],
                  updatedAt: now,
                  confirmedAt: null
                }
              : entry
          ),
          activityLog: withActivity(current, "reflection_queued", id, {
            requestId,
            memoryItems: analysisMemoryRefs.length
          })
        };
      });
    },
    [mutate]
  );

  const cancelReflectionRequest = useCallback(
    (id: string) => {
      mutate((current) => {
        const reflection = current.reflections.find((entry) => entry.id === id);
        if (!reflection || reflection.status !== "queued") return current;
        const now = new Date().toISOString();
        return {
          ...current,
          reflections: current.reflections.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  status: "captured" as const,
                  analysisRequestId: null,
                  analysisRequestDigest: null,
                  analysisRequestedAt: null,
                  analysisSourceUpdatedAt: null,
                  analysisContextSections: [],
                  analysisProfileUpdatedAt: null,
                  analysisMemoryRefs: [],
                  suggestions: [],
                  updatedAt: now
                }
              : entry
          ),
          activityLog: withActivity(current, "reflection_queue_cancelled", id)
        };
      });
    },
    [mutate]
  );

  const applyReflectionAnalysis = useCallback(
    (response: ReflectionAnalysisResponse) => {
      mutate((current) => {
        const existing = current.reflections.find((entry) => entry.id === response.entryId);
        if (!existing) return current;
        const accepted = acceptReflectionAnalysis(
          existing,
          response,
          new Date().toISOString()
        );
        if (!accepted) return current;
        return {
          ...current,
          reflections: current.reflections.map((entry) =>
            entry.id === accepted.id ? accepted : entry
          ),
          activityLog: withActivity(current, "reflection_analyzed", accepted.id, {
            requestId: response.requestId,
            responseId: response.analysis.responseId
          })
        };
      });
    },
    [mutate]
  );

  const reviewReflection = useCallback(
    (
      id: string,
      status: "confirmed" | "corrected" | "ignored",
      correction?: string
    ) => {
      const normalizedCorrection = status === "corrected" ? correction?.trim() ?? "" : null;
      if (status === "corrected" && !normalizedCorrection) return;
      mutate((current) => {
        const reflection = current.reflections.find((entry) => entry.id === id);
        if (!reflection?.analysis) return current;
        if (
          reflection.status === status &&
          reflection.correction === normalizedCorrection
        ) {
          return current;
        }
        const now = new Date().toISOString();
        return {
          ...current,
          reflections: current.reflections.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  status,
                  correction: normalizedCorrection,
                  updatedAt: now,
                  confirmedAt: status === "ignored" ? null : now
                }
              : entry
          ),
          activityLog: withActivity(current, `reflection_${status}` as const, id, {
            responseId: reflection.analysis.responseId,
            hasCorrection: status === "corrected"
          })
        };
      });
    },
    [mutate]
  );

  const editReflectionSuggestion = useCallback(
    (reflectionId: string, suggestionId: string, text: string) => {
      const now = new Date().toISOString();
      mutate((current) => {
        const reflection = current.reflections.find((entry) => entry.id === reflectionId);
        const suggestion = reflection?.suggestions.find((entry) => entry.id === suggestionId);
        if (!reflection || !suggestion) return current;
        const edited = editReflectionSuggestionValue(suggestion, text, now);
        if (!edited || edited === suggestion) return current;
        return {
          ...current,
          reflections: current.reflections.map((entry) => entry.id === reflectionId
            ? {
                ...entry,
                suggestions: entry.suggestions.map((item) => item.id === suggestionId ? edited : item),
                updatedAt: now
              }
            : entry
          ),
          activityLog: withActivity(current, "reflection_suggestion_edited", suggestionId, {
            reflectionId,
            kind: suggestion.kind
          })
        };
      });
    },
    [mutate]
  );

  const decideReflectionSuggestion = useCallback(
    (
      reflectionId: string,
      suggestionId: string,
      status: ReflectionSuggestionStatus
    ) => {
      const now = new Date().toISOString();
      mutate((current) => {
        const reflection = current.reflections.find((entry) => entry.id === reflectionId);
        const suggestion = reflection?.suggestions.find((entry) => entry.id === suggestionId);
        if (!reflection || !suggestion) return current;
        const decided = decideReflectionSuggestionValue(suggestion, status, now);
        if (!decided || decided === suggestion) return current;
        return {
          ...current,
          reflections: current.reflections.map((entry) => entry.id === reflectionId
            ? {
                ...entry,
                suggestions: entry.suggestions.map((item) => item.id === suggestionId ? decided : item),
                updatedAt: now
              }
            : entry
          ),
          activityLog: withActivity(current, "reflection_suggestion_decided", suggestionId, {
            reflectionId,
            kind: suggestion.kind,
            status
          })
        };
      });
    },
    [mutate]
  );

  const addReflectionSuggestionToNote = useCallback(
    (reflectionId: string, suggestionId: string) => {
      const reflection = state.reflections.find((entry) => entry.id === reflectionId);
      const suggestion = reflection?.suggestions.find((entry) => entry.id === suggestionId);
      if (
        !reflection ||
        !suggestion ||
        suggestion.status !== "accepted" ||
        (suggestion.kind !== "meaning" && suggestion.kind !== "question")
      ) return null;
      const section = reflectionSuggestionNoteSection(suggestion);
      if (!section) return null;
      const linked = reflection.noteId
        ? state.notes.find((note) => note.id === reflection.noteId) ?? null
        : null;
      if (suggestion.addedToNoteAt && linked) return linked;

      const now = new Date().toISOString();
      const noteId = linked?.id ?? reflection.noteId ?? availableReflectionNoteId(reflection.id, state.notes);
      const baseNote = linked ?? createReflectionNote(reflection, noteId);
      const plannedNote: Note = {
        ...baseNote,
        body: appendMarkdownSection(baseNote.body, section),
        updatedAt: now
      };

      mutate((current) => {
        const currentReflection = current.reflections.find((entry) => entry.id === reflectionId);
        const currentSuggestion = currentReflection?.suggestions.find((entry) => entry.id === suggestionId);
        if (
          !currentReflection ||
          !currentSuggestion ||
          currentSuggestion.status !== "accepted" ||
          (currentSuggestion.kind !== "meaning" && currentSuggestion.kind !== "question")
        ) return current;
        const currentLinked = currentReflection.noteId
          ? current.notes.find((note) => note.id === currentReflection.noteId) ?? null
          : null;
        if (currentSuggestion.addedToNoteAt && currentLinked) return current;
        const currentSection = reflectionSuggestionNoteSection(currentSuggestion);
        if (!currentSection) return current;
        const currentNoteId = currentLinked?.id ?? currentReflection.noteId ??
          availableReflectionNoteId(currentReflection.id, current.notes);
        const currentBaseNote = currentLinked ?? createReflectionNote(currentReflection, currentNoteId);
        const appliedNote: Note = {
          ...currentBaseNote,
          body: appendMarkdownSection(currentBaseNote.body, currentSection),
          updatedAt: now
        };
        return {
          ...current,
          notes: currentLinked
            ? current.notes.map((note) => note.id === currentLinked.id ? appliedNote : note)
            : [appliedNote, ...current.notes],
          reflections: current.reflections.map((entry) => entry.id === reflectionId
            ? {
                ...entry,
                noteId: currentNoteId,
                suggestions: entry.suggestions.map((item) => {
                  if (item.id === suggestionId) {
                    return { ...item, addedToNoteAt: now, updatedAt: now };
                  }
                  return !currentLinked && item.addedToNoteAt
                    ? { ...item, addedToNoteAt: null, updatedAt: now }
                    : item;
                }),
                updatedAt: now
              }
            : entry
          ),
          activityLog: withActivity(current, "reflection_suggestion_note_applied", suggestionId, {
            reflectionId,
            kind: currentSuggestion.kind
          })
        };
      });
      return plannedNote;
    },
    [mutate, state.notes, state.reflections]
  );

  const createTaskFromReflectionSuggestion = useCallback(
    (reflectionId: string, suggestionId: string) => {
      const reflection = state.reflections.find((entry) => entry.id === reflectionId);
      const suggestion = reflection?.suggestions.find((entry) => entry.id === suggestionId);
      if (
        !reflection ||
        !suggestion ||
        suggestion.status !== "accepted" ||
        suggestion.kind !== "next_action"
      ) return null;
      const linked = suggestion.createdTaskId
        ? state.tasks.find((task) => task.id === suggestion.createdTaskId) ?? null
        : null;
      if (linked) return linked;

      const now = new Date().toISOString();
      const task: Task = {
        id: crypto.randomUUID(),
        title: suggestion.text.trim(),
        notes: "Добавлено вручную из принятого предложения к личной записи.",
        status: "inbox",
        projectId: null,
        priority: 2,
        estimateMinutes: 25,
        energy: "medium",
        context: "Везде",
        dueDate: null,
        scheduledDate: null,
        completedAt: null,
        recurrence: "none",
        generatedFromTaskId: null,
        createdAt: now,
        updatedAt: now
      };

      mutate((current) => {
        const currentReflection = current.reflections.find((entry) => entry.id === reflectionId);
        const currentSuggestion = currentReflection?.suggestions.find((entry) => entry.id === suggestionId);
        if (
          !currentReflection ||
          !currentSuggestion ||
          currentSuggestion.status !== "accepted" ||
          currentSuggestion.kind !== "next_action"
        ) return current;
        const currentLinked = currentSuggestion.createdTaskId
          ? current.tasks.find((entry) => entry.id === currentSuggestion.createdTaskId) ?? null
          : null;
        if (currentLinked) return current;
        const suggestionActivity = withActivity(
          current,
          "reflection_suggestion_task_created",
          suggestionId,
          { reflectionId, kind: currentSuggestion.kind }
        );
        const stateWithSuggestionActivity = { ...current, activityLog: suggestionActivity };
        return {
          ...current,
          tasks: [task, ...current.tasks],
          reflections: current.reflections.map((entry) => entry.id === reflectionId
            ? {
                ...entry,
                suggestions: entry.suggestions.map((item) => item.id === suggestionId
                  ? { ...item, createdTaskId: task.id, updatedAt: now }
                  : item
                ),
                updatedAt: now
              }
            : entry
          ),
          activityLog: withActivity(stateWithSuggestionActivity, "task_created", task.id, {
            status: "inbox"
          })
        };
      });
      return task;
    },
    [mutate, state.reflections, state.tasks]
  );

  const removeReflection = useCallback(
    (id: string) => {
      mutate((current) => {
        if (!current.reflections.some((entry) => entry.id === id)) return current;
        const reflection = current.reflections.find((entry) => entry.id === id)!;
        const linkedNote = reflection.noteId
          ? current.notes.find((note) => note.id === reflection.noteId) ?? null
          : null;
        const trashed = reflectionTrashEntry(reflection, linkedNote);
        return {
          ...current,
          reflections: current.reflections.filter((entry) => entry.id !== id),
          trash: [trashed, ...current.trash],
          activityLog: withActivity(current, "entity_trashed", id, { kind: "reflection" })
        };
      });
    },
    [mutate]
  );

  const rememberReflection = useCallback(
    (id: string, text: string) => {
      const normalizedText = text.trim();
      const reflection = state.reflections.find((entry) => entry.id === id);
      if (!reflection || !normalizedText) return null;
      const existing = state.assistantMemory.find(
        (item) => item.sourceType === "reflection" && item.sourceId === id
      );
      const now = new Date().toISOString();
      const memory: AssistantMemoryItem = existing
        ? {
            ...existing,
            text: normalizedText,
            sourceUpdatedAt: reflection.updatedAt,
            status: "active",
            updatedAt: now
          }
        : {
            id: crypto.randomUUID(),
            text: normalizedText,
            sourceType: "reflection",
            sourceId: id,
            sourceUpdatedAt: reflection.updatedAt,
            status: "active",
            createdAt: now,
            updatedAt: now
          };

      mutate((current) => {
        const currentReflection = current.reflections.find((entry) => entry.id === id);
        if (!currentReflection) return current;
        const currentExisting = current.assistantMemory.find(
          (item) => item.sourceType === "reflection" && item.sourceId === id
        );
        const nextMemory = {
          ...memory,
          id: currentExisting?.id ?? memory.id,
          createdAt: currentExisting?.createdAt ?? memory.createdAt,
          sourceUpdatedAt: currentReflection.updatedAt
        };
        return {
          ...current,
          assistantMemory: currentExisting
            ? current.assistantMemory.map((item) => item.id === currentExisting.id ? nextMemory : item)
            : [nextMemory, ...current.assistantMemory],
          activityLog: withActivity(
            current,
            currentExisting ? "memory_updated" : "memory_created",
            nextMemory.id,
            { source: "reflection" }
          )
        };
      });
      return memory;
    },
    [mutate, state.assistantMemory, state.reflections]
  );

  const addAssistantMemory = useCallback(
    (text: string) => {
      const normalizedText = text.trim();
      if (!normalizedText) throw new Error("Память не может быть пустой.");
      const now = new Date().toISOString();
      const memory: AssistantMemoryItem = {
        id: crypto.randomUUID(),
        text: normalizedText,
        sourceType: "manual",
        sourceId: null,
        sourceUpdatedAt: null,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      mutate((current) => ({
        ...current,
        assistantMemory: [memory, ...current.assistantMemory],
        activityLog: withActivity(current, "memory_created", memory.id, { source: "manual" })
      }));
      return memory;
    },
    [mutate]
  );

  const updateAssistantMemory = useCallback(
    (
      id: string,
      changes: Partial<Pick<AssistantMemoryItem, "text" | "status">>
    ) => {
      const normalizedText = typeof changes.text === "string" ? changes.text.trim() : undefined;
      if (changes.text !== undefined && !normalizedText) return;
      mutate((current) => {
        const existing = current.assistantMemory.find((item) => item.id === id);
        if (!existing) return current;
        const status = changes.status === "active" || changes.status === "paused"
          ? changes.status
          : existing.status;
        const text = normalizedText ?? existing.text;
        if (status === existing.status && text === existing.text) return current;
        const activityType = status !== existing.status
          ? status === "paused" ? "memory_paused" : "memory_resumed"
          : "memory_updated";
        const contentUpdatedAt = text !== existing.text
          ? new Date().toISOString()
          : existing.updatedAt;
        return {
          ...current,
          assistantMemory: current.assistantMemory.map((item) =>
            item.id === id
              ? { ...item, text, status, updatedAt: contentUpdatedAt }
              : item
          ),
          activityLog: withActivity(current, activityType, id)
        };
      });
    },
    [mutate]
  );

  const removeAssistantMemory = useCallback(
    (id: string) => {
      mutate((current) => {
        if (!current.assistantMemory.some((item) => item.id === id)) return current;
        return {
          ...current,
          assistantMemory: current.assistantMemory.filter((item) => item.id !== id),
          activityLog: withActivity(current, "memory_removed", id)
        };
      });
    },
    [mutate]
  );

  const addProject = useCallback(
    (title: string, description = "") => {
      const now = new Date().toISOString();
      const colors = ["#7c5cff", "#ff7a59", "#2eb67d", "#3e8ef7", "#d96aa7"];
      const project: Project = {
        id: crypto.randomUUID(),
        title: title.trim(),
        description,
        areaId: null,
        area: "Без области",
        color: colors[state.projects.length % colors.length],
        status: "active",
        nextReviewAt: null,
        createdAt: now,
        updatedAt: now
      };
      mutate((current) => ({ ...current, projects: [project, ...current.projects] }));
      return project;
    },
    [mutate, state.projects.length]
  );

  const updateProject = useCallback(
    (id: string, changes: Partial<Project>) => {
      mutate((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === id ? (() => {
            const requestedAreaId = Object.prototype.hasOwnProperty.call(changes, "areaId")
              ? changes.areaId
              : project.areaId;
            const area = typeof requestedAreaId === "string"
              ? current.lifeAreas.find((entry) => entry.id === requestedAreaId) ?? null
              : null;
            return {
              ...project,
              ...changes,
              id: project.id,
              areaId: area?.id ?? null,
              area: area?.title ?? "Без области",
              createdAt: project.createdAt,
              updatedAt: new Date().toISOString()
            };
          })() : project
        )
      }));
    },
    [mutate]
  );

  const addLifeArea = useCallback(
    (draft: LifeAreaDraft) => {
      const title = draft.title.trim().replace(/\s+/g, " ");
      if (!title || state.lifeAreas.some((area) => lifeAreaTitleKey(area.title) === lifeAreaTitleKey(title))) {
        return null;
      }
      const now = new Date().toISOString();
      const palette = ["#7c5cff", "#2f80ed", "#2eb67d", "#e28a38", "#d96aa7", "#7a8b3a"];
      const color = draft.color && /^#[0-9a-f]{6}$/i.test(draft.color)
        ? draft.color
        : palette[state.lifeAreas.length % palette.length];
      const area: LifeArea = {
        id: crypto.randomUUID(),
        title,
        description: draft.description?.trim() ?? "",
        color,
        archived: false,
        showInTopNavigation: true,
        order: state.lifeAreas.length,
        createdAt: now,
        updatedAt: now
      };
      mutate((current) => ({
        ...current,
        lifeAreas: [...current.lifeAreas, area],
        activityLog: withActivity(current, "life_area_created", area.id)
      }));
      return area;
    },
    [mutate, state.lifeAreas]
  );

  const updateLifeArea = useCallback(
    (id: string, changes: LifeAreaUpdate) => {
      const currentArea = state.lifeAreas.find((area) => area.id === id);
      if (!currentArea) return false;
      const title = typeof changes.title === "string"
        ? changes.title.trim().replace(/\s+/g, " ")
        : currentArea.title;
      if (
        !title ||
        state.lifeAreas.some((area) => area.id !== id && lifeAreaTitleKey(area.title) === lifeAreaTitleKey(title))
      ) return false;
      const now = new Date().toISOString();
      mutate((current) => ({
        ...current,
        lifeAreas: current.lifeAreas.map((area) => area.id === id ? {
          ...area,
          title,
          ...(typeof changes.description === "string" ? { description: changes.description } : {}),
          ...(typeof changes.color === "string" && /^#[0-9a-f]{6}$/i.test(changes.color)
            ? { color: changes.color }
            : {}),
          ...(typeof changes.archived === "boolean" ? { archived: changes.archived } : {}),
          ...(typeof changes.showInTopNavigation === "boolean"
            ? { showInTopNavigation: changes.showInTopNavigation }
            : {}),
          updatedAt: now
        } : area),
        projects: current.projects.map((project) => project.areaId === id
          ? { ...project, area: title, updatedAt: now }
          : project),
        activityLog: withActivity(current, "life_area_updated", id)
      }));
      return true;
    },
    [mutate, state.lifeAreas]
  );

  const moveLifeArea = useCallback(
    (id: string, direction: "up" | "down") => {
      const active = [...state.lifeAreas]
        .filter((area) => !area.archived)
        .sort((left, right) => left.order - right.order);
      const index = active.findIndex((area) => area.id === id);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= active.length) return false;

      const source = active[index];
      const target = active[targetIndex];
      const now = new Date().toISOString();
      mutate((current) => ({
        ...current,
        lifeAreas: current.lifeAreas
          .map((area) => {
            if (area.id === source.id) return { ...area, order: target.order, updatedAt: now };
            if (area.id === target.id) return { ...area, order: source.order, updatedAt: now };
            return area;
          })
          .sort((left, right) => left.order - right.order)
          .map((area, order) => ({ ...area, order })),
        activityLog: withActivity(current, "life_area_updated", id, { direction })
      }));
      return true;
    },
    [mutate, state.lifeAreas]
  );

  const removeLifeArea = useCallback(
    (id: string) => {
      if (!state.lifeAreas.some((area) => area.id === id)) return false;
      const now = new Date().toISOString();
      mutate((current) => {
        const affectedProjects = current.projects.filter((project) => project.areaId === id).length;
        return {
          ...current,
          lifeAreas: current.lifeAreas
            .filter((area) => area.id !== id)
            .map((area, order) => ({ ...area, order })),
          projects: current.projects.map((project) => project.areaId === id
            ? { ...project, areaId: null, area: "Без области", updatedAt: now }
            : project),
          activityLog: withActivity(current, "life_area_removed", id, { affectedProjects })
        };
      });
      return true;
    },
    [mutate, state.lifeAreas]
  );

  const assignProjectToLifeArea = useCallback(
    (projectId: string, areaId: string | null) => {
      mutate((current) => {
        const area = areaId ? current.lifeAreas.find((entry) => entry.id === areaId) ?? null : null;
        if (!current.projects.some((project) => project.id === projectId)) return current;
        const now = new Date().toISOString();
        return {
          ...current,
          projects: current.projects.map((project) => project.id === projectId
            ? { ...project, areaId: area?.id ?? null, area: area?.title ?? "Без области", updatedAt: now }
            : project),
          activityLog: withActivity(current, "project_area_changed", projectId, { areaId: area?.id ?? null })
        };
      });
    },
    [mutate]
  );

  const addEvent = useCallback(
    (draft: CalendarEventDraft) => {
      const now = new Date().toISOString();
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        startAt: draft.startAt,
        endAt: draft.endAt,
        kind: draft.kind ?? "meeting",
        source: draft.source ?? "local",
        taskId: draft.taskId ?? null,
        notes: draft.notes ?? "",
        locked: draft.locked ?? true,
        createdAt: now,
        updatedAt: now
      };
      mutate((current) => ({ ...current, events: [event, ...current.events] }));
      return event;
    },
    [mutate]
  );

  const updateEvent = useCallback(
    (id: string, changes: Partial<CalendarEvent>) => {
      mutate((current) => {
        const existing = current.events.find((event) => event.id === id);
        if (!existing) return current;
        const now = new Date().toISOString();
        return {
          ...current,
          events: current.events.map((event) =>
            event.id === id ? { ...event, ...changes, id: event.id, updatedAt: now } : event
          ),
          revisionHistory: appendEntityRevision(
            current.revisionHistory,
            createEntityRevision({ kind: "event", event: existing }, now)
          )
        };
      });
    },
    [mutate]
  );

  const removeEvent = useCallback(
    (id: string) => {
      mutate((current) => {
        const event = current.events.find((entry) => entry.id === id);
        if (!event) return current;
        const trashed = eventTrashEntry(event);
        return {
          ...current,
          events: current.events.filter((entry) => entry.id !== id),
          trash: [trashed, ...current.trash],
          activityLog: withActivity(current, "entity_trashed", id, { kind: "event" })
        };
      });
    },
    [mutate]
  );

  const confirmPlan = useCallback(
    (items: PlanItem[], dateKey: string) => {
      const suggestions = items.filter((item) => !item.confirmed);
      if (!suggestions.length) return;
      const now = new Date().toISOString();
      mutate((current) => {
        const existingTaskIds = new Set(
          current.events
            .filter((event) => event.startAt.startsWith(dateKey) && event.taskId)
            .map((event) => event.taskId)
        );
        const newEvents: CalendarEvent[] = suggestions
          .filter((item) => !existingTaskIds.has(item.task.id))
          .map((item) => ({
            id: crypto.randomUUID(),
            title: item.task.title,
            startAt: dateTimeFromMinutes(dateKey, item.startMinutes),
            endAt: dateTimeFromMinutes(dateKey, item.endMinutes),
            kind: "focus",
            source: "dashboard",
            taskId: item.task.id,
            notes: `Создано локальным планировщиком. ${item.reasons.join(", ")}.`,
            locked: true,
            createdAt: now,
            updatedAt: now
          }));
        const scheduledIds = new Set(newEvents.map((event) => event.taskId));
        return {
          ...current,
          events: [...newEvents, ...current.events],
          tasks: current.tasks.map((task) =>
            scheduledIds.has(task.id)
              ? {
                  ...task,
                  status: "planned",
                  scheduledDate: dateKey,
                  updatedAt: now
                }
              : task
          ),
          activityLog: withActivity(current, "plan_confirmed", null, { blocks: newEvents.length })
        };
      });
    },
    [mutate]
  );

  const updateSettings = useCallback(
    (changes: Partial<AppSettings>) => {
      mutate((current) => ({
        ...current,
        settings: { ...current.settings, ...changes }
      }));
    },
    [mutate]
  );

  const updatePersonalContext = useCallback(
    (changes: PersonalContextPatch) => {
      mutate((current) => {
        const next = normalizePersonalContext({
          ...current.personalContext,
          ...changes,
          systemProfile: changes.systemProfile
            ? { ...current.personalContext.systemProfile, ...changes.systemProfile }
            : current.personalContext.systemProfile,
          updatedAt: new Date().toISOString()
        });
        const unchanged = JSON.stringify({ ...next, updatedAt: null }) ===
          JSON.stringify({ ...current.personalContext, updatedAt: null });
        return unchanged ? current : { ...current, personalContext: next };
      });
    },
    [mutate]
  );

  const clearPersonalContext = useCallback(() => {
    mutate((current) => {
      const empty = createDefaultPersonalContext();
      const isEmpty = JSON.stringify(current.personalContext) === JSON.stringify(empty);
      return isEmpty ? current : { ...current, personalContext: empty };
    });
  }, [mutate]);

  const updateGoogleIntegration = useCallback(
    (changes: Partial<GoogleIntegrationSettings>) => {
      mutate((current) => ({
        ...current,
        integrations: {
          ...current.integrations,
          google: { ...current.integrations.google, ...changes }
        }
      }));
    },
    [mutate]
  );

  const updateObsidianIntegration = useCallback(
    (changes: Partial<ObsidianIntegrationSettings>) => {
      mutate((current) => ({
        ...current,
        integrations: {
          ...current.integrations,
          obsidian: { ...current.integrations.obsidian, ...changes }
        }
      }));
    },
    [mutate]
  );

  const updateCodexIntegration = useCallback(
    (changes: Partial<CodexIntegrationSettings>) => {
      mutate((current) => ({
        ...current,
        integrations: {
          ...current.integrations,
          codex: { ...current.integrations.codex, ...changes }
        }
      }));
    },
    [mutate]
  );

  const updateWidgets = useCallback(
    (widgets: DashboardWidget[]) => {
      mutate((current) => ({
        ...current,
        widgets: widgets.map((widget, order) => normalizeWidgetLayout({ ...widget, order }))
      }));
    },
    [mutate]
  );

  const addReadingItem = useCallback(
    (draft: ReadingItemDraft) => {
      const item: ReadingItem = {
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        summary: draft.summary ?? "",
        body: draft.body ?? "",
        url: safeExternalUrl(draft.url) ?? "",
        source: draft.source ?? "Вручную",
        tags: draft.tags ?? [],
        createdAt: new Date().toISOString()
      };
      mutate((current) => ({ ...current, readingItems: [item, ...current.readingItems] }));
      return item;
    },
    [mutate]
  );

  const removeReadingItem = useCallback(
    (id: string) => {
      mutate((current) => ({
        ...current,
        readingItems: current.readingItems.filter((item) => item.id !== id)
      }));
    },
    [mutate]
  );

  const restoreTrashEntry = useCallback(
    (id: string) => {
      let restored = false;
      mutate((current) => {
        const entry = current.trash.find((candidate) => candidate.id === id);
        if (!entry) return current;
        const snapshot = entry.snapshot;
        let next = current;

        if (snapshot.kind === "task") {
          if (current.tasks.some((task) => task.id === snapshot.task.id)) return current;
          const eventIds = new Set(current.events.map((event) => event.id));
          next = {
            ...current,
            tasks: [snapshot.task, ...current.tasks],
            events: [
              ...snapshot.linkedEvents.filter((event) => !eventIds.has(event.id)),
              ...current.events
            ]
          };
        } else if (snapshot.kind === "note") {
          if (current.notes.some((note) => note.id === snapshot.note.id)) return current;
          next = { ...current, notes: [snapshot.note, ...current.notes] };
        } else if (snapshot.kind === "reflection") {
          if (current.reflections.some((reflection) => reflection.id === snapshot.reflection.id)) return current;
          const shouldRestoreNote = snapshot.linkedNote &&
            !current.notes.some((note) => note.id === snapshot.linkedNote?.id);
          next = {
            ...current,
            reflections: [snapshot.reflection, ...current.reflections],
            notes: shouldRestoreNote && snapshot.linkedNote
              ? [snapshot.linkedNote, ...current.notes]
              : current.notes
          };
        } else if (snapshot.kind === "event") {
          if (current.events.some((event) => event.id === snapshot.event.id)) return current;
          next = { ...current, events: [snapshot.event, ...current.events] };
        } else {
          if (current.objectGraph.objects.some((object) => object.id === snapshot.object.id)) return current;
          let objectGraph = addGraphObject(current.objectGraph, {
            ...snapshot.object,
            status: snapshot.object.status === "deleted" ? "active" : snapshot.object.status,
            deletedAt: null
          });
          for (const relation of snapshot.relations) {
            const ids = new Set(objectGraph.objects.map((object) => object.id));
            if (!ids.has(relation.fromId) || !ids.has(relation.toId)) continue;
            try {
              objectGraph = addGraphRelation(objectGraph, relation, { now: relation.createdAt });
            } catch {
              // A relation can remain absent if its other endpoint was removed independently.
            }
          }
          next = {
            ...current,
            objectGraph
          };
        }

        restored = true;
        return {
          ...next,
          trash: current.trash.filter((candidate) => candidate.id !== id),
          activityLog: withActivity(current, "entity_restored", entry.entityId, {
            kind: entry.entityKind
          })
        };
      });
      return restored;
    },
    [mutate]
  );

  const purgeTrashEntry = useCallback(
    (id: string) => {
      mutate((current) => {
        const entry = current.trash.find((candidate) => candidate.id === id);
        if (!entry) return current;
        return {
          ...current,
          trash: current.trash.filter((candidate) => candidate.id !== id),
          activityLog: withActivity(current, "trash_purged", entry.entityId, {
            kind: entry.entityKind
          })
        };
      });
    },
    [mutate]
  );

  const emptyTrash = useCallback(() => {
    mutate((current) => current.trash.length ? { ...current, trash: [] } : current);
  }, [mutate]);

  const restoreRevision = useCallback(
    (id: string) => {
      let restored = false;
      mutate((current) => {
        const revision = current.revisionHistory.find((entry) => entry.id === id);
        if (!revision) return current;
        const now = new Date().toISOString();
        const snapshot = revision.snapshot;

        if (snapshot.kind === "task") {
          const existing = current.tasks.find((task) => task.id === snapshot.task.id);
          if (!existing) return current;
          restored = true;
          return {
            ...current,
            tasks: current.tasks.map((task) => task.id === existing.id ? {
              ...snapshot.task,
              id: existing.id,
              createdAt: existing.createdAt,
              updatedAt: now
            } : task),
            revisionHistory: appendEntityRevision(
              current.revisionHistory,
              createEntityRevision({ kind: "task", task: existing }, now),
              0
            ),
            activityLog: withActivity(current, "revision_restored", existing.id, { kind: "task" })
          };
        }

        if (snapshot.kind === "note") {
          const existing = current.notes.find((note) => note.id === snapshot.note.id);
          if (!existing) return current;
          restored = true;
          return {
            ...current,
            notes: current.notes.map((note) => note.id === existing.id ? {
              ...snapshot.note,
              id: existing.id,
              origin: existing.origin,
              createdAt: existing.createdAt,
              updatedAt: now
            } : note),
            revisionHistory: appendEntityRevision(
              current.revisionHistory,
              createEntityRevision({ kind: "note", note: existing }, now),
              0
            ),
            activityLog: withActivity(current, "revision_restored", existing.id, { kind: "note" })
          };
        }

        if (snapshot.kind === "event") {
          const existing = current.events.find((event) => event.id === snapshot.event.id);
          if (!existing) return current;
          restored = true;
          return {
            ...current,
            events: current.events.map((event) => event.id === existing.id ? {
              ...snapshot.event,
              id: existing.id,
              createdAt: existing.createdAt,
              updatedAt: now
            } : event),
            revisionHistory: appendEntityRevision(
              current.revisionHistory,
              createEntityRevision({ kind: "event", event: existing }, now),
              0
            ),
            activityLog: withActivity(current, "revision_restored", existing.id, { kind: "event" })
          };
        }

        const existing = current.objectGraph.objects.find((object) => object.id === snapshot.object.id);
        if (!existing) return current;
        restored = true;
        return {
          ...current,
          objectGraph: {
            ...current.objectGraph,
            objects: current.objectGraph.objects.map((object) => object.id === existing.id ? {
              ...snapshot.object,
              id: existing.id,
              createdAt: existing.createdAt,
              updatedAt: now,
              revision: existing.revision + 1
            } : object)
          },
          revisionHistory: appendEntityRevision(
            current.revisionHistory,
            createEntityRevision({ kind: "object", object: existing }, now),
            0
          ),
          activityLog: withActivity(current, "revision_restored", existing.id, { kind: "object" })
        };
      });
      return restored;
    },
    [mutate]
  );

  const clearRevisionHistory = useCallback(() => {
    mutate((current) => current.revisionHistory.length ? { ...current, revisionHistory: [] } : current);
  }, [mutate]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      state,
      ready,
      saving,
      storageError,
      addObject,
      updateObject,
      removeObject,
      addObjectRelation,
      removeObjectRelation,
      addTask,
      updateTask,
      toggleTask,
      removeTask,
      addNote,
      updateNote,
      removeNote,
      addReflection,
      ensureReflectionNote,
      markReflectionQueued,
      cancelReflectionRequest,
      applyReflectionAnalysis,
      reviewReflection,
      editReflectionSuggestion,
      decideReflectionSuggestion,
      addReflectionSuggestionToNote,
      createTaskFromReflectionSuggestion,
      removeReflection,
      rememberReflection,
      addAssistantMemory,
      updateAssistantMemory,
      removeAssistantMemory,
      addProject,
      updateProject,
      addLifeArea,
      updateLifeArea,
      moveLifeArea,
      removeLifeArea,
      assignProjectToLifeArea,
      addEvent,
      updateEvent,
      removeEvent,
      confirmPlan,
      updateSettings,
      updatePersonalContext,
      clearPersonalContext,
      updateGoogleIntegration,
      updateObsidianIntegration,
      updateCodexIntegration,
      updateWidgets,
      addReadingItem,
      removeReadingItem,
      restoreTrashEntry,
      purgeTrashEntry,
      emptyTrash,
      restoreRevision,
      clearRevisionHistory,
      replaceState
    }),
    [
      state,
      ready,
      saving,
      storageError,
      addObject,
      updateObject,
      removeObject,
      addObjectRelation,
      removeObjectRelation,
      addTask,
      updateTask,
      toggleTask,
      removeTask,
      addNote,
      updateNote,
      removeNote,
      addReflection,
      ensureReflectionNote,
      markReflectionQueued,
      cancelReflectionRequest,
      applyReflectionAnalysis,
      reviewReflection,
      editReflectionSuggestion,
      decideReflectionSuggestion,
      addReflectionSuggestionToNote,
      createTaskFromReflectionSuggestion,
      removeReflection,
      rememberReflection,
      addAssistantMemory,
      updateAssistantMemory,
      removeAssistantMemory,
      addProject,
      updateProject,
      addLifeArea,
      updateLifeArea,
      moveLifeArea,
      removeLifeArea,
      assignProjectToLifeArea,
      addEvent,
      updateEvent,
      removeEvent,
      confirmPlan,
      updateSettings,
      updatePersonalContext,
      clearPersonalContext,
      updateGoogleIntegration,
      updateObsidianIntegration,
      updateCodexIntegration,
      updateWidgets,
      addReadingItem,
      removeReadingItem,
      restoreTrashEntry,
      purgeTrashEntry,
      emptyTrash,
      restoreRevision,
      clearRevisionHistory,
      replaceState
    ]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("useDashboard должен использоваться внутри DashboardProvider");
  return context;
}
