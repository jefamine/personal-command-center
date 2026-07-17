import type {
  AppSettings,
  AssistantMemoryItem,
  CalendarEvent,
  CodexIntegrationSettings,
  CodexSnapshotScope,
  DashboardState,
  DashboardWidget,
  EntityRevision,
  GoogleIntegrationSettings,
  Note,
  ObsidianIntegrationSettings,
  PersonalContextSectionId,
  ReflectionAnalysis,
  ReflectionMetadata,
  ReflectionStatus,
  Task,
  TrashEntry
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
const PRE_V15_SAFETY_KEY = "dashboard-state-before-v15";
const AUTO_BACKUP_INDEX_KEY = "dashboard-auto-backup-index";
const AUTO_BACKUP_PREFIX = "dashboard-auto-backup:";
const AUTO_BACKUP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_AUTO_BACKUPS = 5;

export interface AutomaticBackupSummary {
  key: string;
  createdAt: string;
  stateUpdatedAt: string;
}

type LegacyTask = Omit<Task, "recurrence" | "generatedFromTaskId"> &
  Partial<Pick<Task, "recurrence" | "generatedFromTaskId">>;
type LegacyNote = Omit<Note, "contentUpdatedAt" | "reflection"> &
  Partial<Pick<Note, "contentUpdatedAt" | "reflection">>;

interface LegacyReflectionEntry {
  id: string;
  noteId: string | null;
  originalText: string;
  status: ReflectionStatus;
  analysis: ReflectionAnalysis | null;
  correction: string | null;
  analysisRequestId: string | null;
  analysisRequestDigest: string | null;
  analysisRequestedAt: string | null;
  analysisSourceUpdatedAt: string | null;
  analysisContextSections: PersonalContextSectionId[];
  analysisProfileUpdatedAt: string | null;
  analysisMemoryRefs: ReflectionMetadata["analysisMemoryRefs"];
  suggestions: ReflectionMetadata["suggestions"];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

type LegacyAssistantMemoryItem = Omit<AssistantMemoryItem, "sourceType"> & {
  sourceType: "reflection" | "document" | "manual";
};

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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  tasks: LegacyTask[];
  projects: LegacyProjectWithOptionalAreaId[];
  lifeAreas?: unknown;
  events?: CalendarEvent[];
  notes?: LegacyNote[];
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
  objectGraph?: unknown;
  trash?: unknown;
  revisionHistory?: unknown;
  updatedAt: string;
}

interface DashboardStateV14 extends Omit<
  DashboardState,
  "version" | "notes" | "assistantMemory" | "trash" | "revisionHistory"
> {
  version: 14;
  notes: LegacyNote[];
  reflections: LegacyReflectionEntry[];
  assistantMemory: LegacyAssistantMemoryItem[];
  trash: unknown[];
  revisionHistory: unknown[];
}

type MigrationCandidate = DashboardState | DashboardStateV14 | LegacyDashboardState;

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

const legacyAssistantMemorySourceTypes: LegacyAssistantMemoryItem["sourceType"][] = [
  "reflection",
  "document",
  "manual"
];
const assistantMemoryStatuses: AssistantMemoryItem["status"][] = ["active", "paused"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isValidDateString(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function normalizeAssistantMemoryItem(value: unknown): LegacyAssistantMemoryItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<LegacyAssistantMemoryItem>;
  if (
    !isNonEmptyString(item.id) ||
    !isNonEmptyString(item.text) ||
    !legacyAssistantMemorySourceTypes.includes(item.sourceType as LegacyAssistantMemoryItem["sourceType"]) ||
    !assistantMemoryStatuses.includes(item.status as AssistantMemoryItem["status"]) ||
    !isValidDateString(item.createdAt) ||
    !isValidDateString(item.updatedAt) ||
    (item.sourceId !== null && typeof item.sourceId !== "string") ||
    (item.sourceUpdatedAt !== null && !isValidDateString(item.sourceUpdatedAt))
  ) {
    return null;
  }

  const sourceType = item.sourceType as LegacyAssistantMemoryItem["sourceType"];
  if ((sourceType === "reflection" || sourceType === "document") && !isNonEmptyString(item.sourceId)) {
    return null;
  }

  return {
    id: item.id,
    text: item.text,
    sourceType,
    sourceId: sourceType !== "manual" && isNonEmptyString(item.sourceId) ? item.sourceId : null,
    sourceUpdatedAt: sourceType !== "manual" && isNonEmptyString(item.sourceUpdatedAt)
      ? item.sourceUpdatedAt
      : null,
    status: item.status as AssistantMemoryItem["status"],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function normalizeAssistantMemory(value: unknown): LegacyAssistantMemoryItem[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value
    .map(normalizeAssistantMemoryItem)
    .filter((item): item is LegacyAssistantMemoryItem => {
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
): LegacyReflectionEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<LegacyReflectionEntry>;
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
  const rawAnalysisMemoryRefs = entry.analysisMemoryRefs;
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
  notes: LegacyNote[],
  reflections: LegacyReflectionEntry[]
): { notes: LegacyNote[]; reflections: LegacyReflectionEntry[] } {
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
      ...createReflectionNote(reflection.originalText, noteId, reflection.createdAt),
      reflection: undefined,
      contentUpdatedAt: undefined,
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

function reflectionMetadataFromLegacy(
  reflection: LegacyReflectionEntry,
  documentBody: string
): ReflectionMetadata {
  const retainSourceSnapshot = Boolean(
    reflection.analysisRequestId ||
    reflection.analysis ||
    reflection.originalText !== documentBody
  );
  return {
    status: reflection.status,
    analysis: reflection.analysis,
    correction: reflection.correction,
    analysisRequestId: reflection.analysisRequestId,
    analysisRequestDigest: reflection.analysisRequestDigest,
    analysisRequestedAt: reflection.analysisRequestedAt,
    analysisSourceUpdatedAt: reflection.analysisSourceUpdatedAt,
    analysisSourceText: retainSourceSnapshot ? reflection.originalText : null,
    analysisContextSections: [...reflection.analysisContextSections],
    analysisProfileUpdatedAt: reflection.analysisProfileUpdatedAt,
    analysisMemoryRefs: reflection.analysisMemoryRefs.map((reference) => ({ ...reference })),
    suggestions: reflection.suggestions.map((suggestion) => ({ ...suggestion })),
    confirmedAt: reflection.confirmedAt
  };
}

function normalizeReflectionMetadata(
  value: unknown,
  createdAt: string,
  updatedAt: string,
  documentBody: string
): ReflectionMetadata | null {
  if (!isRecord(value)) return null;
  const normalized = normalizeReflection({
    ...value,
    id: "document-reflection-metadata",
    noteId: null,
    originalText: typeof value.analysisSourceText === "string"
      ? value.analysisSourceText
      : documentBody,
    createdAt,
    updatedAt
  }, true, true);
  if (!normalized) return null;
  const metadata = reflectionMetadataFromLegacy(normalized, documentBody);
  return {
    ...metadata,
    analysisSourceText: typeof value.analysisSourceText === "string"
      ? value.analysisSourceText
      : metadata.analysisSourceText
  };
}

function normalizeCurrentNote(value: LegacyNote): Note {
  const contentUpdatedAt = isValidDateString(value.contentUpdatedAt)
    ? value.contentUpdatedAt
    : value.updatedAt;
  return {
    ...value,
    contentUpdatedAt,
    reflection: normalizeReflectionMetadata(
      value.reflection,
      value.createdAt,
      value.updatedAt,
      value.body
    )
  };
}

function mergeLegacyReflectionIntoNote(
  note: Note,
  reflection: LegacyReflectionEntry
): Note {
  const tags = note.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление")
    ? note.tags
    : [...note.tags, "осмысление"];
  return {
    ...note,
    tags,
    origin: "reflection",
    reflection: reflectionMetadataFromLegacy(reflection, note.body),
    updatedAt: Date.parse(reflection.updatedAt) > Date.parse(note.updatedAt)
      ? reflection.updatedAt
      : note.updatedAt
  };
}

function upgradeV14ToV15(candidate: DashboardStateV14): DashboardState {
  const { reflections: _legacyReflections, ...stateWithoutLegacyReflections } = candidate;
  const notes = candidate.notes.map(normalizeCurrentNote);
  const noteIndexes = new Map(notes.map((note, index) => [note.id, index] as const));
  const noteIds = new Set(noteIndexes.keys());
  const reflectionDocumentIds = new Map<string, string>();

  for (const reflection of candidate.reflections) {
    const linkedNoteId = reflection.noteId && noteIds.has(reflection.noteId)
      ? reflection.noteId
      : null;
    let noteId = linkedNoteId ?? reflectionNoteId(reflection.id);
    if (!linkedNoteId) {
      let suffix = 2;
      const baseNoteId = noteId;
      while (noteIds.has(noteId)) {
        noteId = `${baseNoteId}-${suffix}`;
        suffix += 1;
      }
    }

    const existingIndex = noteIndexes.get(noteId);
    if (existingIndex === undefined) {
      const created = createReflectionNote(reflection.originalText, noteId, reflection.createdAt);
      const merged = mergeLegacyReflectionIntoNote(
        { ...created, updatedAt: reflection.updatedAt },
        reflection
      );
      noteIndexes.set(noteId, notes.length);
      noteIds.add(noteId);
      notes.push(merged);
    } else {
      notes[existingIndex] = mergeLegacyReflectionIntoNote(notes[existingIndex], reflection);
    }
    reflectionDocumentIds.set(reflection.id, noteId);
  }

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const tagged = note.origin === "reflection" ||
      note.tags.some((tag) => tag.trim().toLocaleLowerCase("ru") === "осмысление");
    if (tagged && !note.reflection) {
      notes[index] = {
        ...note,
        reflection: normalizeReflectionMetadata({}, note.createdAt, note.updatedAt, note.body) ?? {
          status: "captured",
          analysis: null,
          correction: null,
          analysisRequestId: null,
          analysisRequestDigest: null,
          analysisRequestedAt: null,
          analysisSourceUpdatedAt: null,
          analysisSourceText: null,
          analysisContextSections: [],
          analysisProfileUpdatedAt: null,
          analysisMemoryRefs: [],
          suggestions: [],
          confirmedAt: null
        }
      };
    }
  }

  const assistantMemory: AssistantMemoryItem[] = candidate.assistantMemory.map((item) => ({
    ...item,
    sourceType: item.sourceType === "manual" ? "manual" : "document",
    sourceId: item.sourceType === "manual"
      ? null
      : item.sourceType === "reflection"
        ? reflectionDocumentIds.get(item.sourceId ?? "") ?? item.sourceId
        : item.sourceId,
    sourceUpdatedAt: item.sourceType === "manual" ? null : item.sourceUpdatedAt
  }));

  const trash = candidate.trash.flatMap((value): TrashEntry[] => {
    if (!isRecord(value) || !isRecord(value.snapshot)) return [];
    if (value.snapshot.kind === "reflection") {
      const reflection = normalizeReflection(value.snapshot.reflection, true, true);
      if (!reflection) return [];
      const linkedNote = isRecord(value.snapshot.linkedNote)
        ? normalizeCurrentNote(value.snapshot.linkedNote as unknown as LegacyNote)
        : createReflectionNote(
            reflection.originalText,
            reflection.noteId ?? reflectionNoteId(reflection.id),
            reflection.createdAt
          );
      const note = mergeLegacyReflectionIntoNote(linkedNote, reflection);
      return [{
        id: String(value.id),
        entityKind: "note",
        entityId: note.id,
        title: typeof value.title === "string" ? value.title : note.title,
        deletedAt: typeof value.deletedAt === "string" ? value.deletedAt : reflection.updatedAt,
        snapshot: { kind: "note", note }
      }];
    }
    if (value.snapshot.kind === "note" && isRecord(value.snapshot.note)) {
      return [{
        ...value,
        entityKind: "note",
        entityId: String(value.entityId),
        snapshot: {
          kind: "note",
          note: normalizeCurrentNote(value.snapshot.note as unknown as LegacyNote)
        }
      } as TrashEntry];
    }
    return [value as unknown as TrashEntry];
  });

  const revisionHistory = candidate.revisionHistory.flatMap((value): EntityRevision[] => {
    if (!isRecord(value) || !isRecord(value.snapshot)) return [];
    if (value.snapshot.kind !== "note" || !isRecord(value.snapshot.note)) {
      return [value as unknown as EntityRevision];
    }
    return [{
      ...value,
      snapshot: {
        kind: "note",
        note: normalizeCurrentNote(value.snapshot.note as unknown as LegacyNote)
      }
    } as EntityRevision];
  });

  return {
    ...stateWithoutLegacyReflections,
    version: 15,
    notes,
    assistantMemory,
    trash,
    revisionHistory
  };
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
    .map((widget) =>
      widget.type === "reflection"
        ? {
            ...widget,
            type: "document" as const,
            title: widget.title === "Записать и осмыслить" ? "Текст" : widget.title
          }
        : widget
    )
    .map(normalizeWidgetLayout)
    .sort((left, right) => left.order - right.order)
    .map((widget) =>
      disableLegacyRecommendations && widget.type === "recommendations"
        ? { ...widget, enabled: false }
        : widget
    );

  if (!normalized.some((widget) => widget.type === "document")) {
    const document = createDefaultWidgets().find((widget) => widget.type === "document");
    if (document) {
      const recommendationIndex = normalized.findIndex(
        (widget) => widget.type === "recommendations"
      );
      normalized.splice(
        recommendationIndex >= 0 ? recommendationIndex : Math.min(2, normalized.length),
        0,
        document
      );
    }
  }

  return normalized.map((widget, order) => ({ ...widget, order }));
}

function migrateToV14(candidate: DashboardStateV14 | LegacyDashboardState): DashboardStateV14 {
  const runtimeVersion = (candidate as { version?: unknown }).version;
  if (!Number.isInteger(runtimeVersion) || Number(runtimeVersion) < 1 || Number(runtimeVersion) > 14) {
    throw new Error(`Неподдерживаемая версия локальных данных: ${String(runtimeVersion)}.`);
  }
  if (
    runtimeVersion === 14 &&
    (!isRecord(candidate) || !hasValidV14CanonicalData(candidate))
  ) {
    throw new Error("Локальные данные v14 повреждены: автосохранение остановлено.");
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

  if (candidate.version === 14) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      projects: lifeModel.projects,
      lifeAreas,
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: normalizeObjectGraph(candidate.objectGraph),
      trash: candidate.trash,
      revisionHistory: candidate.revisionHistory
    };
  }
  if (candidate.version === 13) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
      tasks: candidate.tasks.map((task) => ({
        ...task,
        recurrence: task.recurrence ?? "none",
        generatedFromTaskId: task.generatedFromTaskId ?? null
      })),
      events: candidate.events ?? [],
      settings,
      integrations: mergeIntegrations(candidate.integrations),
      widgets: normalizeWidgets(candidate.widgets, false),
      projects: lifeModel.projects,
      lifeAreas,
      notes: reflectionNotes.notes,
      reflections: reflectionNotes.reflections,
      assistantMemory: normalizeAssistantMemory(candidate.assistantMemory),
      personalContext: normalizePersonalContext(candidate.personalContext),
      readingItems: candidate.readingItems ?? [],
      activityLog: candidate.activityLog ?? [],
      objectGraph: normalizeObjectGraph(candidate.objectGraph),
      trash: [],
      revisionHistory: []
    };
  }
  if (candidate.version === 12) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
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
      objectGraph: createEmptyObjectGraph(),
      trash: [],
      revisionHistory: []
    };
  }
  if (candidate.version === 11) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, true))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
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
      objectGraph: createEmptyObjectGraph(),
      trash: [],
      revisionHistory: []
    };
  }
  if (candidate.version === 10) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, true, false))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
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
      objectGraph: createEmptyObjectGraph(),
      trash: [],
      revisionHistory: []
    };
  }
  if (candidate.version === 9) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
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
      objectGraph: createEmptyObjectGraph(),
      trash: [],
      revisionHistory: []
    };
  }
  if (candidate.version === 8) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
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
      objectGraph: createEmptyObjectGraph(),
      trash: [],
      revisionHistory: []
    };
  }
  if (candidate.version === 7) {
    const reflections = (candidate.reflections ?? [])
      .map((entry) => normalizeReflection(entry, false))
      .filter((entry): entry is LegacyReflectionEntry => entry !== null);
    const reflectionNotes = backfillReflectionNotes(candidate.notes ?? [], reflections);
    return {
      ...candidate,
      version: 14,
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
      objectGraph: createEmptyObjectGraph(),
      trash: [],
      revisionHistory: []
    };
  }
  return {
    ...candidate,
    version: 14,
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
    trash: [],
    revisionHistory: [],
    updatedAt: new Date().toISOString()
  };
}

export function migrateState(candidate: MigrationCandidate): DashboardState {
  const runtimeVersion = Number((candidate as { version?: unknown }).version);
  if (!Number.isInteger(runtimeVersion) || runtimeVersion < 1 || runtimeVersion > 15) {
    throw new Error(`Неподдерживаемая версия локальных данных: ${String(runtimeVersion)}.`);
  }
  if (runtimeVersion === 15) {
    if (!isRecord(candidate) || !hasValidV15CanonicalData(candidate)) {
      throw new Error("Локальные данные v15 повреждены: автосохранение остановлено.");
    }
    return {
      ...(candidate as DashboardState),
      widgets: normalizeWidgets((candidate as DashboardState).widgets, false)
    };
  }
  return upgradeV14ToV15(
    migrateToV14(candidate as DashboardStateV14 | LegacyDashboardState)
  );
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
      const result = request.result as MigrationCandidate | undefined;
      try {
        loaded = result ? migrateState(result) : null;
      } catch (error) {
        failure = error;
        transaction.abort();
        return;
      }
      const version = result ? Number((result as { version?: unknown }).version) : null;
      if (result && version !== null && version <= 14) {
        const safetyRequest = store.get(PRE_V15_SAFETY_KEY);
        safetyRequest.onsuccess = () => {
          if (safetyRequest.result === undefined) store.put(result, PRE_V15_SAFETY_KEY);
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
    const store = transaction.objectStore(STORE_NAME);
    const previousRequest = store.get(STATE_KEY);
    const indexRequest = store.get(AUTO_BACKUP_INDEX_KEY);
    let previousReady = false;
    let indexReady = false;
    let previous: MigrationCandidate | null = null;
    let index: AutomaticBackupSummary[] = [];

    const write = () => {
      if (!previousReady || !indexReady) return;
      const now = new Date();
      const latestBackupAt = index[0] ? Date.parse(index[0].createdAt) : 0;
      const previousUpdatedAt = previous && typeof previous.updatedAt === "string"
        ? previous.updatedAt
        : null;
      const shouldBackup = previous &&
        previousUpdatedAt !== state.updatedAt &&
        (!latestBackupAt || now.getTime() - latestBackupAt >= AUTO_BACKUP_INTERVAL_MS);

      if (shouldBackup && previousUpdatedAt) {
        const createdAt = now.toISOString();
        const key = `${AUTO_BACKUP_PREFIX}${createdAt}`;
        const nextIndex = [
          { key, createdAt, stateUpdatedAt: previousUpdatedAt },
          ...index.filter((entry) => entry.key !== key)
        ];
        store.put(previous, key);
        nextIndex.slice(MAX_AUTO_BACKUPS).forEach((entry) => store.delete(entry.key));
        store.put(nextIndex.slice(0, MAX_AUTO_BACKUPS), AUTO_BACKUP_INDEX_KEY);
      }
      store.put(state, STATE_KEY);
    };

    previousRequest.onsuccess = () => {
      previous = previousRequest.result as MigrationCandidate | undefined ?? null;
      previousReady = true;
      write();
    };
    indexRequest.onsuccess = () => {
      index = Array.isArray(indexRequest.result)
        ? indexRequest.result.filter((entry): entry is AutomaticBackupSummary => (
            isRecord(entry) &&
            isNonEmptyString(entry.key) &&
            isValidDateString(entry.createdAt) &&
            isValidDateString(entry.stateUpdatedAt)
          ))
        : [];
      indexReady = true;
      write();
    };
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

export async function listAutomaticBackups(): Promise<AutomaticBackupSummary[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(AUTO_BACKUP_INDEX_KEY);
    request.onsuccess = () => {
      const entries = Array.isArray(request.result)
        ? request.result.filter((entry): entry is AutomaticBackupSummary => (
            isRecord(entry) &&
            isNonEmptyString(entry.key) &&
            isValidDateString(entry.createdAt) &&
            isValidDateString(entry.stateUpdatedAt)
          ))
        : [];
      database.close();
      resolve(entries);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Не удалось прочитать автоматические копии."));
    };
  });
}

export async function createAutomaticBackup(state: DashboardState): Promise<AutomaticBackupSummary> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(AUTO_BACKUP_INDEX_KEY);
    const createdAt = new Date().toISOString();
    const summary: AutomaticBackupSummary = {
      key: `${AUTO_BACKUP_PREFIX}${createdAt}`,
      createdAt,
      stateUpdatedAt: state.updatedAt
    };
    request.onsuccess = () => {
      const current = Array.isArray(request.result)
        ? request.result.filter((entry): entry is AutomaticBackupSummary => (
            isRecord(entry) &&
            isNonEmptyString(entry.key) &&
            isValidDateString(entry.createdAt) &&
            isValidDateString(entry.stateUpdatedAt)
          ))
        : [];
      const next = [summary, ...current.filter((entry) => entry.key !== summary.key)];
      store.put(state, summary.key);
      next.slice(MAX_AUTO_BACKUPS).forEach((entry) => store.delete(entry.key));
      store.put(next.slice(0, MAX_AUTO_BACKUPS), AUTO_BACKUP_INDEX_KEY);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(summary);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Не удалось создать контрольную копию."));
    };
  });
}

export async function loadAutomaticBackup(key: string): Promise<DashboardState> {
  if (!key.startsWith(AUTO_BACKUP_PREFIX)) throw new Error("Недопустимый ключ резервной копии.");
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => {
      database.close();
      if (!request.result) {
        reject(new Error("Автоматическая копия не найдена."));
        return;
      }
      try {
        resolve(migrateState(request.result as MigrationCandidate));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Не удалось восстановить автоматическую копию."));
    };
  });
}

export async function clearAutomaticBackups(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(AUTO_BACKUP_INDEX_KEY);
    request.onsuccess = () => {
      const entries = Array.isArray(request.result) ? request.result : [];
      entries.forEach((entry) => {
        if (isRecord(entry) && isNonEmptyString(entry.key) && entry.key.startsWith(AUTO_BACKUP_PREFIX)) {
          store.delete(entry.key);
        }
      });
      store.delete(AUTO_BACKUP_INDEX_KEY);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Не удалось очистить автоматические копии."));
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

function isValidLegacyNote(value: unknown): boolean {
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

function isValidReflectionMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const legacyShape = {
    ...value,
    id: "metadata-validation",
    noteId: null,
    originalText: typeof value.analysisSourceText === "string" ? value.analysisSourceText : "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  return isValidReflection(legacyShape) &&
    (value.analysisSourceText === null || typeof value.analysisSourceText === "string");
}

function isValidNote(value: unknown): boolean {
  return isValidLegacyNote(value) &&
    isRecord(value) &&
    isValidDateString(value.contentUpdatedAt) &&
    (value.reflection === null || isValidReflectionMetadata(value.reflection));
}

function isValidLegacyAssistantMemoryItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const documentSource = value.sourceType === "reflection" || value.sourceType === "document";
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.text) &&
    legacyAssistantMemorySourceTypes.includes(value.sourceType as LegacyAssistantMemoryItem["sourceType"]) &&
    assistantMemoryStatuses.includes(value.status as AssistantMemoryItem["status"]) &&
    (documentSource ? isNonEmptyString(value.sourceId) : value.sourceId === null) &&
    (documentSource ? isValidDateString(value.sourceUpdatedAt) : value.sourceUpdatedAt === null) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt);
}

function isValidAssistantMemoryItem(value: unknown): boolean {
  return isValidLegacyAssistantMemoryItem(value) &&
    isRecord(value) &&
    (value.sourceType === "document" || value.sourceType === "manual");
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

const widgetTypes = ["overview", "focus", "document", "reflection", "plan", "inbox", "weather", "recommendations", "reading", "custom"];
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
  "project_area_changed", "object_created", "object_updated", "object_relation_added", "object_relation_removed",
  "entity_trashed", "entity_restored", "trash_purged", "revision_restored"
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

function isValidUniversalObjectSnapshot(value: unknown): boolean {
  try {
    normalizeObjectGraph({ schemaVersion: 1, objects: [value], relations: [] });
    return true;
  } catch {
    return false;
  }
}

function isValidLegacyTrashEntry(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const common = isNonEmptyString(value.id) &&
    isNonEmptyString(value.entityId) &&
    ["task", "note", "reflection", "event", "object"].includes(String(value.entityKind)) &&
    typeof value.title === "string" &&
    isValidDateString(value.deletedAt) &&
    value.entityKind === value.snapshot.kind;
  if (!common) return false;
  if (value.snapshot.kind === "task") {
    return isValidTask(value.snapshot.task) &&
      Array.isArray(value.snapshot.linkedEvents) &&
      value.snapshot.linkedEvents.every(isValidCalendarEvent);
  }
  if (value.snapshot.kind === "note") return isValidLegacyNote(value.snapshot.note);
  if (value.snapshot.kind === "reflection") {
    return isValidReflection(value.snapshot.reflection) &&
      (value.snapshot.linkedNote === null || isValidLegacyNote(value.snapshot.linkedNote));
  }
  if (value.snapshot.kind === "event") return isValidCalendarEvent(value.snapshot.event);
  if (value.snapshot.kind !== "object" || !isValidUniversalObjectSnapshot(value.snapshot.object)) return false;
  const objectId = isRecord(value.snapshot.object) && isNonEmptyString(value.snapshot.object.id)
    ? value.snapshot.object.id
    : null;
  if (!objectId) return false;
  return Array.isArray(value.snapshot.relations) && value.snapshot.relations.every((relation) => (
    isRecord(relation) &&
    isNonEmptyString(relation.id) &&
    ["contains", "links", "embeds"].includes(String(relation.kind)) &&
    isNonEmptyString(relation.fromId) &&
    isNonEmptyString(relation.toId) &&
    relation.fromId !== relation.toId &&
    (relation.fromId === objectId || relation.toId === objectId) &&
    isFiniteInteger(relation.order, 0) &&
    isValidDateString(relation.createdAt)
  ));
}

function isValidLegacyEntityRevision(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const common = isNonEmptyString(value.id) &&
    isNonEmptyString(value.entityId) &&
    ["task", "note", "event", "object"].includes(String(value.entityKind)) &&
    typeof value.title === "string" &&
    isValidDateString(value.capturedAt) &&
    value.entityKind === value.snapshot.kind;
  if (!common) return false;
  if (value.snapshot.kind === "task") return isValidTask(value.snapshot.task);
  if (value.snapshot.kind === "note") return isValidLegacyNote(value.snapshot.note);
  if (value.snapshot.kind === "event") return isValidCalendarEvent(value.snapshot.event);
  return value.snapshot.kind === "object" && isValidUniversalObjectSnapshot(value.snapshot.object);
}

function isValidTrashEntry(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const common = isNonEmptyString(value.id) &&
    isNonEmptyString(value.entityId) &&
    ["task", "note", "event", "object"].includes(String(value.entityKind)) &&
    typeof value.title === "string" &&
    isValidDateString(value.deletedAt) &&
    value.entityKind === value.snapshot.kind;
  if (!common) return false;
  if (value.snapshot.kind === "task") {
    return isValidTask(value.snapshot.task) &&
      Array.isArray(value.snapshot.linkedEvents) &&
      value.snapshot.linkedEvents.every(isValidCalendarEvent);
  }
  if (value.snapshot.kind === "note") return isValidNote(value.snapshot.note);
  if (value.snapshot.kind === "event") return isValidCalendarEvent(value.snapshot.event);
  if (value.snapshot.kind !== "object" || !isValidUniversalObjectSnapshot(value.snapshot.object)) {
    return false;
  }
  const objectId = isRecord(value.snapshot.object) && isNonEmptyString(value.snapshot.object.id)
    ? value.snapshot.object.id
    : null;
  return Boolean(objectId) &&
    Array.isArray(value.snapshot.relations) &&
    value.snapshot.relations.every((relation) => (
      isRecord(relation) &&
      isNonEmptyString(relation.id) &&
      ["contains", "links", "embeds"].includes(String(relation.kind)) &&
      isNonEmptyString(relation.fromId) &&
      isNonEmptyString(relation.toId) &&
      relation.fromId !== relation.toId &&
      (relation.fromId === objectId || relation.toId === objectId) &&
      isFiniteInteger(relation.order, 0) &&
      isValidDateString(relation.createdAt)
    ));
}

function isValidEntityRevision(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const common = isNonEmptyString(value.id) &&
    isNonEmptyString(value.entityId) &&
    ["task", "note", "event", "object"].includes(String(value.entityKind)) &&
    typeof value.title === "string" &&
    isValidDateString(value.capturedAt) &&
    value.entityKind === value.snapshot.kind;
  if (!common) return false;
  if (value.snapshot.kind === "task") return isValidTask(value.snapshot.task);
  if (value.snapshot.kind === "note") return isValidNote(value.snapshot.note);
  if (value.snapshot.kind === "event") return isValidCalendarEvent(value.snapshot.event);
  return value.snapshot.kind === "object" && isValidUniversalObjectSnapshot(value.snapshot.object);
}

function hasValidV15CanonicalData(candidate: Record<string, unknown>): boolean {
  if (
    candidate.version !== 15 ||
    !Array.isArray(candidate.tasks) || !hasUniqueEntityIds(candidate.tasks, isValidTask) ||
    !Array.isArray(candidate.projects) || !hasUniqueEntityIds(candidate.projects, isValidProject) ||
    !Array.isArray(candidate.lifeAreas) || !hasUniqueEntityIds(candidate.lifeAreas, isValidLifeArea) ||
    !Array.isArray(candidate.events) || !hasUniqueEntityIds(candidate.events, isValidCalendarEvent) ||
    !Array.isArray(candidate.notes) || !hasUniqueEntityIds(candidate.notes, isValidNote) ||
    !Array.isArray(candidate.assistantMemory) ||
      !hasUniqueEntityIds(candidate.assistantMemory, isValidAssistantMemoryItem) ||
    !isValidPersonalContext(candidate.personalContext) ||
    !isValidAppSettings(candidate.settings) ||
    !isValidIntegrations(candidate.integrations) ||
    !Array.isArray(candidate.widgets) || !hasUniqueEntityIds(candidate.widgets, isValidWidget) ||
    !Array.isArray(candidate.readingItems) ||
      !hasUniqueEntityIds(candidate.readingItems, isValidReadingItem) ||
    !Array.isArray(candidate.activityLog) ||
      !hasUniqueEntityIds(candidate.activityLog, isValidActivityEntry) ||
    !Array.isArray(candidate.trash) || !hasUniqueEntityIds(candidate.trash, isValidTrashEntry) ||
    !Array.isArray(candidate.revisionHistory) ||
      !hasUniqueEntityIds(candidate.revisionHistory, isValidEntityRevision) ||
    !isValidDateString(candidate.updatedAt)
  ) return false;

  const areaIds = new Set(candidate.lifeAreas.map((area) => (area as { id: string }).id));
  if (candidate.projects.some((project) => {
    const areaId = (project as { areaId: string | null }).areaId;
    return areaId !== null && !areaIds.has(areaId);
  })) return false;

  try {
    normalizeObjectGraph(candidate.objectGraph);
  } catch {
    return false;
  }
  return true;
}

function hasValidCanonicalData(candidate: Record<string, unknown>, expectedVersion: 13 | 14): boolean {
  if (
    candidate.version !== expectedVersion ||
    !Array.isArray(candidate.tasks) || !hasUniqueEntityIds(candidate.tasks, isValidTask) ||
    !Array.isArray(candidate.projects) || !hasUniqueEntityIds(candidate.projects, isValidProject) ||
    !Array.isArray(candidate.lifeAreas) || !hasUniqueEntityIds(candidate.lifeAreas, isValidLifeArea) ||
    !Array.isArray(candidate.events) || !hasUniqueEntityIds(candidate.events, isValidCalendarEvent) ||
    !Array.isArray(candidate.notes) || !hasUniqueEntityIds(candidate.notes, isValidLegacyNote) ||
    !Array.isArray(candidate.reflections) || !hasUniqueEntityIds(candidate.reflections, isValidReflection) ||
    !Array.isArray(candidate.assistantMemory) || !hasUniqueEntityIds(candidate.assistantMemory, isValidLegacyAssistantMemoryItem) ||
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

function hasValidV13CanonicalData(candidate: Record<string, unknown>): boolean {
  return hasValidCanonicalData(candidate, 13);
}

function hasValidV14CanonicalData(candidate: Record<string, unknown>): boolean {
  return hasValidCanonicalData(candidate, 14) &&
    Array.isArray(candidate.trash) && hasUniqueEntityIds(candidate.trash, isValidLegacyTrashEntry) &&
    Array.isArray(candidate.revisionHistory) &&
      hasUniqueEntityIds(candidate.revisionHistory, isValidLegacyEntityRevision);
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

function isValidV14Backup(candidate: Record<string, unknown>): boolean {
  if (!hasValidV14CanonicalData(candidate)) return false;
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
    trash?: unknown;
    revisionHistory?: unknown;
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
      candidate.version !== 13 &&
      candidate.version !== 14 &&
      candidate.version !== 15) ||
    !Array.isArray(candidate.tasks) ||
    !Array.isArray(candidate.projects) ||
    (candidate.version >= 2 && !Array.isArray(candidate.events)) ||
    (candidate.version >= 3 && !Array.isArray(candidate.notes)) ||
    (candidate.version >= 4 && !candidate.integrations) ||
    (candidate.version >= 6 &&
      (!Array.isArray(candidate.widgets) ||
        !Array.isArray(candidate.readingItems) ||
        !Array.isArray(candidate.activityLog))) ||
    (candidate.version >= 7 && candidate.version <= 14 &&
      !Array.isArray(candidate.reflections)) ||
    (candidate.version >= 8 && !candidate.personalContext) ||
    (candidate.version >= 9 && !Array.isArray(candidate.assistantMemory)) ||
    (candidate.version >= 11 && candidate.version <= 14 &&
      !reflectionsHaveSuggestionArrays(candidate.reflections)) ||
    (candidate.version >= 12 && !Array.isArray(candidate.lifeAreas)) ||
    (candidate.version >= 13 && !candidate.objectGraph) ||
    (candidate.version >= 14 && (!Array.isArray(candidate.trash) || !Array.isArray(candidate.revisionHistory))) ||
    !candidate.settings ||
    (candidate.version === 13 && !isValidV13Backup(candidate as Record<string, unknown>)) ||
    (candidate.version === 14 && !isValidV14Backup(candidate as Record<string, unknown>)) ||
    (candidate.version === 15 && !hasValidV15CanonicalData(candidate as Record<string, unknown>))
  ) {
    throw new Error("Файл не похож на резервную копию командного центра.");
  }
  return migrateState(candidate as unknown as MigrationCandidate);
}
