import { useMemo, useRef } from "react";
import type { DocumentId } from "../domain/documents/documentContract";
import {
  createDocumentRepository,
  type DocumentReferenceUpdateSummary
} from "../domain/documents/documentRepository";
import {
  applyDocumentReferenceRenamePlan,
  planDocumentReferenceRename
} from "../domain/relations/documentRelationOperations";
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
    removeObject
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
      sourceDocuments: ReturnType<typeof repository.listDocuments>
    ): DocumentReferenceUpdateSummary => {
      const plan = planDocumentReferenceRename(targetId, nextTitle, sourceDocuments);
      return applyDocumentReferenceRenamePlan(
        plan,
        (sourceId, content) => repository.updateDocument(sourceId, { content })
      );
    };

    return {
      ...repository,
      updateDocument: (id: Parameters<typeof repository.updateDocument>[0], patch: Parameters<typeof repository.updateDocument>[1]) => {
        const before = repository.getDocument(id);
        const sourceDocuments = repository.listDocuments();
        const result = repository.updateDocument(id, patch);
        if (result.status !== "accepted") return result;
        const titleChanged = before.status === "found" && typeof patch.title === "string" &&
          Boolean(patch.title.trim()) && patch.title !== before.document.title;
        const referenceUpdate = titleChanged
          ? propagateRename(id, patch.title!.trim(), sourceDocuments)
          : undefined;
        return referenceUpdate ? { ...result, referenceUpdate } : result;
      }
    };
  }, [
    addNote,
    removeNote,
    removeObject,
    updateNote,
    updateObject
  ]);
}
