export type KnownObjectRole =
  | "document"
  | "task"
  | "project"
  | "event"
  | "person"
  | "place"
  | "sphere"
  | "striving"
  | "collection"
  | "material"
  | "file";

export type UniversalObjectRole = KnownObjectRole | `custom:${string}`;
export type UniversalObjectStatus = "active" | "completed" | "archived" | "deleted";
export type UniversalBlockType =
  | "text"
  | "heading"
  | "quote"
  | "checklist"
  | "link"
  | "image"
  | "video"
  | "audio"
  | "file";
export type ObjectRelationKind = "contains" | "links" | "embeds";
export type ObjectRelationOrigin = "manual" | "wiki-link" | "wiki-embed";
export interface WikiRelationBinding {
  labelAtBinding: string;
  occurrence: number;
  lastKnownStart: number;
  lastKnownEnd: number;
  contextFingerprint: string;
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface UniversalObjectBlock {
  id: string;
  type: UniversalBlockType;
  text: string;
  url: string | null;
  checked: boolean | null;
  metadata: Record<string, JsonValue>;
}

export interface UniversalObjectSource {
  kind: "native" | "legacy";
  entityType: string | null;
  entityId: string | null;
}

export interface UniversalObject {
  id: string;
  roles: UniversalObjectRole[];
  title: string;
  blocks: UniversalObjectBlock[];
  properties: Record<string, JsonValue>;
  status: UniversalObjectStatus;
  source: UniversalObjectSource;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

interface ObjectRelationBase {
  id: string;
  kind: ObjectRelationKind;
  fromId: string;
  toId: string;
  order: number;
  createdAt: string;
}

export type ObjectRelation =
  | (ObjectRelationBase & { origin: "manual"; binding?: never })
  | (ObjectRelationBase & { kind: "links"; origin: "wiki-link"; binding: WikiRelationBinding })
  | (ObjectRelationBase & { kind: "embeds"; origin: "wiki-embed"; binding: WikiRelationBinding });

export interface ObjectGraph {
  schemaVersion: 1;
  objects: UniversalObject[];
  relations: ObjectRelation[];
}

export interface UniversalObjectDraft {
  id?: string;
  roles?: UniversalObjectRole[];
  title?: string;
  blocks?: UniversalObjectBlock[];
  properties?: Record<string, JsonValue>;
}

export interface ObjectRelationDraft {
  id?: string;
  kind: ObjectRelationKind;
  fromId: string;
  toId: string;
  order?: number;
  origin?: ObjectRelationOrigin;
  binding?: WikiRelationBinding;
}

export type ObjectGraphErrorCode =
  | "invalid_graph"
  | "invalid_object"
  | "invalid_relation"
  | "duplicate_object"
  | "reserved_object_id"
  | "missing_object"
  | "missing_endpoint"
  | "self_relation"
  | "duplicate_relation"
  | "duplicate_relation_id"
  | "already_has_parent"
  | "containment_cycle"
  | "revision_conflict"
  | "unsupported_schema";

export class ObjectGraphError extends Error {
  constructor(public readonly code: ObjectGraphErrorCode, message: string) {
    super(message);
    this.name = "ObjectGraphError";
  }
}

const blockTypes: UniversalBlockType[] = [
  "text",
  "heading",
  "quote",
  "checklist",
  "link",
  "image",
  "video",
  "audio",
  "file"
];
const relationKinds: ObjectRelationKind[] = ["contains", "links", "embeds"];
const relationOrigins: ObjectRelationOrigin[] = ["manual", "wiki-link", "wiki-embed"];
const objectStatuses: UniversalObjectStatus[] = ["active", "completed", "archived", "deleted"];
const knownRoles: KnownObjectRole[] = [
  "document",
  "task",
  "project",
  "event",
  "person",
  "place",
  "sphere",
  "striving",
  "collection",
  "material",
  "file"
];

function randomId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isDateString(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["boolean", "string"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function normalizeJsonRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => isJsonValue(entry))) as Record<string, JsonValue>;
}

function isUniversalRole(value: unknown): value is UniversalObjectRole {
  return typeof value === "string" && (
    knownRoles.includes(value as KnownObjectRole) ||
    (value.startsWith("custom:") && value.length > "custom:".length)
  );
}

function normalizeRoles(value: unknown): UniversalObjectRole[] {
  if (!Array.isArray(value)) return ["document"];
  const roles = [...new Set(value.filter(isUniversalRole))];
  return roles.length ? roles : ["document"];
}

export function createTextBlock(text = "", id = randomId()): UniversalObjectBlock {
  return { id, type: "text", text, url: null, checked: null, metadata: {} };
}

function normalizeBlock(value: unknown): UniversalObjectBlock | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !blockTypes.includes(value.type as UniversalBlockType)) {
    return null;
  }
  return {
    id: value.id,
    type: value.type as UniversalBlockType,
    text: typeof value.text === "string" ? value.text : "",
    url: typeof value.url === "string" ? value.url : null,
    checked: typeof value.checked === "boolean" ? value.checked : null,
    metadata: normalizeJsonRecord(value.metadata)
  };
}

function normalizeBlocks(value: unknown): UniversalObjectBlock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(normalizeBlock).filter((block): block is UniversalObjectBlock => {
    if (!block || seen.has(block.id)) return false;
    seen.add(block.id);
    return true;
  });
}

function normalizeSource(value: unknown): UniversalObjectSource {
  if (!isRecord(value) || value.kind !== "legacy") {
    return { kind: "native", entityType: null, entityId: null };
  }
  return {
    kind: "legacy",
    entityType: typeof value.entityType === "string" ? value.entityType : null,
    entityId: typeof value.entityId === "string" ? value.entityId : null
  };
}

function normalizeObject(value: unknown): UniversalObject | null {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return null;
  const createdAt = isDateString(value.createdAt) ? value.createdAt : new Date(0).toISOString();
  const updatedAt = isDateString(value.updatedAt) ? value.updatedAt : createdAt;
  const status = objectStatuses.includes(value.status as UniversalObjectStatus)
    ? value.status as UniversalObjectStatus
    : "active";
  return {
    id: value.id,
    roles: normalizeRoles(value.roles),
    title: typeof value.title === "string" ? value.title : "Без названия",
    blocks: normalizeBlocks(value.blocks),
    properties: normalizeJsonRecord(value.properties),
    status,
    source: normalizeSource(value.source),
    revision: Number.isInteger(value.revision) && Number(value.revision) > 0 ? Number(value.revision) : 1,
    createdAt,
    updatedAt,
    archivedAt: isDateString(value.archivedAt) ? value.archivedAt : null,
    deletedAt: isDateString(value.deletedAt) ? value.deletedAt : null
  };
}

function normalizeRelation(value: unknown): ObjectRelation | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !relationKinds.includes(value.kind as ObjectRelationKind) ||
    !isNonEmptyString(value.fromId) ||
    !isNonEmptyString(value.toId) ||
    value.fromId === value.toId
  ) {
    return null;
  }
  const origin = relationOrigins.includes(value.origin as ObjectRelationOrigin)
    ? value.origin as ObjectRelationOrigin
    : "manual";
  const binding = normalizeWikiBinding(value.binding);
  const base: ObjectRelationBase = {
    id: value.id,
    kind: value.kind as ObjectRelationKind,
    fromId: value.fromId,
    toId: value.toId,
    order: Number.isFinite(value.order) ? Math.max(0, Math.floor(Number(value.order))) : 0,
    createdAt: isDateString(value.createdAt) ? value.createdAt : new Date(0).toISOString()
  };
  if (origin === "manual") return { ...base, origin };
  if (!binding || (origin === "wiki-link" && base.kind !== "links") ||
    (origin === "wiki-embed" && base.kind !== "embeds")) return null;
  return origin === "wiki-link"
    ? { ...base, kind: "links", origin, binding }
    : { ...base, kind: "embeds", origin, binding };
}

function normalizeWikiBinding(value: unknown): WikiRelationBinding | null {
  if (!isRecord(value) ||
    !isNonEmptyString(value.labelAtBinding) ||
    !Number.isInteger(value.occurrence) || Number(value.occurrence) < 0 ||
    !Number.isInteger(value.lastKnownStart) || Number(value.lastKnownStart) < 0 ||
    !Number.isInteger(value.lastKnownEnd) || Number(value.lastKnownEnd) <= Number(value.lastKnownStart) ||
    !isNonEmptyString(value.contextFingerprint)) return null;
  return {
    labelAtBinding: value.labelAtBinding.trim(),
    occurrence: Number(value.occurrence),
    lastKnownStart: Number(value.lastKnownStart),
    lastKnownEnd: Number(value.lastKnownEnd),
    contextFingerprint: value.contextFingerprint
  };
}

function hasValidBlockShape(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.id) &&
    blockTypes.includes(value.type as UniversalBlockType) &&
    typeof value.text === "string" &&
    (value.url === null || typeof value.url === "string") &&
    (value.checked === null || typeof value.checked === "boolean") &&
    isRecord(value.metadata) &&
    Object.values(value.metadata).every(isJsonValue);
}

function hasValidObjectShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const roles = Array.isArray(value.roles) ? value.roles : [];
  const blocks = Array.isArray(value.blocks) ? value.blocks : [];
  const source = isRecord(value.source) ? value.source : null;
  const properties = isRecord(value.properties) ? value.properties : null;
  const status = value.status as UniversalObjectStatus;
  const blockIds = blocks.flatMap((block) =>
    isRecord(block) && typeof block.id === "string" ? [block.id] : []
  );
  const lifecycleIsConsistent =
    (status === "archived" ? isDateString(value.archivedAt) : true) &&
    (status === "deleted" ? isDateString(value.deletedAt) : value.deletedAt === null);

  return isNonEmptyString(value.id) &&
    !value.id.startsWith("legacy:") &&
    roles.length > 0 &&
    roles.every(isUniversalRole) &&
    new Set(roles).size === roles.length &&
    typeof value.title === "string" &&
    blocks.every(hasValidBlockShape) &&
    new Set(blockIds).size === blocks.length &&
    Boolean(properties) &&
    Object.values(properties ?? {}).every(isJsonValue) &&
    objectStatuses.includes(status) &&
    source?.kind === "native" &&
    source.entityType === null &&
    source.entityId === null &&
    Number.isInteger(value.revision) &&
    Number(value.revision) > 0 &&
    isDateString(value.createdAt) &&
    isDateString(value.updatedAt) &&
    (value.archivedAt === null || isDateString(value.archivedAt)) &&
    (value.deletedAt === null || isDateString(value.deletedAt)) &&
    lifecycleIsConsistent;
}

function hasValidRelationShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const origin = value.origin === undefined
    ? "manual"
    : value.origin as ObjectRelationOrigin;
  return isNonEmptyString(value.id) &&
    relationKinds.includes(value.kind as ObjectRelationKind) &&
    isNonEmptyString(value.fromId) &&
    isNonEmptyString(value.toId) &&
    value.fromId !== value.toId &&
    Number.isInteger(value.order) &&
    Number(value.order) >= 0 &&
    isDateString(value.createdAt) &&
    relationOrigins.includes(origin) &&
    (origin === "manual"
      ? value.binding === undefined
      : Boolean(normalizeWikiBinding(value.binding)) &&
        ((origin === "wiki-link" && value.kind === "links") ||
          (origin === "wiki-embed" && value.kind === "embeds")));
}

export function createEmptyObjectGraph(): ObjectGraph {
  return { schemaVersion: 1, objects: [], relations: [] };
}

export function createUniversalObject(
  draft: UniversalObjectDraft,
  options: { now?: string; idFactory?: () => string } = {}
): UniversalObject {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? randomId;
  const id = draft.id ?? idFactory();
  if (!isNonEmptyString(id)) {
    throw new ObjectGraphError("invalid_object", "Идентификатор объекта не может быть пустым.");
  }
  if (id.startsWith("legacy:")) {
    throw new ObjectGraphError("reserved_object_id", "Префикс legacy: зарезервирован для адаптера старых данных.");
  }
  return {
    id,
    roles: normalizeRoles(draft.roles),
    title: draft.title?.trim() || "Без названия",
    blocks: normalizeBlocks(draft.blocks ?? []),
    properties: normalizeJsonRecord(draft.properties),
    status: "active",
    source: { kind: "native", entityType: null, entityId: null },
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null
  };
}

export function addUniversalObject(graph: ObjectGraph, object: UniversalObject): ObjectGraph {
  if (!hasValidObjectShape(object)) {
    throw new ObjectGraphError("invalid_object", "Нативный объект повреждён или использует зарезервированный идентификатор.");
  }
  if (graph.objects.some((entry) => entry.id === object.id)) {
    throw new ObjectGraphError("duplicate_object", `Объект ${object.id} уже существует.`);
  }
  return { ...graph, objects: [object, ...graph.objects] };
}

export function patchUniversalObject(
  graph: ObjectGraph,
  id: string,
  changes: Partial<Pick<UniversalObject, "title" | "roles" | "blocks" | "properties" | "status">>,
  options: { now?: string; expectedRevision?: number } = {}
): ObjectGraph {
  if (!graph.objects.some((entry) => entry.id === id)) {
    throw new ObjectGraphError("missing_object", `Объект ${id} не найден.`);
  }
  return {
    ...graph,
    objects: graph.objects.map((object) => {
      if (object.id !== id) return object;
      if (options.expectedRevision !== undefined && object.revision !== options.expectedRevision) {
        throw new ObjectGraphError(
          "revision_conflict",
          `Объект изменился: ожидалась ревизия ${options.expectedRevision}, актуальна ${object.revision}.`
        );
      }
      const now = options.now ?? new Date().toISOString();
      const status = changes.status ?? object.status;
      return {
        ...object,
        ...(typeof changes.title === "string" ? { title: changes.title.trim() || "Без названия" } : {}),
        ...(changes.roles ? { roles: normalizeRoles(changes.roles) } : {}),
        ...(changes.blocks ? { blocks: normalizeBlocks(changes.blocks) } : {}),
        ...(changes.properties ? { properties: normalizeJsonRecord(changes.properties) } : {}),
        status,
        archivedAt: status === "archived" ? object.archivedAt ?? now : status === "active" ? null : object.archivedAt,
        deletedAt: status === "deleted" ? object.deletedAt ?? now : null,
        revision: object.revision + 1,
        updatedAt: now
      };
    })
  };
}

function isReachableByContainment(
  relations: ObjectRelation[],
  startId: string,
  targetId: string
): boolean {
  const children = new Map<string, string[]>();
  relations.filter((entry) => entry.kind === "contains").forEach((entry) => {
    children.set(entry.fromId, [...(children.get(entry.fromId) ?? []), entry.toId]);
  });
  const queue = [startId];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(children.get(current) ?? []));
  }
  return false;
}

export function addObjectRelation(
  graph: ObjectGraph,
  draft: ObjectRelationDraft,
  options: {
    now?: string;
    idFactory?: () => string;
    endpointExists?: (id: string) => boolean;
  } = {}
): ObjectGraph {
  if (!relationKinds.includes(draft.kind)) {
    throw new ObjectGraphError("invalid_relation", "Неизвестный тип связи.");
  }
  if (draft.fromId === draft.toId) {
    throw new ObjectGraphError("self_relation", "Объект нельзя связать с самим собой этим способом.");
  }
  const relationId = draft.id ?? (options.idFactory ?? randomId)();
  if (!isNonEmptyString(relationId)) {
    throw new ObjectGraphError("invalid_relation", "Идентификатор связи не может быть пустым.");
  }
  if (graph.relations.some((entry) => entry.id === relationId)) {
    throw new ObjectGraphError("duplicate_relation_id", `Связь ${relationId} уже существует.`);
  }
  const endpointExists = options.endpointExists ?? ((id: string) =>
    graph.objects.some((object) => object.id === id));
  if (!endpointExists(draft.fromId) || !endpointExists(draft.toId)) {
    throw new ObjectGraphError(
      "missing_endpoint",
      "Связь может ссылаться только на существующие объекты актуального каталога."
    );
  }
  const origin = draft.origin ?? "manual";
  const binding = origin === "manual" ? null : normalizeWikiBinding(draft.binding);
  if (!relationOrigins.includes(origin) ||
    (origin !== "manual" && !binding) ||
    (origin === "wiki-link" && draft.kind !== "links") ||
    (origin === "wiki-embed" && draft.kind !== "embeds")) {
    throw new ObjectGraphError("invalid_relation", "Wiki-связь должна содержать origin и пользовательскую метку.");
  }
  if (graph.relations.some((entry) =>
    entry.kind === draft.kind &&
    entry.fromId === draft.fromId &&
    entry.toId === draft.toId &&
    entry.origin === origin &&
    (entry.origin === "manual" || origin === "manual" || (
      entry.binding.labelAtBinding === binding?.labelAtBinding &&
      entry.binding.occurrence === binding.occurrence &&
      entry.binding.contextFingerprint === binding.contextFingerprint
    ))
  )) {
    throw new ObjectGraphError("duplicate_relation", "Такая связь уже существует.");
  }
  if (draft.kind === "contains") {
    if (graph.relations.some((entry) => entry.kind === "contains" && entry.toId === draft.toId)) {
      throw new ObjectGraphError(
        "already_has_parent",
        "У объекта уже есть структурный родитель. Используйте встраивание для показа в другом месте."
      );
    }
    if (isReachableByContainment(graph.relations, draft.toId, draft.fromId)) {
      throw new ObjectGraphError("containment_cycle", "Вложение создаёт бесконечный цикл.");
    }
  }
  const base: ObjectRelationBase = {
    id: relationId,
    kind: draft.kind,
    fromId: draft.fromId,
    toId: draft.toId,
    order: Number.isFinite(draft.order) ? Math.max(0, Math.floor(Number(draft.order))) : 0,
    createdAt: options.now ?? new Date().toISOString()
  };
  const relation: ObjectRelation = origin === "manual"
    ? { ...base, origin }
    : origin === "wiki-link"
      ? { ...base, kind: "links", origin, binding: binding! }
      : { ...base, kind: "embeds", origin, binding: binding! };
  return { ...graph, relations: [...graph.relations, relation] };
}

export function removeObjectRelation(graph: ObjectGraph, relationId: string): ObjectGraph {
  const relations = graph.relations.filter((entry) => entry.id !== relationId);
  return relations.length === graph.relations.length ? graph : { ...graph, relations };
}

export function childRelations(graph: ObjectGraph, parentId: string): ObjectRelation[] {
  return graph.relations
    .filter((entry) => entry.fromId === parentId && ["contains", "embeds"].includes(entry.kind))
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
}

/**
 * Deserializes the persisted native graph. Endpoint existence for persisted
 * mixed relations is intentionally checked later against the complete object
 * catalog: this low-level graph does not own legacy entities.
 */
export function normalizeObjectGraph(value: unknown): ObjectGraph {
  if (!isRecord(value)) {
    throw new ObjectGraphError("invalid_graph", "Объектный слой отсутствует или повреждён.");
  }
  if (value.schemaVersion !== 1) {
    throw new ObjectGraphError(
      "unsupported_schema",
      `Неподдерживаемая версия объектного слоя: ${String(value.schemaVersion)}.`
    );
  }
  if (!Array.isArray(value.objects) || !Array.isArray(value.relations)) {
    throw new ObjectGraphError("invalid_graph", "Списки объектов и связей должны присутствовать в объектном слое.");
  }
  const objectIds = new Set<string>();
  const objects = value.objects.map((rawObject, index) => {
    if (!hasValidObjectShape(rawObject)) {
      throw new ObjectGraphError("invalid_object", `Объект №${index + 1} повреждён. Загрузка остановлена без изменения базы.`);
    }
    const object = normalizeObject(rawObject)!;
    if (objectIds.has(object.id)) {
      throw new ObjectGraphError("invalid_object", `Идентификатор объекта ${object.id} повторяется.`);
    }
    objectIds.add(object.id);
    return object;
  });

  let graph: ObjectGraph = { schemaVersion: 1, objects, relations: [] };
  const relationIds = new Set<string>();
  for (const [index, rawRelation] of value.relations.entries()) {
    if (!hasValidRelationShape(rawRelation)) {
      throw new ObjectGraphError("invalid_relation", `Связь №${index + 1} повреждена. Загрузка остановлена без изменения базы.`);
    }
    const relation = normalizeRelation(rawRelation)!;
    if (relationIds.has(relation.id)) {
      throw new ObjectGraphError("invalid_relation", `Идентификатор связи ${relation.id} повторяется.`);
    }
    try {
      graph = addObjectRelation(graph, relation, {
        now: relation.createdAt,
        idFactory: () => relation.id,
        endpointExists: () => true
      });
      relationIds.add(relation.id);
    } catch (error) {
      const reason = error instanceof Error ? ` ${error.message}` : "";
      throw new ObjectGraphError("invalid_relation", `Связь ${relation.id} нарушает целостность графа.${reason}`);
    }
  }
  return graph;
}
