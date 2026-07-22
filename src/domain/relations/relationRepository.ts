import type { DashboardState, PendingRelationReason, PendingRelationRecovery, TrashEntry } from "../../types";
import { noteDocumentId } from "../documents/documentContract";
import { buildObjectCatalog, legacyObjectReference } from "../objects/legacyAdapter";
import {
  addObjectRelation,
  ObjectGraphError,
  removeObjectRelation,
  type ObjectRelation,
  type ObjectRelationDraft
} from "../objects/objectGraph";

export type RelationMutationResult =
  | { readonly status: "accepted"; readonly relation: ObjectRelation }
  | { readonly status: "rejected"; readonly code: string; readonly message: string };

export interface CapturedRelations {
  readonly state: DashboardState;
  readonly relations: readonly ObjectRelation[];
}

export interface RestoredRelations {
  readonly state: DashboardState;
  readonly restored: readonly ObjectRelation[];
  readonly pending: readonly PendingRelationRecovery[];
}

export function liveRelationEndpointIds(state: DashboardState): ReadonlySet<string> {
  return new Set(buildObjectCatalog(state).objects
    .filter((object) => object.status !== "deleted")
    .map((object) => object.id));
}

export function relationIdentity(relation: ObjectRelation): string {
  return [relation.kind, relation.fromId, relation.toId].join("\u0000");
}

export function getRelationsFor(state: DashboardState, id: string): readonly ObjectRelation[] {
  return state.objectGraph.relations.filter((relation) =>
    relation.fromId === id || relation.toId === id
  );
}

export function addRelationToState(
  state: DashboardState,
  draft: ObjectRelationDraft,
  options: { now?: string; idFactory?: () => string } = {}
): { readonly state: DashboardState; readonly result: RelationMutationResult } {
  const endpoints = liveRelationEndpointIds(state);
  try {
    const objectGraph = addObjectRelation(state.objectGraph, draft, {
      ...options,
      endpointExists: (id) => endpoints.has(id)
    });
    const relationId = draft.id ?? objectGraph.relations.at(-1)?.id;
    const relation = objectGraph.relations.find((entry) => entry.id === relationId);
    if (!relation) {
      return {
        state,
        result: { status: "rejected", code: "missing_relation", message: "Созданная связь не найдена." }
      };
    }
    return { state: { ...state, objectGraph }, result: { status: "accepted", relation } };
  } catch (error) {
    return {
      state,
      result: {
        status: "rejected",
        code: error instanceof ObjectGraphError ? error.code : "relation_error",
        message: error instanceof Error ? error.message : "Не удалось изменить связь."
      }
    };
  }
}

export function removeRelationFromState(state: DashboardState, relationId: string): DashboardState {
  return {
    ...state,
    objectGraph: removeObjectRelation(state.objectGraph, relationId)
  };
}

export function captureRelationsForDeletion(
  state: DashboardState,
  endpointId: string
): CapturedRelations {
  return captureRelationsForEndpointSet(state, [endpointId]);
}

/** Atomically removes every persisted relation touching any endpoint in the set. */
export function captureRelationsForEndpointSet(
  state: DashboardState,
  endpointIds: Iterable<string>
): CapturedRelations {
  const endpoints = new Set(endpointIds);
  if (!endpoints.size) return { state, relations: [] };
  const relations = state.objectGraph.relations.filter((relation) =>
    endpoints.has(relation.fromId) || endpoints.has(relation.toId)
  );
  if (!relations.length) return { state, relations };
  const capturedIds = new Set(relations.map((relation) => relation.id));
  return {
    state: {
      ...state,
      objectGraph: {
        ...state.objectGraph,
        relations: state.objectGraph.relations.filter((relation) => !capturedIds.has(relation.id))
      }
    },
    relations
  };
}

function missingReason(endpoints: ReadonlySet<string>, relation: ObjectRelation): PendingRelationReason {
  const fromMissing = !endpoints.has(relation.fromId);
  const toMissing = !endpoints.has(relation.toId);
  if (fromMissing && toMissing) return "missing-endpoints";
  return fromMissing ? "missing-from" : "missing-to";
}

function uniquePending(entries: readonly PendingRelationRecovery[]): PendingRelationRecovery[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.relation.id)) return false;
    seen.add(entry.relation.id);
    return true;
  });
}

export function restoreCapturedRelations(
  state: DashboardState,
  relations: readonly ObjectRelation[],
  capturedAt = new Date().toISOString()
): RestoredRelations {
  const relationIds = new Set(relations.map((relation) => relation.id));
  let next: DashboardState = {
    ...state,
    pendingRelations: state.pendingRelations.filter((entry) => !relationIds.has(entry.relation.id))
  };
  const restored: ObjectRelation[] = [];
  const pending: PendingRelationRecovery[] = [];

  for (const relation of relations) {
    const existingById = next.objectGraph.relations.some((entry) => entry.id === relation.id);
    const existingByIdentity = next.objectGraph.relations.some((entry) =>
      relationIdentity(entry) === relationIdentity(relation)
    );
    if (existingById || existingByIdentity) continue;

    const endpoints = liveRelationEndpointIds(next);
    if (!endpoints.has(relation.fromId) || !endpoints.has(relation.toId)) {
      pending.push({ relation, reason: missingReason(endpoints, relation), capturedAt });
      continue;
    }

    const added = addRelationToState(next, relation, {
      now: relation.createdAt,
      idFactory: () => relation.id
    });
    if (added.result.status === "accepted") {
      next = added.state;
      restored.push(added.result.relation);
    } else if (added.result.code !== "duplicate_relation" && added.result.code !== "duplicate_relation_id") {
      pending.push({ relation, reason: "invariant-rejected", capturedAt });
    }
  }

  next = {
    ...next,
    pendingRelations: uniquePending([...next.pendingRelations, ...pending])
  };
  return { state: next, restored, pending };
}

export function retryPendingRelations(state: DashboardState): RestoredRelations {
  return restoreCapturedRelations(
    { ...state, pendingRelations: [] },
    state.pendingRelations.map((entry) => entry.relation)
  );
}

/** Permanently removes semantic relations from live, pending and tombstone recovery stores. */
export function purgeRelationsForEndpoints(
  state: DashboardState,
  endpointIds: Iterable<string>
): DashboardState {
  const removed = new Set(endpointIds);
  if (!removed.size) return state;
  const survivesPurge = (relation: ObjectRelation) =>
    !removed.has(relation.fromId) && !removed.has(relation.toId);
  return {
    ...state,
    objectGraph: {
      ...state.objectGraph,
      relations: state.objectGraph.relations.filter(survivesPurge)
    },
    pendingRelations: state.pendingRelations.filter((entry) => survivesPurge(entry.relation)),
    trash: state.trash.map((entry) => {
      const relations = entry.snapshot.relations.filter(survivesPurge);
      if (relations.length === entry.snapshot.relations.length) return entry;
      return {
        ...entry,
        snapshot: { ...entry.snapshot, relations }
      } as TrashEntry;
    })
  };
}

export function trashEntryRelationEndpointIds(entry: TrashEntry): readonly string[] {
  const snapshot = entry.snapshot;
  if (snapshot.kind === "note") return [noteDocumentId(snapshot.note.id)];
  if (snapshot.kind === "object") return [snapshot.object.id];
  if (snapshot.kind === "event") return [legacyObjectReference("event", snapshot.event.id)];
  return [
    legacyObjectReference("task", snapshot.task.id),
    ...snapshot.linkedEvents.map((event) => legacyObjectReference("event", event.id))
  ];
}

export function quarantineDanglingRelations(
  state: DashboardState,
  capturedAt = new Date().toISOString()
): DashboardState {
  const endpoints = liveRelationEndpointIds(state);
  const valid: ObjectRelation[] = [];
  const pending: PendingRelationRecovery[] = [];
  state.objectGraph.relations.forEach((relation) => {
    if (endpoints.has(relation.fromId) && endpoints.has(relation.toId)) valid.push(relation);
    else pending.push({ relation, reason: missingReason(endpoints, relation), capturedAt });
  });
  return {
    ...state,
    objectGraph: { ...state.objectGraph, relations: valid },
    pendingRelations: uniquePending([...state.pendingRelations, ...pending])
  };
}

export function assertPersistedRelationEndpoints(state: DashboardState): void {
  const endpoints = liveRelationEndpointIds(state);
  const invalid = state.objectGraph.relations.find((relation) =>
    !endpoints.has(relation.fromId) || !endpoints.has(relation.toId)
  );
  if (invalid) {
    throw new ObjectGraphError(
      "missing_endpoint",
      `Связь ${invalid.id} ссылается на отсутствующий endpoint.`
    );
  }
}
