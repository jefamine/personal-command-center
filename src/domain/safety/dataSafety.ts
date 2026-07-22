import type {
  CalendarEvent,
  EntityRevision,
  Note,
  RevisionSnapshot,
  Task,
  TrashEntry
} from "../../types";
import type { ObjectRelation, UniversalObject } from "../objects/objectGraph";

export const MAX_ENTITY_REVISIONS = 200;
export const REVISION_COALESCE_MS = 5 * 60 * 1000;

function revisionTitle(snapshot: RevisionSnapshot): string {
  if (snapshot.kind === "task") return snapshot.task.title;
  if (snapshot.kind === "note") return snapshot.note.title;
  if (snapshot.kind === "event") return snapshot.event.title;
  return snapshot.object.title;
}

function entityId(snapshot: RevisionSnapshot): string {
  if (snapshot.kind === "task") return snapshot.task.id;
  if (snapshot.kind === "note") return snapshot.note.id;
  if (snapshot.kind === "event") return snapshot.event.id;
  return snapshot.object.id;
}

export function createEntityRevision(
  snapshot: RevisionSnapshot,
  capturedAt = new Date().toISOString(),
  id: string = crypto.randomUUID()
): EntityRevision {
  return {
    id,
    entityId: entityId(snapshot),
    entityKind: snapshot.kind,
    title: revisionTitle(snapshot),
    capturedAt,
    snapshot
  };
}

/**
 * Keeps the first state in a short editing session instead of recording every keystroke.
 * This gives useful rollback points while keeping the local database bounded.
 */
export function appendEntityRevision(
  history: EntityRevision[],
  revision: EntityRevision,
  coalesceMs = REVISION_COALESCE_MS,
  limit = MAX_ENTITY_REVISIONS
): EntityRevision[] {
  const latestForEntity = history.find(
    (entry) => entry.entityKind === revision.entityKind && entry.entityId === revision.entityId
  );
  if (
    latestForEntity &&
    Date.parse(revision.capturedAt) - Date.parse(latestForEntity.capturedAt) < coalesceMs
  ) {
    return history;
  }
  return [revision, ...history].slice(0, limit);
}

export function taskTrashEntry(
  task: Task,
  linkedEvents: CalendarEvent[],
  relations: ObjectRelation[] = [],
  deletedAt = new Date().toISOString(),
  id: string = crypto.randomUUID()
): TrashEntry {
  return {
    id,
    entityId: task.id,
    entityKind: "task",
    title: task.title,
    deletedAt,
    snapshot: { kind: "task", task, linkedEvents, relations }
  };
}

export function noteTrashEntry(
  note: Note,
  deletedAt = new Date().toISOString(),
  id: string = crypto.randomUUID(),
  relations: ObjectRelation[] = []
): TrashEntry {
  return {
    id,
    entityId: note.id,
    entityKind: "note",
    title: note.title,
    deletedAt,
    snapshot: { kind: "note", note, relations }
  };
}

export function eventTrashEntry(
  event: CalendarEvent,
  relations: ObjectRelation[] = [],
  deletedAt = new Date().toISOString(),
  id: string = crypto.randomUUID()
): TrashEntry {
  return {
    id,
    entityId: event.id,
    entityKind: "event",
    title: event.title,
    deletedAt,
    snapshot: { kind: "event", event, relations }
  };
}

export function objectTrashEntry(
  object: UniversalObject,
  relations: ObjectRelation[],
  deletedAt = new Date().toISOString(),
  id: string = crypto.randomUUID()
): TrashEntry {
  return {
    id,
    entityId: object.id,
    entityKind: "object",
    title: object.title,
    deletedAt,
    snapshot: { kind: "object", object, relations }
  };
}
