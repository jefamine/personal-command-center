import type { DashboardState, PendingRelationReason, PendingRelationRecovery } from "../../types";
import type { DocumentId, DocumentRecord } from "../documents/documentContract";
import {
  matchWikiBinding,
  normalizeDocumentWikiTitle,
  parseDocumentWikiReferences,
  wikiBindingForToken,
  type DocumentWikiLinkToken,
  type DocumentWikiReferenceKind
} from "../documents/documentWikiLinks";
import { buildObjectCatalog } from "../objects/legacyAdapter";
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

export interface ReferenceReconciliationResult {
  readonly state: DashboardState;
  readonly created: readonly ObjectRelation[];
  readonly updated: readonly ObjectRelation[];
  readonly removed: readonly ObjectRelation[];
  readonly pending: readonly PendingRelationRecovery[];
}

export function liveRelationEndpointIds(state: DashboardState): ReadonlySet<string> {
  return new Set(buildObjectCatalog(state).objects
    .filter((object) => object.status !== "deleted")
    .map((object) => object.id));
}

export function relationIdentity(relation: ObjectRelation): string {
  const binding = relation.origin === "manual" ? null : relation.binding;
  return [
    relation.kind,
    relation.fromId,
    relation.toId,
    relation.origin,
    binding?.labelAtBinding ?? "",
    binding?.occurrence ?? "",
    binding?.contextFingerprint ?? ""
  ].join("\u0000");
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
  const relations = state.objectGraph.relations.filter((relation) =>
    relation.fromId === endpointId || relation.toId === endpointId
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
  const retained = state.pendingRelations.filter((entry) => entry.reason === "binding-ambiguous");
  const retryable = state.pendingRelations.filter((entry) => entry.reason !== "binding-ambiguous");
  return restoreCapturedRelations(
    { ...state, pendingRelations: retained },
    retryable.map((entry) => entry.relation)
  );
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

function relationKind(kind: DocumentWikiReferenceKind): "links" | "embeds" {
  return kind === "link" ? "links" : "embeds";
}

function relationOrigin(kind: DocumentWikiReferenceKind): "wiki-link" | "wiki-embed" {
  return kind === "link" ? "wiki-link" : "wiki-embed";
}

function documentByTitle(documents: readonly DocumentRecord[]) {
  const result = new Map<string, DocumentRecord[]>();
  documents.forEach((document) => {
    const key = normalizeDocumentWikiTitle(document.title);
    if (!key) return;
    result.set(key, [...(result.get(key) ?? []), document]);
  });
  return result;
}

/** Reconciles canonical wiki syntax with stable relations without rewriting text. */
export function reconcileDocumentReferences(
  state: DashboardState,
  source: DocumentRecord,
  documents: readonly DocumentRecord[],
  options: { now?: string; idFactory?: () => string } = {}
): ReferenceReconciliationResult {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const tokens = parseDocumentWikiReferences(source.content);
  const used = new Set<number>();
  const created: ObjectRelation[] = [];
  const updated: ObjectRelation[] = [];
  const removed: ObjectRelation[] = [];
  const pending: PendingRelationRecovery[] = [];
  const retained: ObjectRelation[] = [];
  const sourceWikiRelations = state.objectGraph.relations.filter((relation) =>
    relation.fromId === source.id && relation.origin !== "manual"
  );

  state.objectGraph.relations.forEach((relation) => {
    if (!sourceWikiRelations.includes(relation)) retained.push(relation);
  });

  sourceWikiRelations.forEach((relation) => {
    const kind: DocumentWikiReferenceKind = relation.origin === "wiki-link" ? "link" : "embed";
    const match = matchWikiBinding(relation.binding!, kind, tokens, used);
    if (match.status === "matched") {
      const tokenIndex = tokens.indexOf(match.token);
      used.add(tokenIndex);
      const nextRelation = {
        ...relation,
        binding: wikiBindingForToken(match.token)
      } as ObjectRelation;
      retained.push(nextRelation);
      if (relationIdentity(nextRelation) !== relationIdentity(relation) ||
        JSON.stringify(nextRelation.binding) !== JSON.stringify(relation.binding)) updated.push(nextRelation);
      return;
    }
    if (match.status === "ambiguous") {
      const recovery = { relation, reason: "binding-ambiguous" as const, capturedAt: now };
      pending.push(recovery);
      return;
    }
    removed.push(relation);
  });

  const byTitle = documentByTitle(documents);
  const recoveryBindings = [...state.pendingRelations, ...pending]
    .filter((entry) => entry.reason === "binding-ambiguous" && entry.relation.fromId === source.id);
  let next = { ...state, objectGraph: { ...state.objectGraph, relations: retained } };
  tokens.forEach((token, tokenIndex) => {
    if (used.has(tokenIndex)) return;
    const tokenOrigin = relationOrigin(token.kind);
    if (recoveryBindings.some((entry) =>
      entry.relation.origin === tokenOrigin &&
      normalizeDocumentWikiTitle(entry.relation.binding!.labelAtBinding) === normalizeDocumentWikiTitle(token.label)
    )) return;
    const matches = byTitle.get(normalizeDocumentWikiTitle(token.label)) ?? [];
    if (matches.length !== 1) return;
    const target = matches[0];
    if (target.id === source.id) return;
    const draft: ObjectRelationDraft = token.kind === "link"
      ? {
          id: idFactory(), kind: "links", fromId: source.id, toId: target.id,
          origin: "wiki-link", binding: wikiBindingForToken(token)
        }
      : {
          id: idFactory(), kind: "embeds", fromId: source.id, toId: target.id,
          origin: "wiki-embed", binding: wikiBindingForToken(token)
        };
    const added = addRelationToState(next, draft, { now, idFactory: () => draft.id! });
    if (added.result.status !== "accepted") return;
    next = added.state;
    created.push(added.result.relation);
    used.add(tokenIndex);
  });

  next = {
    ...next,
    pendingRelations: uniquePending([...state.pendingRelations, ...pending])
  };
  return { state: next, created, updated, removed, pending };
}

/** Creates a binding for the exact token selected through the document chooser. */
export function bindDocumentReference(
  state: DashboardState,
  sourceId: DocumentId,
  targetId: DocumentId,
  token: DocumentWikiLinkToken,
  options: { now?: string; idFactory?: () => string } = {}
): { readonly state: DashboardState; readonly result: RelationMutationResult } {
  const origin = relationOrigin(token.kind);
  const kind = relationKind(token.kind);
  const existing = state.objectGraph.relations.find((relation) =>
    relation.fromId === sourceId && relation.origin === origin &&
    relation.binding.lastKnownStart === token.start && relation.binding.lastKnownEnd === token.end
  );
  const withoutExisting = existing ? removeRelationFromState(state, existing.id) : state;
  const withoutPending = {
    ...withoutExisting,
    pendingRelations: withoutExisting.pendingRelations.filter((entry) => !(
      entry.reason === "binding-ambiguous" &&
      entry.relation.fromId === sourceId &&
      entry.relation.origin === origin &&
      normalizeDocumentWikiTitle(entry.relation.binding!.labelAtBinding) === normalizeDocumentWikiTitle(token.label)
    ))
  };
  return addRelationToState(withoutPending, {
    kind,
    fromId: sourceId,
    toId: targetId,
    origin,
    binding: wikiBindingForToken(token)
  }, options);
}

export function rebindDocumentReference(
  state: DashboardState,
  relationId: string,
  token: DocumentWikiLinkToken
): { readonly state: DashboardState; readonly result: RelationMutationResult } {
  const existing = state.objectGraph.relations.find((relation) => relation.id === relationId);
  if (!existing || existing.origin === "manual") {
    return {
      state,
      result: { status: "rejected", code: "missing_relation", message: "Wiki-связь не найдена." }
    };
  }
  const expectedKind = existing.origin === "wiki-link" ? "link" : "embed";
  if (token.kind !== expectedKind) {
    return {
      state,
      result: { status: "rejected", code: "invalid_relation", message: "Тип wiki-связи изменился." }
    };
  }
  const withoutExisting = removeRelationFromState(state, relationId);
  return addRelationToState(withoutExisting, {
    ...existing,
    binding: wikiBindingForToken(token)
  }, { now: existing.createdAt, idFactory: () => existing.id });
}
