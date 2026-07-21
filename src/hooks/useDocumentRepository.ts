import { useMemo, useRef } from "react";
import type { DocumentId } from "../domain/documents/documentContract";
import {
  createDocumentRepository,
  type DocumentReferenceUpdateSummary
} from "../domain/documents/documentRepository";
import type { ObjectRelation } from "../domain/objects/objectGraph";
import { planDocumentReferenceRename } from "../domain/relations/documentRelationOperations";
import { useDashboard } from "../state/DashboardContext";

/**
 * React application adapter for the transitional document repository.
 * It supplies current DashboardContext commands without making the repository
 * itself depend on React or turning it into a process-wide singleton.
 */
export function useDocumentRepository() {
  const {
    state,
    addNote,
    updateNote,
    removeNote,
    updateObject,
    removeObject,
    reconcileDocumentRelations,
    rebindDocumentReference
  } = useDashboard();
  const stateRef = useRef(state);
  stateRef.current = state;

  return useMemo(() => {
    const repository = createDocumentRepository({
      getState: () => stateRef.current,
      addNote,
      updateNote,
      updateNativeObject: updateObject,
      removeNote,
      removeNativeObject: removeObject
    });

    const propagateRename = (
      targetId: DocumentId,
      nextTitle: string,
      relations: readonly ObjectRelation[],
      sourceDocuments: ReturnType<typeof repository.listDocuments>
    ): DocumentReferenceUpdateSummary => {
      const updatedSources: string[] = [];
      const skippedSources: Array<{ id: string; reason: string }> = [];
      const rejectedSources: Array<{ id: string; reason: string }> = [];
      const plan = planDocumentReferenceRename(targetId, nextTitle, relations, sourceDocuments);
      skippedSources.push(...plan.skippedSources);
      plan.sources.forEach((source) => {
        const update = repository.updateDocument(source.sourceId, { content: source.content });
        if (update.status !== "accepted") {
          rejectedSources.push({ id: source.sourceId, reason: update.status });
          return;
        }
        source.bindings.forEach((binding) => {
          const rebound = rebindDocumentReference(binding.relationId, binding.token);
          if (rebound.status === "rejected") {
            rejectedSources.push({ id: source.sourceId, reason: rebound.code });
          }
        });
        updatedSources.push(source.sourceId);
      });
      return { updatedSources, skippedSources, rejectedSources };
    };

    return {
      ...repository,
      updateDocument: (id: Parameters<typeof repository.updateDocument>[0], patch: Parameters<typeof repository.updateDocument>[1]) => {
        const before = repository.getDocument(id);
        const stateBefore = stateRef.current;
        const sourceDocuments = repository.listDocuments();
        const result = repository.updateDocument(id, patch);
        if (result.status !== "accepted") return result;
        if (typeof patch.content === "string") reconcileDocumentRelations(id);
        const titleChanged = before.status === "found" && typeof patch.title === "string" &&
          Boolean(patch.title.trim()) && patch.title !== before.document.title;
        const referenceUpdate = titleChanged
          ? propagateRename(id, patch.title!, stateBefore.objectGraph.relations, sourceDocuments)
          : undefined;
        return referenceUpdate ? { ...result, referenceUpdate } : result;
      }
    };
  }, [
    addNote,
    reconcileDocumentRelations,
    rebindDocumentReference,
    removeNote,
    removeObject,
    updateNote,
    updateObject
  ]);
}
