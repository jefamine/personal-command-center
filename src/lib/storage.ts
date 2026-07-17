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
  installLifeAreaTemplates,
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
import { createEmptyObjectGraph, normalizeObjectGraph } from "../domain/objects/objectGraph";

const DB_NAME = "personal-command-center";
const DB_VERSION = 1;
const STORE_NAME = "app";
const STATE_KEY = "dashboard-state";
const PRE_V13_SAFETY_KEY = "dashboard-state-before-v13";

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
  | "sidebarCollapsed"
  | "lifeAreaTemplatesVersion";
type LegacyAppSettings = Omit<AppSettings, AppearanceSettingKey> &
  Partial<Pick<AppSettings, AppearanceSettingKey>>;

interface LegacyDashboardState {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
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
  const runtimeVersion = (candidate as { version?: unknown }).version;
  if (!Number.isInteger(runtimeVersion) || Number(runtimeVersion) < 1 || Number(runtimeVersion) > 13) {
    throw new Error(`Неподдерживаемая версия локальных данных: ${String(runtimeVersion)}.`);
  }
  if (
    runtimeVersion === 13 &&
    (!isRecord(candidate) || !hasValidV13CanonicalData(candidate))
  ) {
    throw new Error("Локальные данные v13 повреждены: автосохранение остановлено.");
  }
  const lifeModel = normalizeLifeModel(candidate.projects, candidate.lifeAreas);
  const installedTemplateVersion = Number.isInteger(candidate.settings.lifeAreaTemplatesVersion)
    ? Number(candidate.settings.lifeAreaTemplatesVersion)
    : 0;
  const lifeAreas = installedTemplateVersion < 1
    ? installLifeAreaTemplates(lifeModel.lifeAreas, candidate.updatedAt)
    : lifeModel.lifeAreas;
  const settings: AppSettings = {
    ...createDefaultSettings(),
    ...candidate.settings,
    // Stage 13 temporarily ignored this value. Start the restored navigation in its compact mode once.
    sidebarCollapsed: installedTemplateVersion < 1 ? true : candidate.settings.sidebarCollapsed ?? true,
    lifeAreaTemplatesVersion: 1
  };

  if (candidate.version === 13) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      projects: lifeModel.projects,
      lifeAreas,
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      objectGraph: normalizeObjectGraph(candidate.objectGraph)
    };
  }
  if (candidate.version === 12) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      projects: lifeModel.projects,
      lifeAreas,
      events: candidate.events ?? [],
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: createEmptyObjectGraph()
    };
  }
  if (candidate.version === 11) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      projects: lifeModel.projects,
      lifeAreas,
      events: candidate.events ?? [],
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: createEmptyObjectGraph()
    };
  }
  if (candidate.version === 10) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas,
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: createEmptyObjectGraph()
    };
  }
  if (candidate.version === 9) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas,
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: createEmptyObjectGraph()
    };
  }
  if (candidate.version === 8) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas,
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: [],
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: createEmptyObjectGraph()
    };
  }
  if (candidate.version === 7) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is ReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 13,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      projects: lifeModel.projects,
      lifeAreas,
      notes: reflectionNotes.notes,
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      reflections: reflectionNotes.reflections,
      assistantMemory: [],
      personalContext: createDefaultPersonalContext(),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: createEmptyObjectGraph()
    };
  }
  return {
    ...candidate,
    version: 13,
    tasks: candidate.tasks.map((task) => ({
      ...task,
      recurrence: task.recurrence ?? "none",
      generatedFromTaskId: task.generatedFromTaskId ?? null
    })),
    events: candidate.events ?? [],
    projects: lifeModel.projects,
    lifeAreas,
    notes: candidate.notes ?? [],
    reflections: [],
    assistantMemory: [],
    personalContext: createDefaultPersonalContext(),
    settings,
    integrations: mergeIntegrations(candidate.integrations),
    widgets: normalizeWidgets(candidate.widgets, true),
    readingItems: candidate.readingItems ?? [],
    activityLog: candidate.activityLog ?? [],
    objectGraph: createEmptyObjectGraph(),
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
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    let loaded: DashboardState | null = null;
    let failure: unknown = null;
    request.onsuccess = () => {
      const result = request.result as DashboardState | LegacyDashboardState | undefined;
      try {
        loaded = result ? migrateState(result) : null;
      } catch (error) {
        failure = error;
        transaction.abort();
        return;
      }
      const version = result ? Number((result as { version?: unknown }).version) : null;
      if (result && version !== null && version <= 12) {
        const safetyRequest = store.get(PRE_V13_SAFETY_KEY);
        safetyRequest.onsuccess = () => {
          if (safetyRequest.result === undefined) store.put(result, PRE_V13_SAFETY_KEY);
        };
      }
    };
    request.onerror = () => { failure = request.error; };
    transaction.oncomplete = () => {
      database.close();
      resolve(loaded);
    };
    transaction.onerror = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("Не удалось прочитать локальное хранилище."));
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("Чтение локального хранилища отменено."));
    };
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
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Сохранение локального состояния отменено."));
    };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableDateString(value: unknown): boolean {
  return value === null || isValidDateString(value);
}

function isNullableNonEmptyString(value: unknown): boolean {
  return value === null || isNonEmptyString(value);
}

function isFiniteInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasUniqueEntityIds(value: unknown[], predicate: (entry: unknown) => boolean): boolean {
  const ids = new Set<string>();
  return value.every((entry) => {
    if (!predicate(entry) || !isRecord(entry) || !isNonEmptyString(entry.id) || ids.has(entry.id)) {
      return false;
    }
    ids.add(entry.id);
    return true;
  });
}

const taskStatuses = ["inbox", "next", "planned", "waiting", "someday", "done"];
const energyLevels = ["low", "medium", "high"];
const recurrenceRules = ["none", "daily", "weekdays", "weekly", "monthly"];
const projectStatuses = ["active", "paused", "completed"];
const eventKinds = ["meeting", "focus", "personal", "break"];
const eventSources = ["local", "dashboard", "google"];

function isValidTask(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.notes === "string" &&
    taskStatuses.includes(String(value.status)) &&
    isNullableNonEmptyString(value.projectId) &&
    isFiniteInteger(value.priority, 1) && Number(value.priority) <= 4 &&
    isFiniteInteger(value.estimateMinutes, 0) && Number(value.estimateMinutes) <= 24 * 60 &&
    energyLevels.includes(String(value.energy)) &&
    typeof value.context === "string" &&
    isNullableDateString(value.dueDate) &&
    isNullableDateString(value.scheduledDate) &&
    isNullableDateString(value.completedAt) &&
    recurrenceRules.includes(String(value.recurrence)) &&
    isNullableNonEmptyString(value.generatedFromTaskId) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt) &&
    (value.status === "done" ? isValidDateString(value.completedAt) : value.completedAt === null);
}

function isValidProject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    isNullableNonEmptyString(value.areaId) &&
    typeof value.area === "string" &&
    isNonEmptyString(value.color) &&
    projectStatuses.includes(String(value.status)) &&
    isNullableDateString(value.nextReviewAt) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt);
}

function isValidLifeArea(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    isNonEmptyString(value.color) &&
    typeof value.archived === "boolean" &&
    (value.showInTopNavigation === undefined || typeof value.showInTopNavigation === "boolean") &&
    isFiniteInteger(value.order, 0) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt);
}

function isValidCalendarEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isValidDateString(value.startAt) &&
    isValidDateString(value.endAt) &&
    Date.parse(value.endAt) >= Date.parse(value.startAt) &&
    eventKinds.includes(String(value.kind)) &&
    eventSources.includes(String(value.source)) &&
    isNullableNonEmptyString(value.taskId) &&
    typeof value.notes === "string" &&
    typeof value.locked === "boolean" &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt);
}

function isValidNote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.body === "string" &&
    isNullableNonEmptyString(value.projectId) &&
    isStringArray(value.tags) &&
    typeof value.pinned === "boolean" &&
    (value.origin === undefined || value.origin === "reflection") &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt);
}

function isValidReflectionAnalysis(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.responseId) &&
    isNonEmptyString(value.requestId) &&
    typeof value.understanding === "string" &&
    isStringArray(value.observations) &&
    typeof value.possibleExplanation === "string" &&
    isStringArray(value.alternatives) &&
    typeof value.question === "string" &&
    typeof value.proposedAction === "string" &&
    value.source === "codex" &&
    isValidDateString(value.generatedAt);
}

function isValidReflection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const status = value.status as ReflectionStatus;
  const analysis = value.analysis === null ? null : value.analysis;
  const memoryReferences = normalizeReflectionMemoryReferences(value.analysisMemoryRefs);
  const suggestions = analysis && isRecord(analysis) && isNonEmptyString(analysis.responseId)
    ? normalizeReflectionSuggestions(value.suggestions, analysis.responseId)
    : Array.isArray(value.suggestions) && value.suggestions.length === 0 ? [] : null;
  const contextSections = value.analysisContextSections;
  const hasValidContextSections = Array.isArray(contextSections) &&
    contextSections.every((section) => personalContextSections.includes(section as PersonalContextSectionId)) &&
    new Set(contextSections).size === contextSections.length;
  const requiresAnalysis = ["analyzed", "confirmed", "corrected"].includes(status);

  return isNonEmptyString(value.id) &&
    isNullableNonEmptyString(value.noteId) &&
    typeof value.originalText === "string" &&
    reflectionStatuses.includes(status) &&
    (analysis === null || isValidReflectionAnalysis(analysis)) &&
    (!requiresAnalysis || analysis !== null) &&
    (status !== "corrected" || (typeof value.correction === "string" && Boolean(value.correction.trim()))) &&
    (value.correction === null || typeof value.correction === "string") &&
    isNullableNonEmptyString(value.analysisRequestId) &&
    isNullableNonEmptyString(value.analysisRequestDigest) &&
    isNullableDateString(value.analysisRequestedAt) &&
    isNullableDateString(value.analysisSourceUpdatedAt) &&
    hasValidContextSections &&
    isNullableDateString(value.analysisProfileUpdatedAt) &&
    memoryReferences !== null &&
    suggestions !== null &&
    (status !== "queued" || (
      isNonEmptyString(value.analysisRequestId) &&
      isNonEmptyString(value.analysisRequestDigest) &&
      isValidDateString(value.analysisSourceUpdatedAt)
    )) &&
    ((status !== "captured" && status !== "queued" && analysis !== null) ||
      (Array.isArray(value.suggestions) && value.suggestions.length === 0)) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt) &&
    isNullableDateString(value.confirmedAt);
}

function isValidAssistantMemoryItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const reflectionSource = value.sourceType === "reflection";
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.text) &&
    assistantMemorySourceTypes.includes(value.sourceType as AssistantMemoryItem["sourceType"]) &&
    assistantMemoryStatuses.includes(value.status as AssistantMemoryItem["status"]) &&
    (reflectionSource ? isNonEmptyString(value.sourceId) : value.sourceId === null) &&
    (reflectionSource ? isValidDateString(value.sourceUpdatedAt) : value.sourceUpdatedAt === null) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt);
}

const svpModes = ["off", "plain", "systemic"];
const svpVectors = ["skin", "anal", "muscular", "urethral", "visual", "sound", "oral", "olfactory"];

function isValidPersonalContext(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.systemProfile)) return false;
  const vectors = value.systemProfile.selfDeclaredVectors;
  return typeof value.goals === "string" &&
    typeof value.rhythms === "string" &&
    typeof value.preferences === "string" &&
    typeof value.boundaries === "string" &&
    svpModes.includes(String(value.systemProfile.mode)) &&
    Array.isArray(vectors) &&
    vectors.every((vector) => svpVectors.includes(String(vector))) &&
    new Set(vectors).size === vectors.length &&
    typeof value.systemProfile.manifestations === "string" &&
    typeof value.systemProfile.combinationNotes === "string" &&
    isNullableDateString(value.updatedAt);
}

function isValidAppSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const time = (entry: unknown) => typeof entry === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry);
  return typeof value.userName === "string" &&
    time(value.workdayStart) && time(value.workdayEnd) &&
    isFiniteInteger(value.dailyCapacityMinutes, 0) && Number(value.dailyCapacityMinutes) <= 24 * 60 &&
    isFiniteInteger(value.focusBlockMinutes, 1) && Number(value.focusBlockMinutes) <= 24 * 60 &&
    isFiniteInteger(value.bufferMinutes, 0) && Number(value.bufferMinutes) <= 24 * 60 &&
    energyLevels.includes(String(value.currentEnergy)) &&
    ["light", "dark", "system"].includes(String(value.theme)) &&
    ["lime", "violet", "ocean", "coral", "rose", "custom"].includes(String(value.accentPreset)) &&
    isNonEmptyString(value.accentColor) &&
    isNonEmptyString(value.secondaryColor) &&
    ["warm", "cool", "neutral"].includes(String(value.surfaceTone)) &&
    ["soft", "glass", "contrast"].includes(String(value.visualStyle)) &&
    ["comfortable", "compact"].includes(String(value.density)) &&
    ["rounded", "balanced", "crisp"].includes(String(value.cornerStyle)) &&
    ["normal", "large", "xlarge"].includes(String(value.fontScale)) &&
    typeof value.sidebarCollapsed === "boolean" &&
    (value.lifeAreaTemplatesVersion === undefined || isFiniteInteger(value.lifeAreaTemplatesVersion, 0));
}

function isValidIntegrations(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.google) || !isRecord(value.obsidian) || !isRecord(value.codex)) {
    return false;
  }
  const google = value.google;
  const obsidian = value.obsidian;
  const codex = value.codex;
  const scope = codex.snapshotScope;
  const integrationStatuses = ["disconnected", "configured", "connected", "error"];
  const validScope = isRecord(scope) && ["tasks", "projects", "calendar", "notes", "journal", "reading"]
    .every((key) => typeof scope[key] === "boolean");
  return typeof google.enabled === "boolean" &&
    integrationStatuses.includes(String(google.status)) &&
    typeof google.calendarEnabled === "boolean" &&
    typeof google.tasksEnabled === "boolean" &&
    isFiniteInteger(google.syncIntervalMinutes, 1) &&
    typeof google.readAllCalendars === "boolean" &&
    typeof google.focusCalendarName === "string" &&
    typeof google.writeFocusBlocks === "boolean" &&
    typeof google.tasksListName === "string" &&
    ["inbox", "two-way"].includes(String(google.tasksMode)) &&
    ["latest", "dashboard"].includes(String(google.conflictPolicy)) &&
    isNullableDateString(google.lastSyncAt) &&
    typeof obsidian.enabled === "boolean" &&
    typeof obsidian.vaultPath === "string" &&
    typeof obsidian.folder === "string" &&
    typeof obsidian.includeFrontmatter === "boolean" &&
    ["manual", "mirror"].includes(String(obsidian.mode)) &&
    isNullableDateString(obsidian.lastExportAt) &&
    typeof codex.enabled === "boolean" &&
    ["confirm", "trusted"].includes(String(codex.permissionMode)) &&
    typeof codex.allowCreateTasks === "boolean" &&
    typeof codex.allowUpdateTasks === "boolean" &&
    typeof codex.allowCompleteTasks === "boolean" &&
    typeof codex.allowNotes === "boolean" &&
    typeof codex.allowReading === "boolean" &&
    validScope &&
    isNullableDateString(codex.lastSnapshotAt) &&
    isNullableDateString(codex.lastCommandImportAt);
}

const widgetTypes = ["overview", "focus", "reflection", "plan", "inbox", "weather", "recommendations", "reading", "custom"];
const widgetSizes = ["full", "two-thirds", "half", "third"];
const widgetVariants = ["note", "link", "image", "metric", "file", "api"];
const widgetConfigStringKeys = new Set([
  "city", "description", "body", "linkUrl", "linkLabel", "imageUrl", "imageAlt",
  "metricValue", "metricUnit", "fileUrl", "fileName", "apiUrl", "apiPath"
]);

function isValidWidgetConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => {
    if (widgetConfigStringKeys.has(key)) return typeof entry === "string";
    if (key === "latitude" || key === "longitude") return typeof entry === "number" && Number.isFinite(entry);
    if (key === "variant") return widgetVariants.includes(String(entry));
    return false;
  });
}

function isValidWidget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    widgetTypes.includes(String(value.type)) &&
    typeof value.title === "string" &&
    typeof value.enabled === "boolean" &&
    widgetSizes.includes(String(value.size)) &&
    (value.gridWidth === undefined || (isFiniteInteger(value.gridWidth, 1) && Number(value.gridWidth) <= 12)) &&
    (value.gridHeight === undefined || (isFiniteInteger(value.gridHeight, 1) && Number(value.gridHeight) <= 14)) &&
    isFiniteInteger(value.order, 0) &&
    isValidWidgetConfig(value.config);
}

function isValidReadingItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.summary === "string" &&
    typeof value.body === "string" &&
    typeof value.url === "string" &&
    typeof value.source === "string" &&
    isStringArray(value.tags) &&
    isValidDateString(value.createdAt);
}

const activityTypes = [
  "task_created", "task_completed", "task_reopened", "plan_confirmed", "note_created",
  "reflection_created", "reflection_queued", "reflection_queue_cancelled", "reflection_analyzed",
  "reflection_confirmed", "reflection_corrected", "reflection_ignored", "reflection_note_created",
  "reflection_suggestion_edited", "reflection_suggestion_decided", "reflection_suggestion_note_applied",
  "reflection_suggestion_task_created", "memory_created", "memory_updated", "memory_paused",
  "memory_resumed", "memory_removed", "life_area_created", "life_area_updated", "life_area_removed",
  "project_area_changed", "object_created", "object_updated", "object_relation_added", "object_relation_removed"
];

function isValidActivityEntry(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  const validMetadata = Object.values(value.metadata).every((entry) =>
    entry === null || typeof entry === "string" || typeof entry === "boolean" ||
    (typeof entry === "number" && Number.isFinite(entry))
  );
  return isNonEmptyString(value.id) &&
    activityTypes.includes(String(value.type)) &&
    (value.entityId === null || typeof value.entityId === "string") &&
    isValidDateString(value.timestamp) &&
    validMetadata;
}

function hasValidV13CanonicalData(candidate: Record<string, unknown>): boolean {
  if (
    candidate.version !== 13 ||
    !Array.isArray(candidate.tasks) || !hasUniqueEntityIds(candidate.tasks, isValidTask) ||
    !Array.isArray(candidate.projects) || !hasUniqueEntityIds(candidate.projects, isValidProject) ||
    !Array.isArray(candidate.lifeAreas) || !hasUniqueEntityIds(candidate.lifeAreas, isValidLifeArea) ||
    !Array.isArray(candidate.events) || !hasUniqueEntityIds(candidate.events, isValidCalendarEvent) ||
    !Array.isArray(candidate.notes) || !hasUniqueEntityIds(candidate.notes, isValidNote) ||
    !Array.isArray(candidate.reflections) || !hasUniqueEntityIds(candidate.reflections, isValidReflection) ||
    !Array.isArray(candidate.assistantMemory) || !hasUniqueEntityIds(candidate.assistantMemory, isValidAssistantMemoryItem) ||
    !isValidPersonalContext(candidate.personalContext) ||
    !isValidAppSettings(candidate.settings) ||
    !isValidIntegrations(candidate.integrations) ||
    !Array.isArray(candidate.widgets) || !hasUniqueEntityIds(candidate.widgets, isValidWidget) ||
    !Array.isArray(candidate.readingItems) || !hasUniqueEntityIds(candidate.readingItems, isValidReadingItem) ||
    !Array.isArray(candidate.activityLog) || !hasUniqueEntityIds(candidate.activityLog, isValidActivityEntry) ||
    !isValidDateString(candidate.updatedAt)
  ) return false;

  const areaIds = new Set(candidate.lifeAreas.map((area) => (area as { id: string }).id));
  if (candidate.projects.some((project) => {
    const areaId = (project as { areaId: string | null }).areaId;
    return areaId !== null && !areaIds.has(areaId);
  })) return false;

  return true;
}

function isValidV13Backup(candidate: Record<string, unknown>): boolean {
  if (!hasValidV13CanonicalData(candidate)) return false;

  try {
    normalizeObjectGraph(candidate.objectGraph);
  } catch {
    return false;
  }
  return true;
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
    objectGraph?: unknown;
    updatedAt?: unknown;
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
      candidate.version !== 12 &&
      candidate.version !== 13) ||
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
    (candidate.version >= 12 && !Array.isArray(candidate.lifeAreas)) ||
    (candidate.version === 13 && !candidate.objectGraph) ||
    !candidate.settings ||
    (candidate.version === 13 && !isValidV13Backup(candidate as Record<string, unknown>))
  ) {
    throw new Error("Файл не похож на резервную копию командного центра.");
  }
  return migrateState(candidate as unknown as DashboardState | LegacyDashboardState);
}
