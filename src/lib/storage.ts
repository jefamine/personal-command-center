import type {
  AppSettings,
  AssistantMemoryItem,
  CalendarEvent,
  CodexIntegrationSettings,
  CodexSnapshotScope,
  DashboardState,
  DashboardWidget,
  GoogleIntegrationSettings,
  Note,
  ObsidianIntegrationSettings,
  PersonalContextSectionId,
  ReflectionAnalysis,
  ReflectionEntry,
  ReflectionStatus,
  Task
} from "../types";
import {
  normalizeLifeModel,
  type LegacyProjectWithOptionalAreaId
} from "../domain/life/lifeAreas";
import { createDefaultIntegrations } from "../data/integrations";
import { createDefaultSettings } from "../data/settings";
import { createDefaultWidgets } from "../data/widgets";
import {
  createDefaultPersonalContext,
  normalizePersonalContext
} from "../domain/profile/personalContext";
import { createReflectionNote } from "../domain/reflections/reflectionNote";
import { normalizeReflectionMemoryReferences } from "../domain/reflections/reflectionMemory";
import { normalizeReflectionSuggestions } from "../domain/reflections/reflectionSuggestions";
import { normalizeWidgetLayout } from "./widgetLayout";

const DB_NAME = "personal-command-center";
const DB_VERSION = 1;
const STORE_NAME = "app";
const STATE_KEY = "dashboard-state";

type LegacyTask = Omit<Task, "recurrence" | "generatedFromTaskId"> &
  Partial<Pick<Task, "recurrence" | "generatedFromTaskId">>;

type AppearanceSettingKey =
  | "accentPreset"
  | "accentColor"
  | "secondaryColor"
  | "surfaceTone"
  | "visualStyle"
  | "density"
  | "cornerStyle"
  | "fontScale"
  | "sidebarCollapsed";
type LegacyAppSettings = Omit<AppSettings, AppearanceSettingKey> &
  Partial<Pick<AppSettings, AppearanceSettingKey>>;

interface LegacyDashboardState {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  tasks: LegacyTask[];
  projects: LegacyProjectWithOptionalAreaId[];
  lifeAreas?: unknown;
  events?: CalendarEvent[];
  notes?: Note[];
  settings: LegacyAppSettings;
  integrations?: {
    google?: Partial<GoogleIntegrationSettings>;
    obsidian?: Partial<ObsidianIntegrationSettings>;
    codex?: Omit<Partial<CodexIntegrationSettings>, "snapshotScope"> & {
      snapshotScope?: Partial<CodexSnapshotScope>;
    };
  };
  widgets?: DashboardState["widgets"];
  readingItems?: DashboardState["readingItems"];
  activityLog?: DashboardState["activityLog"];
  reflections?: unknown[];
  assistantMemory?: unknown[];
  personalContext?: unknown;
  updatedAt: string;
}

const reflectionStatuses: ReflectionStatus[] = [
  "captured",
  "queued",
  "analyzed",
  "confirmed",
  "corrected",
  "ignored"
];

const personalContextSections: PersonalContextSectionId[] = [
  "goals",
  "rhythms",
  "preferences",
  "boundaries",
  "systemProfile"
];

const assistantMemorySourceTypes: AssistantMemoryItem["sourceType"][] = [
  "reflection",
  "manual"
];
const assistantMemoryStatuses: AssistantMemoryItem["status"][] = ["active", "paused"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isValidDateString(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function normalizeAssistantMemoryItem(value: unknown): AssistantMemoryItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AssistantMemoryItem>;
  if (
    !isNonEmptyString(item.id) ||
    !isNonEmptyString(item.text) ||
    !assistantMemorySourceTypes.includes(item.sourceType as AssistantMemoryItem["sourceType"]) ||
    !assistantMemoryStatuses.includes(item.status as AssistantMemoryItem["status"]) ||
    !isValidDateString(item.createdAt) ||
    !isValidDateString(item.updatedAt) ||
    (item.sourceId !== null && typeof item.sourceId !== "string") ||
    (item.sourceUpdatedAt !== null && !isValidDateString(item.sourceUpdatedAt))
  ) {
    return null;
  }

  const sourceType = item.sourceType as AssistantMemoryItem["sourceType"];
  if (sourceType === "reflection" && !isNonEmptyString(item.sourceId)) return null;

  return {
    id: item.id,
    text: item.text,
    sourceType,
    sourceId: sourceType === "reflection" && isNonEmptyString(item.sourceId) ? item.sourceId : null,
    sourceUpdatedAt: sourceType === "reflection" && isNonEmptyString(item.sourceUpdatedAt)
      ? item.sourceUpdatedAt
      : null,
    status: item.status as AssistantMemoryItem["status"],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function normalizeAssistantMemory(value: unknown): AssistantMemoryItem[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value
    .map(normalizeAssistantMemoryItem)
    .filter((item): item is AssistantMemoryItem => {
      if (!item || seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });
}

function normalizeReflectionAnalysis(value: unknown): ReflectionAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const analysis = value as Partial<ReflectionAnalysis>;
  if (
    typeof analysis.responseId !== "string" ||
    typeof analysis.requestId !== "string" ||
    typeof analysis.understanding !== "string" ||
    typeof analysis.possibleExplanation !== "string" ||
    typeof analysis.question !== "string" ||
    typeof analysis.proposedAction !== "string" ||
    typeof analysis.generatedAt !== "string"
  ) {
    return null;
  }
  return {
    responseId: analysis.responseId,
    requestId: analysis.requestId,
    understanding: analysis.understanding,
    observations: Array.isArray(analysis.observations)
      ? analysis.observations.filter((entry): entry is string => typeof entry === "string")
      : [],
    possibleExplanation: analysis.possibleExplanation,
    alternatives: Array.isArray(analysis.alternatives)
      ? analysis.alternatives.filter((entry): entry is string => typeof entry === "string")
      : [],
    question: analysis.question,
    proposedAction: analysis.proposedAction,
    source: "codex",
    generatedAt: analysis.generatedAt
  };
}

function normalizeReflection(
  value: unknown,
  supportsMemoryReferences = false,
  supportsSuggestions = false
): ReflectionEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<ReflectionEntry>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.originalText !== "string" ||
    typeof entry.createdAt !== "string" ||
    typeof entry.updatedAt !== "string"
  ) {
    return null;
  }

  const analysis = normalizeReflectionAnalysis(entry.analysis);
  let status = reflectionStatuses.includes(entry.status as ReflectionStatus)
    ? entry.status as ReflectionStatus
    : analysis
      ? "analyzed"
      : "captured";
  const analysisRequestId = typeof entry.analysisRequestId === "string"
    ? entry.analysisRequestId
    : null;
  const analysisRequestedAt = typeof entry.analysisRequestedAt === "string"
    ? entry.analysisRequestedAt
    : null;
  const analysisSourceUpdatedAt = typeof entry.analysisSourceUpdatedAt === "string"
    ? entry.analysisSourceUpdatedAt
    : null;
  const analysisRequestDigest = typeof entry.analysisRequestDigest === "string"
    ? entry.analysisRequestDigest
    : null;
  const analysisContextSections = Array.isArray(entry.analysisContextSections)
    ? entry.analysisContextSections.filter(
        (section, index, sections): section is PersonalContextSectionId =>
          personalContextSections.includes(section as PersonalContextSectionId) &&
          sections.indexOf(section) === index
      )
    : [];
  const analysisProfileUpdatedAt = typeof entry.analysisProfileUpdatedAt === "string"
    ? entry.analysisProfileUpdatedAt
    : null;
  const rawAnalysisMemoryRefs = (entry as Partial<ReflectionEntry>).analysisMemoryRefs;
  const normalizedMemoryRefs = supportsMemoryReferences
    ? normalizeReflectionMemoryReferences(rawAnalysisMemoryRefs)
    : [];
  const memoryRefsMalformed = supportsMemoryReferences && normalizedMemoryRefs === null;
  let analysisMemoryRefs = normalizedMemoryRefs ?? [];
  const correction = typeof entry.correction === "string" ? entry.correction : null;
  const normalizedSuggestions = supportsSuggestions && analysis
    ? normalizeReflectionSuggestions(entry.suggestions, analysis.responseId)
    : [];
  let suggestions = normalizedSuggestions ?? [];

  if (
    status === "queued" &&
    (!analysisRequestId || !analysisSourceUpdatedAt || !analysisRequestDigest || memoryRefsMalformed)
  ) status = "captured";
  if (["analyzed", "confirmed", "corrected"].includes(status) && !analysis) status = "captured";
  if (status === "corrected" && !correction?.trim()) status = "analyzed";
  if (status === "captured") analysisMemoryRefs = [];
  if (status === "captured" || status === "queued" || !analysis) suggestions = [];

  return {
    id: entry.id,
    noteId: isNonEmptyString(entry.noteId) ? entry.noteId : null,
    originalText: entry.originalText,
    status,
    analysis,
    correction,
    analysisRequestId,
    analysisRequestDigest,
    analysisRequestedAt,
    analysisSourceUpdatedAt,
    analysisContextSections,
    analysisProfileUpdatedAt,
    analysisMemoryRefs,
    suggestions,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    confirmedAt:
      (status === "confirmed" || status === "corrected") &&
      typeof entry.confirmedAt === "string"
        ? entry.confirmedAt
        : null
  };
}

function stableStringHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function reflectionNoteId(reflectionId: string): string {
  const sanitized = reflectionId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return `reflection-note-${sanitized || `entry-${stableStringHash(reflectionId)}`}`;
}

function backfillReflectionNotes(
  notes: Note[],
  reflections: ReflectionEntry[]
): { notes: Note[]; reflections: ReflectionEntry[] } {
  const migratedNotes = [...notes];
  const noteIds = new Set(
    migratedNotes
      .filter((note) => note && isNonEmptyString(note.id))
      .map((note) => note.id)
  );
  const noteIndexes = new Map(
    migratedNotes.map((note, index) => [note.id, index] as const)
  );

  const markReflectionOrigin = (noteId: string) => {
    const index = noteIndexes.get(noteId);
    if (index === undefined || migratedNotes[index].origin === "reflection") return;
    migratedNotes[index] = { ...migratedNotes[index], origin: "reflection" };
  };

  const migratedReflections = reflections.map((reflection) => {
    if (reflection.noteId && noteIds.has(reflection.noteId)) {
      markReflectionOrigin(reflection.noteId);
      return reflection;
    }

    const baseNoteId = reflectionNoteId(reflection.id);
    let noteId = baseNoteId;
    let suffix = 2;
    while (noteIds.has(noteId)) {
      noteId = `${baseNoteId}-${suffix}`;
      suffix += 1;
    }
    migratedNotes.push({
      ...createReflectionNote(reflection, noteId),
      updatedAt: reflection.updatedAt
    });
    noteIds.add(noteId);
    noteIndexes.set(noteId, migratedNotes.length - 1);

    return {
      ...reflection,
      noteId,
      suggestions: reflection.suggestions.map((suggestion) =>
        suggestion.addedToNoteAt
          ? { ...suggestion, addedToNoteAt: null }
          : suggestion
      )
    };
  });

  return { notes: migratedNotes, reflections: migratedReflections };
}

function mergeIntegrations(
  integrations?: DashboardState["integrations"] | LegacyDashboardState["integrations"]
): DashboardState["integrations"] {
  const defaults = createDefaultIntegrations();
  return {
    google: { ...defaults.google, ...integrations?.google },
    obsidian: { ...defaults.obsidian, ...integrations?.obsidian },
    codex: {
      ...defaults.codex,
      ...integrations?.codex,
      snapshotScope: {
        ...defaults.codex.snapshotScope,
        ...integrations?.codex?.snapshotScope
      }
    }
  };
}

function normalizeWidgets(
  widgets: DashboardWidget[] | undefined,
  disableLegacyRecommendations: boolean
): DashboardWidget[] {
  const normalized = (widgets ?? createDefaultWidgets())
    .map(normalizeWidgetLayout)
    .sort((left, right) => left.order - right.order)
    .map((widget) =>
      disableLegacyRecommendations && widget.type === "recommendations"
        ? { ...widget, enabled: false }
        : widget
    );

  if (!normalized.some((widget) => widget.type === "reflection")) {
    const reflection = createDefaultWidgets().find((widget) => widget.type === "reflection");
    if (reflection) {
      const recommendationIndex = normalized.findIndex(
        (widget) => widget.type === "recommendations"
      );
      normalized.splice(
        recommendationIndex >= 0 ? recommendationIndex : Math.min(2, normalized.length),
        0,
        reflection
      );
    }
  }

  return normalized.map((widget, order) => ({ ...widget, order }));
}

export function migrateState(candidate: DashboardState | LegacyDashboardState): DashboardState {
  const lifeModel = normalizeLifeModel(candidate.projects, candidate.lifeAreas);

  if (candidate.version === 12) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 12,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      settings: { ...createDefaultSettings(), ...candidate.settings },
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      projects: lifeModel.projects,
      lifeAreas: lifeModel.lifeAreas,
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext)
    };
  }
  if (candidate.version === 11) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 12,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      projects: lifeModel.projects,
      lifeAreas: lifeModel.lifeAreas,
      events: candidate.events ?? [],
      settings: { ...createDefaultSettings(), ...candidate.settings },
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? []
    };
  }
  if (candidate.version === 10) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 12,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas: lifeModel.lifeAreas,
      settings: { ...createDefaultSettings(), ...candidate.settings },
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? []
    };
  }
  if (candidate.version === 9) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 12,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas: lifeModel.lifeAreas,
      settings: { ...createDefaultSettings(), ...candidate.settings },
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? []
    };
  }
  if (candidate.version === 8) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 12,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas: lifeModel.lifeAreas,
      settings: { ...createDefaultSettings(), ...candidate.settings },
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: [],
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? []
    };
  }
  if (candidate.version === 7) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 12,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas: lifeModel.lifeAreas,
      notes: reflectionNotes.notes,
      settings: { ...createDefaultSettings(), ...candidate.settings },
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      reflections: reflectionNotes.reflections,
      assistantMemory: [],
      personalContext: createDefaultPersonalContext(),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? []
    };
  }
  return {
    ...candidate,
    version: 12,
    tasks: candidate.tasks.map((task) => ({
      ...task,
      recurrence: task.recurrence ?? "none",
      generatedFromTaskId: task.generatedFromTaskId ?? null
    })),
    events: candidate.events ?? [],
    projects: lifeModel.projects,
    lifeAreas: lifeModel.lifeAreas,
    notes: candidate.notes ?? [],
    reflections: [],
    assistantMemory: [],
    personalContext: createDefaultPersonalContext(),
    settings: { ...createDefaultSettings(), ...candidate.settings },
    integrations: mergeIntegrations(candidate.integrations),
    widgets: normalizeWidgets(candidate.widgets, true),
    readingItems: candidate.readingItems ?? [],
    activityLog: candidate.activityLog ?? [],
    updatedAt: new Date().toISOString()
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadState(): Promise<DashboardState | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      const result = request.result as DashboardState | LegacyDashboardState | undefined;
      resolve(result ? migrateState(result) : null);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveState(state: DashboardState): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export function downloadBackup(state: DashboardState): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `command-center-backup-${date}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadMarkdownExport(state: DashboardState): void {
  const date = new Date().toISOString().slice(0, 10);
  const openTasks = state.tasks.filter((task) => task.status !== "done");
  const sections = [
    "# Личный командный центр",
    `Экспорт: ${date}`,
    "",
    "## Открытые задачи",
    ...openTasks.map((task) => {
      const project = state.projects.find((entry) => entry.id === task.projectId);
      const metadata = [
        project ? `проект: ${project.title}` : "",
        task.dueDate ? `срок: ${task.dueDate}` : "",
        `${task.estimateMinutes} мин`
      ].filter(Boolean).join(" · ");
      return `- [ ] ${task.title}${metadata ? ` — ${metadata}` : ""}`;
    }),
    "",
    "## Проекты",
    ...state.projects.map((project) => `### ${project.title}\n\n${project.description || "Без описания."}`),
    "",
    "## Заметки",
    ...state.notes.map((note) => `### ${note.title}\n\n${note.body || ""}`),
    ""
  ];
  const blob = new Blob([sections.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `command-center-${date}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function reflectionsHaveSuggestionArrays(value: unknown): boolean {
  return Array.isArray(value) && value.every(
    (entry) => Boolean(entry) && typeof entry === "object" && Array.isArray(
      (entry as { suggestions?: unknown }).suggestions
    )
  );
}

export async function readBackup(file: File): Promise<DashboardState> {
  const content = await file.text();
  const candidate = JSON.parse(content) as {
    version?: number;
    tasks?: unknown;
    projects?: unknown;
    lifeAreas?: unknown;
    events?: unknown;
    notes?: unknown;
    settings?: unknown;
    integrations?: unknown;
    widgets?: unknown;
    readingItems?: unknown;
    activityLog?: unknown;
    reflections?: unknown;
    assistantMemory?: unknown;
    personalContext?: unknown;
  };
  if (
    (candidate.version !== 1 &&
      candidate.version !== 2 &&
      candidate.version !== 3 &&
      candidate.version !== 4 &&
      candidate.version !== 5 &&
      candidate.version !== 6 &&
      candidate.version !== 7 &&
      candidate.version !== 8 &&
      candidate.version !== 9 &&
      candidate.version !== 10 &&
      candidate.version !== 11 &&
      candidate.version !== 12) ||
    !Array.isArray(candidate.tasks) ||
    !Array.isArray(candidate.projects) ||
    (candidate.version >= 2 && !Array.isArray(candidate.events)) ||
    (candidate.version >= 3 && !Array.isArray(candidate.notes)) ||
    (candidate.version >= 4 && !candidate.integrations) ||
    (candidate.version >= 6 &&
      (!Array.isArray(candidate.widgets) ||
        !Array.isArray(candidate.readingItems) ||
        !Array.isArray(candidate.activityLog))) ||
    (candidate.version >= 7 &&
      !Array.isArray(candidate.reflections)) ||
    (candidate.version >= 8 && !candidate.personalContext) ||
    (candidate.version >= 9 && !Array.isArray(candidate.assistantMemory)) ||
    (candidate.version >= 11 && !reflectionsHaveSuggestionArrays(candidate.reflections)) ||
    (candidate.version === 12 && !Array.isArray(candidate.lifeAreas)) ||
    !candidate.settings
  ) {
    throw new Error("Файл не похож на резервную копию командного центра.");
  }
  return migrateState(candidate as unknown as DashboardState | LegacyDashboardState);
}
