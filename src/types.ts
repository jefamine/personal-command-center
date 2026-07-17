import type { ObjectGraph, ObjectRelation, UniversalObject } from "./domain/objects/objectGraph";

export type ViewId =
  | "today"
  | "gtd"
  | "workspace"
  | "sphere"
  | "life"
  | "inbox"
  | "tasks"
  | "projects"
  | "calendar"
  | "journal"
  | "notes"
  | "integrations"
  | "review"
  | "insights"
  | "settings";

export type TaskStatus =
  | "inbox"
  | "next"
  | "planned"
  | "waiting"
  | "someday"
  | "done";

export type EnergyLevel = "low" | "medium" | "high";
export type ProjectStatus = "active" | "paused" | "completed";
export type RecurrenceRule = "none" | "daily" | "weekdays" | "weekly" | "monthly";
export type CalendarEventKind = "meeting" | "focus" | "personal" | "break";
export type CalendarEventSource = "local" | "dashboard" | "google";
export type AccentPreset = "lime" | "violet" | "ocean" | "coral" | "rose" | "custom";
export type SurfaceTone = "warm" | "cool" | "neutral";
export type VisualStyle = "soft" | "glass" | "contrast";
export type InterfaceDensity = "comfortable" | "compact";
export type CornerStyle = "rounded" | "balanced" | "crisp";
export type FontScale = "normal" | "large" | "xlarge";
export type DashboardWidgetType =
  | "overview"
  | "focus"
  | "reflection"
  | "plan"
  | "inbox"
  | "weather"
  | "recommendations"
  | "reading"
  | "custom";
export type DashboardWidgetSize = "full" | "two-thirds" | "half" | "third";
export type CustomWidgetVariant = "note" | "link" | "image" | "metric" | "file" | "api";

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  projectId: string | null;
  priority: 1 | 2 | 3 | 4;
  estimateMinutes: number;
  energy: EnergyLevel;
  context: string;
  dueDate: string | null;
  scheduledDate: string | null;
  completedAt: string | null;
  recurrence: RecurrenceRule;
  generatedFromTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields that may be changed without replacing a task's durable identity or provenance. */
export type TaskUpdate = Partial<Pick<
  Task,
  | "title"
  | "notes"
  | "status"
  | "projectId"
  | "priority"
  | "estimateMinutes"
  | "energy"
  | "context"
  | "dueDate"
  | "scheduledDate"
  | "recurrence"
  | "completedAt"
>>;

export interface Project {
  id: string;
  title: string;
  description: string;
  /** Stable link to a life area. The legacy label remains for one migration cycle. */
  areaId: string | null;
  area: string;
  color: string;
  status: ProjectStatus;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LifeArea {
  id: string;
  title: string;
  description: string;
  color: string;
  archived: boolean;
  /** Show this sphere in the compact top navigation. It remains available in the full menu. */
  showInTopNavigation: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface LifeAreaDraft {
  title: string;
  description?: string;
  color?: string;
}

export type LifeAreaUpdate = Partial<
  Pick<LifeArea, "title" | "description" | "color" | "archived" | "showInTopNavigation">
>;

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  kind: CalendarEventKind;
  source: CalendarEventSource;
  taskId: string | null;
  notes: string;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  projectId: string | null;
  tags: string[];
  pinned: boolean;
  /** Durable, non-editable provenance used to keep personal reflection notes private. */
  origin?: "reflection";
  createdAt: string;
  updatedAt: string;
}

/** Fields that may be changed without touching durable note identity or provenance. */
export type NoteUpdate = Partial<
  Pick<Note, "title" | "body" | "projectId" | "tags" | "pinned">
>;

export type ReflectionStatus =
  | "captured"
  | "queued"
  | "analyzed"
  | "confirmed"
  | "corrected"
  | "ignored";

export interface ReflectionAnalysis {
  responseId: string;
  requestId: string;
  understanding: string;
  observations: string[];
  possibleExplanation: string;
  alternatives: string[];
  question: string;
  proposedAction: string;
  source: "codex";
  generatedAt: string;
}

export type PersonalContextSectionId =
  | "goals"
  | "rhythms"
  | "preferences"
  | "boundaries"
  | "systemProfile";

export type SvpVectorId =
  | "skin"
  | "anal"
  | "muscular"
  | "urethral"
  | "visual"
  | "sound"
  | "oral"
  | "olfactory";

export type SvpLanguageMode = "off" | "plain" | "systemic";

export interface PersonalSystemProfile {
  mode: SvpLanguageMode;
  selfDeclaredVectors: SvpVectorId[];
  manifestations: string;
  combinationNotes: string;
}

export interface PersonalContext {
  goals: string;
  rhythms: string;
  preferences: string;
  boundaries: string;
  systemProfile: PersonalSystemProfile;
  updatedAt: string | null;
}

export type PersonalContextPatch = Partial<
  Pick<PersonalContext, "goals" | "rhythms" | "preferences" | "boundaries" | "systemProfile">
>;

export interface ReflectionContextProjection {
  schemaVersion: 1;
  profileUpdatedAt: string;
  sections: {
    goals: string | null;
    rhythms: string | null;
    preferences: string | null;
    boundaries: string | null;
    systemProfile: PersonalSystemProfile | null;
  };
}

export interface ReflectionEntry {
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
  analysisMemoryRefs: ReflectionMemoryReference[];
  suggestions: ReflectionSuggestion[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export type AssistantMemoryStatus = "active" | "paused";
export type AssistantMemorySourceType = "reflection" | "manual";

export interface AssistantMemoryItem {
  id: string;
  text: string;
  sourceType: AssistantMemorySourceType;
  sourceId: string | null;
  sourceUpdatedAt: string | null;
  status: AssistantMemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMemoryDraft {
  text: string;
  sourceType?: AssistantMemorySourceType;
  sourceId?: string | null;
  sourceUpdatedAt?: string | null;
}

export interface ReflectionMemoryProjectionItem {
  id: string;
  text: string;
  updatedAt: string;
}

export interface ReflectionMemoryProjection {
  schemaVersion: 1;
  items: ReflectionMemoryProjectionItem[];
}

export interface ReflectionMemoryReference {
  id: string;
  updatedAt: string;
}

export type ReflectionSuggestionKind = "meaning" | "question" | "next_action";
export type ReflectionSuggestionStatus = "pending" | "accepted" | "dismissed";

export interface ReflectionSuggestion {
  id: string;
  kind: ReflectionSuggestionKind;
  sourceText: string;
  text: string;
  status: ReflectionSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  addedToNoteAt: string | null;
  createdTaskId: string | null;
}

export interface ReflectionAnalysisRequest {
  entryId: string;
  requestId: string;
  sourceUpdatedAt: string;
  originalText: string;
  context: ReflectionContextProjection | null;
  memory: ReflectionMemoryProjection | null;
}

export interface ReflectionAnalysisResponse {
  entryId: string;
  requestId: string;
  requestDigest: string;
  sourceUpdatedAt: string;
  analysis: ReflectionAnalysis;
}

export interface AppSettings {
  userName: string;
  workdayStart: string;
  workdayEnd: string;
  dailyCapacityMinutes: number;
  focusBlockMinutes: number;
  bufferMinutes: number;
  currentEnergy: EnergyLevel;
  theme: "light" | "dark" | "system";
  accentPreset: AccentPreset;
  accentColor: string;
  secondaryColor: string;
  surfaceTone: SurfaceTone;
  visualStyle: VisualStyle;
  density: InterfaceDensity;
  cornerStyle: CornerStyle;
  fontScale: FontScale;
  sidebarCollapsed: boolean;
  /** Internal marker: prevents deleted starter spheres from being restored on every launch. */
  lifeAreaTemplatesVersion: number;
}

export interface DashboardWidgetConfig {
  city?: string;
  latitude?: number;
  longitude?: number;
  variant?: CustomWidgetVariant;
  description?: string;
  body?: string;
  linkUrl?: string;
  linkLabel?: string;
  imageUrl?: string;
  imageAlt?: string;
  metricValue?: string;
  metricUnit?: string;
  fileUrl?: string;
  fileName?: string;
  apiUrl?: string;
  apiPath?: string;
}

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  title: string;
  enabled: boolean;
  size: DashboardWidgetSize;
  gridWidth?: number;
  gridHeight?: number;
  order: number;
  config: DashboardWidgetConfig;
}

export interface ReadingItem {
  id: string;
  title: string;
  summary: string;
  body: string;
  url: string;
  source: string;
  tags: string[];
  createdAt: string;
}

export interface ReadingItemDraft {
  title: string;
  summary?: string;
  body?: string;
  url?: string;
  source?: string;
  tags?: string[];
}

export interface ActivityEntry {
  id: string;
  type:
    | "task_created"
    | "task_completed"
    | "task_reopened"
    | "plan_confirmed"
    | "note_created"
    | "reflection_created"
    | "reflection_queued"
    | "reflection_queue_cancelled"
    | "reflection_analyzed"
    | "reflection_confirmed"
    | "reflection_corrected"
    | "reflection_ignored"
    | "reflection_note_created"
    | "reflection_suggestion_edited"
    | "reflection_suggestion_decided"
    | "reflection_suggestion_note_applied"
    | "reflection_suggestion_task_created"
    | "memory_created"
    | "memory_updated"
    | "memory_paused"
    | "memory_resumed"
    | "memory_removed"
    | "life_area_created"
    | "life_area_updated"
    | "life_area_removed"
    | "project_area_changed"
    | "object_created"
    | "object_updated"
    | "object_relation_added"
    | "object_relation_removed"
    | "entity_trashed"
    | "entity_restored"
    | "trash_purged"
    | "revision_restored";
  entityId: string | null;
  timestamp: string;
  metadata: Record<string, string | number | boolean | null>;
}

export type RecoverableEntityKind = "task" | "note" | "reflection" | "event" | "object";

export type RecoverableEntitySnapshot =
  | { kind: "task"; task: Task; linkedEvents: CalendarEvent[] }
  | { kind: "note"; note: Note }
  | { kind: "reflection"; reflection: ReflectionEntry; linkedNote: Note | null }
  | { kind: "event"; event: CalendarEvent }
  | { kind: "object"; object: UniversalObject; relations: ObjectRelation[] };

/** A recoverable tombstone. Payload is retained only until the user purges the entry. */
export interface TrashEntry {
  id: string;
  entityId: string;
  entityKind: RecoverableEntityKind;
  title: string;
  deletedAt: string;
  snapshot: RecoverableEntitySnapshot;
}

export type RevisionSnapshot =
  | { kind: "task"; task: Task }
  | { kind: "note"; note: Note }
  | { kind: "event"; event: CalendarEvent }
  | { kind: "object"; object: UniversalObject };

/** A bounded checkpoint captured before an editable entity changes. */
export interface EntityRevision {
  id: string;
  entityId: string;
  entityKind: RevisionSnapshot["kind"];
  title: string;
  capturedAt: string;
  snapshot: RevisionSnapshot;
}

export type IntegrationStatus = "disconnected" | "configured" | "connected" | "error";

export interface GoogleIntegrationSettings {
  enabled: boolean;
  status: IntegrationStatus;
  calendarEnabled: boolean;
  tasksEnabled: boolean;
  syncIntervalMinutes: number;
  readAllCalendars: boolean;
  focusCalendarName: string;
  writeFocusBlocks: boolean;
  tasksListName: string;
  tasksMode: "inbox" | "two-way";
  conflictPolicy: "latest" | "dashboard";
  lastSyncAt: string | null;
}

export interface ObsidianIntegrationSettings {
  enabled: boolean;
  vaultPath: string;
  folder: string;
  includeFrontmatter: boolean;
  mode: "manual" | "mirror";
  lastExportAt: string | null;
}

export interface CodexSnapshotScope {
  tasks: boolean;
  projects: boolean;
  calendar: boolean;
  notes: boolean;
  journal: boolean;
  reading: boolean;
}

export interface CodexIntegrationSettings {
  enabled: boolean;
  permissionMode: "confirm" | "trusted";
  allowCreateTasks: boolean;
  allowUpdateTasks: boolean;
  allowCompleteTasks: boolean;
  allowNotes: boolean;
  allowReading: boolean;
  snapshotScope: CodexSnapshotScope;
  lastSnapshotAt: string | null;
  lastCommandImportAt: string | null;
}

export interface IntegrationSettings {
  google: GoogleIntegrationSettings;
  obsidian: ObsidianIntegrationSettings;
  codex: CodexIntegrationSettings;
}

export interface DashboardState {
  version: 14;
  tasks: Task[];
  projects: Project[];
  lifeAreas: LifeArea[];
  events: CalendarEvent[];
  notes: Note[];
  reflections: ReflectionEntry[];
  assistantMemory: AssistantMemoryItem[];
  personalContext: PersonalContext;
  settings: AppSettings;
  integrations: IntegrationSettings;
  widgets: DashboardWidget[];
  readingItems: ReadingItem[];
  activityLog: ActivityEntry[];
  trash: TrashEntry[];
  revisionHistory: EntityRevision[];
  /** Native universal objects and edges. Legacy arrays remain canonical during the transition. */
  objectGraph: ObjectGraph;
  updatedAt: string;
}

export type CodexCommand =
  | {
      id: string;
      type: "add_task";
      payload: Omit<TaskDraft, "status" | "generatedFromTaskId"> & {
        status?: Exclude<TaskStatus, "done">;
      };
    }
  | {
      id: string;
      type: "update_task";
      entityId: string;
      payload: Omit<TaskUpdate, "status" | "completedAt"> & {
        status?: Exclude<TaskStatus, "done">;
      };
    }
  | { id: string; type: "complete_task"; entityId: string }
  | { id: string; type: "add_note"; payload: NoteDraft }
  | { id: string; type: "update_note"; entityId: string; payload: NoteUpdate }
  | { id: string; type: "add_reading"; payload: ReadingItemDraft };

export interface PlanItem {
  task: Task;
  score: number;
  reasons: string[];
  startMinutes: number;
  endMinutes: number;
  confirmed: boolean;
}

export interface TaskDraft {
  title: string;
  status?: TaskStatus;
  projectId?: string | null;
  priority?: 1 | 2 | 3 | 4;
  estimateMinutes?: number;
  energy?: EnergyLevel;
  context?: string;
  dueDate?: string | null;
  scheduledDate?: string | null;
  notes?: string;
  recurrence?: RecurrenceRule;
  generatedFromTaskId?: string | null;
}

export interface CalendarEventDraft {
  title: string;
  startAt: string;
  endAt: string;
  kind?: CalendarEventKind;
  source?: CalendarEventSource;
  taskId?: string | null;
  notes?: string;
  locked?: boolean;
}

export interface NoteDraft {
  title: string;
  body?: string;
  projectId?: string | null;
  tags?: string[];
  pinned?: boolean;
}
