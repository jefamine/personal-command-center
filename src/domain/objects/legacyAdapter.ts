import type { DashboardState } from "../../types";
import type {
  JsonValue,
  ObjectRelation,
  ObjectRelationKind,
  UniversalObject,
  UniversalObjectBlock,
  UniversalObjectRole,
  UniversalObjectStatus
} from "./objectGraph";

export type LegacyObjectType = "task" | "project" | "area" | "event" | "note" | "reading";

export interface ObjectCatalog {
  objects: UniversalObject[];
  relations: ObjectRelation[];
  byId: Map<string, UniversalObject>;
}

function legacyBlock(ownerId: string, text: string, metadata: Record<string, JsonValue> = {}): UniversalObjectBlock[] {
  if (!text) return [];
  return [{
    id: `${ownerId}:body`,
    type: "text",
    text,
    url: null,
    checked: null,
    metadata
  }];
}

function legacyObject(
  type: LegacyObjectType,
  rawId: string,
  title: string,
  roles: UniversalObjectRole[],
  blocks: UniversalObjectBlock[],
  properties: Record<string, JsonValue>,
  status: UniversalObjectStatus,
  createdAt: string,
  updatedAt: string
): UniversalObject {
  return {
    id: legacyObjectReference(type, rawId),
    roles,
    title: title || "Без названия",
    blocks,
    properties,
    status,
    source: { kind: "legacy", entityType: type, entityId: rawId },
    revision: 1,
    createdAt,
    updatedAt,
    archivedAt: status === "archived" ? updatedAt : null,
    deletedAt: null
  };
}

function legacyRelation(
  kind: ObjectRelationKind,
  fromId: string,
  toId: string,
  createdAt: string,
  suffix: string
): ObjectRelation {
  return {
    id: `legacy:relation:${suffix}:${encodeURIComponent(fromId)}:${encodeURIComponent(toId)}`,
    kind,
    fromId,
    toId,
    order: 0,
    createdAt
  };
}

export function legacyObjectReference(type: LegacyObjectType, rawId: string): string {
  return `legacy:v12:${type}:${encodeURIComponent(rawId)}`;
}

export function parseLegacyObjectReference(reference: string): { type: LegacyObjectType; rawId: string } | null {
  const match = /^legacy:v12:(task|project|area|event|note|reading):(.+)$/.exec(reference);
  if (!match) return null;
  try {
    return { type: match[1] as LegacyObjectType, rawId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

export function adaptLegacyObjects(state: DashboardState): Pick<ObjectCatalog, "objects" | "relations"> {
  const objects: UniversalObject[] = [];
  const relations: ObjectRelation[] = [];

  state.lifeAreas.forEach((area) => {
    const id = legacyObjectReference("area", area.id);
    objects.push(legacyObject(
      "area",
      area.id,
      area.title,
      ["sphere"],
      legacyBlock(id, area.description, { format: "markdown" }),
      { "sphere.color": area.color, "sphere.order": area.order },
      area.archived ? "archived" : "active",
      area.createdAt,
      area.updatedAt
    ));
  });

  state.projects.forEach((project) => {
    const id = legacyObjectReference("project", project.id);
    objects.push(legacyObject(
      "project",
      project.id,
      project.title,
      ["project"],
      legacyBlock(id, project.description, { format: "markdown" }),
      {
        "gtd.status": project.status,
        "gtd.nextReviewAt": project.nextReviewAt,
        "appearance.color": project.color
      },
      project.status === "completed" ? "completed" : "active",
      project.createdAt,
      project.updatedAt
    ));
    if (project.areaId) {
      relations.push(legacyRelation(
        "contains",
        legacyObjectReference("area", project.areaId),
        id,
        project.createdAt,
        "area-project"
      ));
    }
  });

  state.tasks.forEach((task) => {
    const id = legacyObjectReference("task", task.id);
    objects.push(legacyObject(
      "task",
      task.id,
      task.title,
      ["task"],
      legacyBlock(id, task.notes, { format: "markdown" }),
      {
        "gtd.status": task.status,
        "gtd.priority": task.priority,
        "gtd.estimateMinutes": task.estimateMinutes,
        "gtd.energy": task.energy,
        "gtd.context": task.context,
        "gtd.dueDate": task.dueDate,
        "gtd.scheduledDate": task.scheduledDate,
        "gtd.recurrence": task.recurrence
      },
      task.status === "done" ? "completed" : "active",
      task.createdAt,
      task.updatedAt
    ));
    if (task.projectId) {
      relations.push(legacyRelation(
        "contains",
        legacyObjectReference("project", task.projectId),
        id,
        task.createdAt,
        "project-task"
      ));
    }
    if (task.generatedFromTaskId) {
      relations.push(legacyRelation(
        "links",
        id,
        legacyObjectReference("task", task.generatedFromTaskId),
        task.createdAt,
        "generated-task"
      ));
    }
  });

  state.events.forEach((event) => {
    const id = legacyObjectReference("event", event.id);
    objects.push(legacyObject(
      "event",
      event.id,
      event.title,
      ["event"],
      legacyBlock(id, event.notes, { format: "markdown" }),
      {
        "calendar.startAt": event.startAt,
        "calendar.endAt": event.endAt,
        "calendar.kind": event.kind,
        "calendar.source": event.source,
        "calendar.locked": event.locked
      },
      "active",
      event.createdAt,
      event.updatedAt
    ));
    if (event.taskId) {
      relations.push(legacyRelation(
        "links",
        id,
        legacyObjectReference("task", event.taskId),
        event.createdAt,
        "event-task"
      ));
    }
  });

  state.notes.forEach((note) => {
    const id = legacyObjectReference("note", note.id);
    objects.push(legacyObject(
      "note",
      note.id,
      note.title,
      ["document"],
      legacyBlock(id, note.body, { format: "markdown" }),
      {
        "document.tags": note.tags,
        "document.pinned": note.pinned,
        "document.origin": note.origin ?? null
      },
      "active",
      note.createdAt,
      note.updatedAt
    ));
    if (note.projectId) {
      relations.push(legacyRelation(
        "contains",
        legacyObjectReference("project", note.projectId),
        id,
        note.createdAt,
        "project-note"
      ));
    }
  });

  state.readingItems.forEach((item) => {
    const id = legacyObjectReference("reading", item.id);
    objects.push(legacyObject(
      "reading",
      item.id,
      item.title,
      ["document", "material"],
      legacyBlock(id, [item.summary, item.body].filter(Boolean).join("\n\n"), {
        format: "markdown"
      }),
      {
        "material.url": item.url,
        "material.source": item.source,
        "document.tags": item.tags
      },
      "active",
      item.createdAt,
      item.createdAt
    ));
  });

  return { objects, relations };
}

export function buildObjectCatalog(state: DashboardState): ObjectCatalog {
  const legacy = adaptLegacyObjects(state);
  const objects = [...state.objectGraph.objects, ...legacy.objects];
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    objects,
    relations: [...legacy.relations, ...state.objectGraph.relations],
    byId
  };
}

export function objectChildren(catalog: ObjectCatalog, parentId: string): Array<{
  relation: ObjectRelation;
  object: UniversalObject | null;
}> {
  return catalog.relations
    .filter((relation) => relation.fromId === parentId && ["contains", "embeds"].includes(relation.kind))
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))
    .map((relation) => ({ relation, object: catalog.byId.get(relation.toId) ?? null }));
}

export function objectBacklinks(catalog: ObjectCatalog, objectId: string): ObjectRelation[] {
  return catalog.relations.filter((relation) => relation.toId === objectId);
}

